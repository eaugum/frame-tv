"""Signs Frame TV in to Spotify (AUG-1470) and writes the refresh token to config.properties.

Usage: python3 tools/spotify_login.py [--config PATH]

First make an app at developer.spotify.com/dashboard (Web API) with the redirect URI below, and put its client id
in config.properties as spotify_client_id. tools/setup.py does the same from its page. This opens Spotify's sign-in in the browser (PKCE: no client secret),
takes the answer on 127.0.0.1 (Spotify accepts plain http only there) and writes spotify_refresh_token. Then build
and install again. Spotify turns the token down 6 months after this; run it again then.
"""
import base64
import hashlib
import http.server
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8888
REDIRECT = 'http://127.0.0.1:%d/callback' % PORT
SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing'


def read_value(path, key):
    with open(path, encoding='utf-8') as f:
        for line in f:
            m = re.match(r'\s*%s\s*=(.*)$' % re.escape(key), line)
            if m:
                return m.group(1).strip().strip('"')
    return ''


def write_value(path, key, value):
    """Sets key in the file: on its own line where it is, or after spotify_client_id."""
    with open(path, encoding='utf-8') as f:
        lines = f.readlines()
    line = '%s=%s\n' % (key, value)
    for i, old in enumerate(lines):
        if re.match(r'\s*%s\s*=' % re.escape(key), old):
            lines[i] = line
            break
    else:
        at = next((i + 1 for i, old in enumerate(lines) if re.match(r'\s*spotify_client_id\s*=', old)), len(lines))
        lines.insert(at, line)
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(lines)


class SignInError(Exception):
    pass


def start(client):
    """A new sign-in: (the URL to open, verifier, state)."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).rstrip(b'=').decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    state = secrets.token_urlsafe(16)
    url = 'https://accounts.spotify.com/authorize?' + urllib.parse.urlencode({
        'client_id': client, 'response_type': 'code', 'redirect_uri': REDIRECT, 'scope': SCOPES,
        'code_challenge_method': 'S256', 'code_challenge': challenge, 'state': state})
    return url, verifier, state


def wait_for_code(state, timeout=None):
    """Serves 127.0.0.1 until Spotify's redirect comes (or timeout seconds pass). Returns its code."""
    got = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            url = urllib.parse.urlparse(self.path)
            if url.path != '/callback':
                self.send_response(404)
                self.end_headers()
                return
            q = urllib.parse.parse_qs(url.query)
            got['code'] = (q.get('code') or [''])[0]
            got['error'] = (q.get('error') or [''])[0]
            got['state'] = (q.get('state') or [''])[0]
            ok = got['code'] and got['state'] == state
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            text = 'Frame TV is signed in to Spotify. You can close this tab.' if ok else \
                'The sign-in didn\'t finish. Try again.'
            self.wfile.write(('<!doctype html><meta charset="utf-8"><p style="font: 20px sans-serif">%s</p>' % text)
                             .encode('utf-8'))

        def log_message(self, *args):
            pass

    try:
        server = http.server.HTTPServer(('127.0.0.1', PORT), Handler)
    except OSError:
        raise SignInError('Port %d is taken: is another sign-in still waiting?' % PORT)
    server.timeout = 1
    waited = 0
    try:
        while 'state' not in got:
            server.handle_request()
            waited += 1
            if timeout and waited > timeout:
                raise SignInError('No answer from Spotify in time. Try again.')
    finally:
        server.server_close()
    if got['error']:
        raise SignInError('Spotify said: %s' % got['error'])
    if got['state'] != state or not got['code']:
        raise SignInError('The answer from Spotify did not match this sign-in. Try again.')
    return got['code']


def refresh_token(client, code, verifier):
    """Trades the code for the refresh token."""
    body = urllib.parse.urlencode({'grant_type': 'authorization_code', 'code': code, 'redirect_uri': REDIRECT,
                                   'client_id': client, 'code_verifier': verifier}).encode()
    req = urllib.request.Request('https://accounts.spotify.com/api/token', data=body,
                                 headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            answer = json.load(r)
    except urllib.error.HTTPError as e:
        raise SignInError('Spotify turned down the sign-in (%d): %s' % (e.code, e.read().decode('utf-8', 'replace')))
    if not answer.get('refresh_token'):
        raise SignInError('Spotify gave no refresh token.')
    return answer['refresh_token']


def main():
    args = sys.argv[1:]
    path = os.path.abspath(args[args.index('--config') + 1]) if '--config' in args else os.path.join(ROOT, 'config.properties')
    if not os.path.exists(path):
        sys.exit('No %s yet: build once (python3 tizen/build.py), then add spotify_client_id there.' % path)
    client = read_value(path, 'spotify_client_id')
    if not client:
        sys.exit('Add spotify_client_id to %s first: the app on developer.spotify.com/dashboard, with the redirect '
                 'URI %s.' % (os.path.basename(path), REDIRECT))

    url, verifier, state = start(client)
    print('Opening Spotify in the browser. If it does not open, go to:\n%s\n' % url)
    webbrowser.open(url)
    try:
        token = refresh_token(client, wait_for_code(state), verifier)
    except SignInError as e:
        sys.exit(str(e))

    write_value(path, 'spotify_refresh_token', token)
    print('Signed in: spotify_refresh_token is in %s. Build and install again:\n'
          '  python3 tizen/build.py --sign <profile> && python3 tizen/install.py <TV IP>' % os.path.basename(path))


if __name__ == '__main__':
    main()
