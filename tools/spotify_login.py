"""Signs Frame TV in to Spotify (AUG-1470) and writes the refresh token to config.properties.

Usage: python3 tools/spotify_login.py [--config PATH]

First make an app at developer.spotify.com/dashboard (Web API) with the redirect URI below, and put its client id
in config.properties as spotify_client_id. tools/setup.py does the same from its page. This opens Spotify's sign-in in the browser (PKCE: no client secret),
takes the answer on 127.0.0.1 (Spotify accepts plain http only there) and writes spotify_refresh_token. Then build
and install again. Spotify turns the token down 6 months after this; run it again then.
"""
import base64
import hashlib
import hmac
import http.server
import json
import os
import re
import secrets
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import webapp  # noqa: E402  (reads and writes config.properties as the build and the setup page do)

PORT = 8888
REDIRECT = 'http://127.0.0.1:%d/callback' % PORT
SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing'


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


def listen(state):
    """Opens 127.0.0.1:PORT for this sign-in's redirect; call it before the browser goes to Spotify (AUG-1789).

    Only a request with this state ends the wait; anything else is turned away and the wait goes on."""
    answer = {}
    lock = threading.Lock()
    done = threading.Event()

    class Handler(http.server.BaseHTTPRequestHandler):
        timeout = 5   # per connection, so one that sends nothing is dropped

        def do_GET(self):
            url = urllib.parse.urlparse(self.path)
            q = urllib.parse.parse_qs(url.query)
            if url.path != '/callback':
                return self.page(404, 'Not found.')
            if not hmac.compare_digest((q.get('state') or [''])[0].encode(), state.encode()):
                return self.page(400, 'This is not the sign-in Frame TV is waiting for.')
            code, error = (q.get('code') or [''])[0], (q.get('error') or [''])[0]
            try:
                self.page(200, 'Frame TV is signed in to Spotify. You can close this tab.' if code and not error else
                          'The sign-in didn\'t finish. Try again.')
            finally:
                with lock:
                    if not done.is_set():
                        answer.update(code=code, error=error)
                        done.set()

        def page(self, status, text):
            self.send_response(status)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(('<!doctype html><meta charset="utf-8"><p style="font: 20px sans-serif">%s</p>' % text)
                             .encode('utf-8'))

        def log_message(self, *args):
            pass

    try:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError:
        raise SignInError('Port %d is taken: is another sign-in still waiting?' % PORT)
    server.answer, server.done = answer, done
    threading.Thread(target=server.serve_forever, args=(0.2,), daemon=True).start()
    return server


def stop(listener):
    """Frees the port; a wait on it ends."""
    listener.shutdown()
    listener.server_close()
    listener.done.set()


def wait_for_code(listener, timeout=300):
    """Waits at most timeout seconds for the redirect listen() is open for, then frees the port. Returns its code."""
    try:
        listener.done.wait(timeout)
    finally:
        stop(listener)
    got = listener.answer
    if not got:
        raise SignInError('No answer from Spotify in time. Try again.')
    if got['error']:   # OAuth's error codes are like access_denied; anything else isn't shown
        raise SignInError('Spotify said: %s' % got['error'] if re.fullmatch(r'[a-z_]{1,64}', got['error']) else
                          'Spotify turned the sign-in down. Try again.')
    if not got['code']:
        raise SignInError('The answer from Spotify had no code. Try again.')
    return got['code']


def said(body, *hide):
    """Spotify's error reply as short, printable text for the terminal, without the code or the verifier."""
    text = body.decode('utf-8', 'replace')
    try:
        answer = json.loads(text)
        text = ': '.join(str(answer[k]) for k in ('error', 'error_description') if answer.get(k))
    except (ValueError, AttributeError, TypeError):
        pass
    text = re.sub(r'[^\x20-\x7e]', '', text)
    for secret in hide:
        if secret:
            text = text.replace(secret, '...')
    return text[:200] or 'no reason given'


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
        raise SignInError('Spotify turned down the sign-in (%d): %s' % (e.code, said(e.read(4096), code, verifier)))
    token = answer.get('refresh_token') if isinstance(answer, dict) else None
    if not isinstance(token, str) or not re.fullmatch(r'[\x21-\x7e]+', token):   # one line, so it sets no other key
        raise SignInError('Spotify gave no usable refresh token.')
    return token


def main():
    args = sys.argv[1:]
    path = os.path.abspath(args[args.index('--config') + 1]) if '--config' in args else os.path.join(ROOT, 'config.properties')
    if not os.path.exists(path):
        sys.exit('No %s yet: build once (python3 tizen/build.py), then add spotify_client_id there.' % path)
    client = webapp.read_values(path).get('spotify_client_id', '')
    if not client:
        sys.exit('Add spotify_client_id to %s first: the app on developer.spotify.com/dashboard, with the redirect '
                 'URI %s.' % (os.path.basename(path), REDIRECT))

    url, verifier, state = start(client)
    try:
        listener = listen(state)   # before the browser, so an instant redirect finds it and a taken port stops here
    except SignInError as e:
        sys.exit(str(e))
    print('Opening Spotify in the browser. If it does not open, go to:\n%s\n' % url)
    webbrowser.open(url)
    try:
        token = refresh_token(client, wait_for_code(listener), verifier)
    except SignInError as e:
        sys.exit(str(e))

    webapp.write_values(path, {'spotify_refresh_token': token})
    print('Signed in: spotify_refresh_token is in %s. Build and install again:\n'
          '  python3 tizen/build.py --sign <profile> && python3 tizen/install.py <TV IP>' % os.path.basename(path))


if __name__ == '__main__':
    main()
