"""The setup page for Frame TV, on this Mac (AUG-1478): every setting in config.properties, Spotify's sign-in, and
"Build and install".

Usage: python3 tools/setup.py [--config PATH] [--port N] [--no-browser]

It serves a page on 127.0.0.1 and opens it in the browser. The page's groups, keys and explanations are read from
config.example.properties, so a new setting there shows up here by itself. Saving keeps the file's comments and
order. Only Python's standard library.

"Upload config" on the TV (AUG-1521): with tv_ip set, it also listens on this Mac's address on the TV's network, on
port 8890, for that one call, with setup_key. The page shows what came and writes it into the file when accepted.
"""
import glob
import http.server
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import spotify_login  # noqa: E402
import translate  # noqa: E402
import webapp  # noqa: E402

EXAMPLE = os.path.join(ROOT, 'config.example.properties')
PAGE = os.path.join(ROOT, 'tools', 'setup.html')
SECRET = re.compile(r'_(token|key|secret)$')
FROM_TV_PORT = 8890
NOT_FROM_TV = ('tv_ip', 'sign_profile', 'setup_key')   # the Mac's own, not the TV's
KEY_LINE = re.compile(r'^\s*([a-z_]+)\s*=(.*)$')
# What each module's switch needs before it can be on (as Modules in web/data.js; Stasera has a default address).
NEEDS = {'stasera': [], 'youtube': ['youtube_client_id', 'youtube_client_secret'],
         'github': ['github_token'], 'vercel': ['vercel_token'],
         'home_assistant': ['home_assistant_url', 'home_assistant_token'],
         'spotify': ['spotify_client_id', 'spotify_refresh_token'], 'art': ['art_url']}


def schema():
    """config.example.properties as [{title, keys: [{key, help, kind, choices?, example}], note}]."""
    sections, section, comments = [], None, []
    with open(EXAMPLE, encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            header = re.match(r'^# --- (.+?) ---$', line)
            key = KEY_LINE.match(line)
            if header:
                section = {'title': header.group(1), 'keys': [], 'note': ''}
                sections.append(section)
                comments = []
            elif section is None:
                continue
            elif line.startswith('#'):
                comments.append(line[2:] if line.startswith('# ') else '')
            elif key:
                section['keys'].append(dict(field(key.group(1)), help=prose(comments), example=key.group(2).strip()))
                comments = []
            elif not line.strip():
                if comments:   # comments that end in a blank line belong to the section, not a key
                    section['note'] = prose(comments)
                comments = []
        if section is not None and comments:
            section['note'] = prose(comments)
    return sections


def prose(lines):
    """Comment lines as paragraphs: a bare # starts a new one."""
    paras, cur = [], []
    for line in lines:
        if line:
            cur.append(line)
        elif cur:
            paras.append(' '.join(cur))
            cur = []
    if cur:
        paras.append(' '.join(cur))
    return '\n\n'.join(paras)


def field(key):
    if key in webapp.SWITCHES.values():
        return {'key': key, 'kind': 'switch', 'needs': NEEDS.get(key, [])}
    if key == 'language':
        return {'key': key, 'kind': 'choice', 'choices': ['auto'] + translate.languages()}
    if key == 'temperature':
        return {'key': key, 'kind': 'choice', 'choices': ['auto', 'C', 'F']}
    if key == 'sign_profile':
        return {'key': key, 'kind': 'choice', 'choices': [''] + profiles()}
    if SECRET.search(key):
        return {'key': key, 'kind': 'secret'}
    return {'key': key, 'kind': 'text'}


def profiles():
    """The certificate profiles of Samsung's Tizen tools (tizen-studio-data/ here, or Tizen Studio's in the home)."""
    names = []
    for path in glob.glob(os.path.join(ROOT, 'tizen-studio-data', 'profile', 'profiles.xml')) + \
            glob.glob(os.path.expanduser('~/tizen-studio-data/profile/profiles.xml')):
        with open(path, encoding='utf-8') as f:
            names += [n for n in re.findall(r'<profile name="([^"]+)"', f.read()) if n not in names]
    return names


def read(path):
    """The file's values; without the file, the example's (what saving starts from)."""
    return webapp.read_values(path if os.path.exists(path) else EXAMPLE)


def write(path, values):
    """Sets each key on its own line where it is; a key the file lacks goes after the one before it in the example."""
    if not os.path.exists(path):
        shutil.copy(EXAMPLE, path)
    with open(path, encoding='utf-8') as f:
        lines = f.readlines()
    order = [k['key'] for s in schema() for k in s['keys']]

    def where(key):
        for i, line in enumerate(lines):
            m = KEY_LINE.match(line)
            if m and m.group(1) == key:
                return i
        return -1

    for key, value in values.items():
        line = '%s=%s\n' % (key, value)
        i = where(key)
        if i >= 0:
            lines[i] = line
            continue
        at = len(lines)
        n = order.index(key) if key in order else len(order)
        for prev in reversed(order[:n]):
            if where(prev) >= 0:
                at = where(prev) + 1
                break
        else:
            for nxt in order[n + 1:]:
                if where(nxt) >= 0:
                    at = where(nxt)
                    break
        if at == len(lines) and lines and not lines[-1].endswith('\n'):
            lines[-1] += '\n'
        lines.insert(at, line)
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(lines)


def switched_on_without(values):
    """Sentences for a module switched on without what it needs."""
    out = []
    for switch, needs in NEEDS.items():
        missing = [k for k in needs if values.get(switch) == 'true' and not values.get(k)]
        if missing:
            out.append('%s can only be on with %s' % (switch, ' and '.join(missing)))
    return out


def clean(values):
    """The page's values as the file's: known keys only, trimmed, on one line."""
    known = set(k['key'] for s in schema() for k in s['keys'])
    out = {}
    for key, value in values.items():
        if key in known:
            out[key] = re.sub(r'\s+', ' ', str(value)).strip()
    return out


def from_tv(settings):
    """What the TV sent ({name in config.js: value}) as the file's values; unknown names are left out."""
    known = [k['key'] for s in schema() for k in s['keys'] if k['key'] not in NOT_FROM_TV]
    names = {re.sub(r'_([a-z])', lambda m: m.group(1).upper(), k): k for k in known}
    out = {}
    for name, v in settings.items():
        key = names.get(name)
        if not key:
            continue
        if isinstance(v, bool):
            v = 'true' if v else 'false'
        elif v is None:
            v = ''
        elif isinstance(v, list):
            v = ','.join(str(x) for x in v)
        elif isinstance(v, (int, float)):
            v = str(v)
        elif not isinstance(v, str):
            continue
        out[key] = v
    return clean(out)


def address_towards(ip):
    """This Mac's address on the network that reaches ip, or None (nothing is sent)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect((ip, 9))
            return s.getsockname()[0]
    except OSError:
        return None


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port, path):
        super().__init__(('127.0.0.1', port), Handler)
        self.config = path
        self.key = secrets.token_urlsafe(24)   # a page on another site can't read it, so can't call the API
        self.spotify = None
        self.busy = threading.Lock()
        self.tv = None        # the listener for "Upload config"
        self.pending = None   # what the TV sent: {values, at}

    def listen_for_tv(self):
        """The address the TV sends to, listening there; None without tv_ip or when the port is taken."""
        ip = address_towards(read(self.config).get('tv_ip', ''))
        if self.tv and self.tv.server_address[0] == ip:
            return self.tv.url
        if self.tv:
            self.tv.shutdown()
            self.tv.server_close()
            self.tv = None
        if not ip:
            return None
        try:
            self.tv = FromTVServer(ip, self)
        except OSError as e:
            print('"Upload config" is off: %s:%d is taken (%s).' % (ip, FROM_TV_PORT, e), flush=True)
            return None
        threading.Thread(target=self.tv.serve_forever, daemon=True).start()
        return self.tv.url


class FromTVServer(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, ip, setup):
        super().__init__((ip, FROM_TV_PORT), FromTV)
        self.setup = setup
        self.url = 'http://%s:%d' % (ip, FROM_TV_PORT)


class FromTV(http.server.BaseHTTPRequestHandler):
    """The TV's "Upload config": one POST, with setup_key in the body (text/plain, so the TV skips the preflight)."""
    server: FromTVServer

    def log_message(self, *args):
        pass

    def reply(self, status, body=None):
        data = json.dumps(body or {}).encode()
        self.send_response(status)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.reply(204)

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != '/api/from-tv':
            return self.reply(404, {'error': 'not found'})
        size = int(self.headers.get('Content-Length') or 0)
        if size > 256 * 1024:
            return self.reply(413, {'error': 'too large'})
        try:
            body = json.loads(self.rfile.read(size) or b'{}')
        except ValueError:
            return self.reply(400, {'error': 'not JSON'})
        key = read(self.server.setup.config).get('setup_key', '')
        sent = body.get('key') if isinstance(body, dict) else None
        if not key or not isinstance(sent, str) or not secrets.compare_digest(sent, key):
            return self.reply(403, {'error': 'wrong key'})
        if not isinstance(body.get('settings'), dict):
            return self.reply(400, {'error': 'no settings'})
        self.server.setup.pending = {'values': from_tv(body['settings']), 'at': time.time()}
        print('The TV sent its settings: accept them on the setup page.', flush=True)
        self.reply(200, {'ok': True})


class Handler(http.server.BaseHTTPRequestHandler):
    server: Server

    def log_message(self, *args):
        pass

    def allowed(self):
        host = (self.headers.get('Host') or '').split(':')[0]
        return host in ('127.0.0.1', 'localhost')   # not a name that was pointed here (DNS rebinding)

    def send(self, status, body, kind='application/json'):
        data = body if isinstance(body, bytes) else (json.dumps(body) if kind == 'application/json' else body).encode()
        self.send_response(status)
        self.send_header('Content-Type', kind + '; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.allowed():
            return self.send(403, {'error': 'forbidden'})
        url = urllib.parse.urlparse(self.path)
        if url.path == '/':
            with open(PAGE, encoding='utf-8') as f:
                return self.send(200, f.read().replace('{{KEY}}', self.server.key), 'text/html')
        if url.path == '/api/from-tv' and self.headers.get('X-Setup') == self.server.key:
            return self.send(200, self.from_tv_changes())
        if url.path == '/api/config' and self.headers.get('X-Setup') == self.server.key:
            values = read(self.server.config)
            sections = schema()
            for s in sections:
                for k in s['keys']:
                    k['value'] = values.get(k['key'], '')
            return self.send(200, {'path': self.server.config, 'exists': os.path.exists(self.server.config),
                                   'sections': sections, 'problems': webapp.problems(values)})
        self.send(404, {'error': 'not found'})

    def do_POST(self):
        if not self.allowed() or self.headers.get('X-Setup') != self.server.key:
            return self.send(403, {'error': 'forbidden'})
        size = int(self.headers.get('Content-Length') or 0)
        try:
            body = json.loads(self.rfile.read(size) or b'{}')
        except ValueError:
            return self.send(400, {'error': 'not JSON'})
        route = urllib.parse.urlparse(self.path).path
        if route == '/api/config':
            return self.save(body.get('values') or {})
        if route == '/api/spotify/start':
            return self.spotify_start()
        if route == '/api/spotify/wait':
            return self.spotify_wait()
        if route == '/api/install':
            return self.install()
        if route == '/api/from-tv/accept':
            return self.from_tv_accept()
        if route == '/api/from-tv/discard':
            self.server.pending = None
            return self.send(200, {'ok': True})
        self.send(404, {'error': 'not found'})

    def save(self, values):
        values = clean(values)
        if not values.get('setup_key'):
            values.pop('setup_key', None)   # a page loaded before the build made one
        wrong = webapp.problems(values) + switched_on_without(values)
        if wrong:
            return self.send(400, {'problems': wrong})
        write(self.server.config, values)
        self.send(200, {'ok': True})

    def from_tv_changes(self):
        """What the TV sent that differs from the file: {at, changes: [{key, file, tv, secret}]}, or {}."""
        pending = self.server.pending
        if not pending:
            return {}
        values = read(self.server.config)
        changes = [{'key': k, 'file': values.get(k, ''), 'tv': v, 'secret': bool(SECRET.search(k))}
                   for k, v in pending['values'].items() if v != values.get(k, '')]
        return {'at': pending['at'], 'changes': changes}

    def from_tv_accept(self):
        pending = self.server.pending
        if not pending:
            return self.send(400, {'error': 'Nothing from the TV.'})
        values = read(self.server.config)
        values.update(pending['values'])
        for switch, needs in NEEDS.items():   # a switch the file can't have on: it stays as the file has it
            if switch in pending['values'] and values.get(switch) == 'true' and not all(values.get(k) for k in needs):
                del pending['values'][switch]
        wrong = webapp.problems(values)
        if wrong:
            return self.send(400, {'problems': wrong})
        write(self.server.config, pending['values'])
        self.server.pending = None
        self.send(200, {'ok': True})

    def spotify_start(self):
        client = read(self.server.config).get('spotify_client_id', '')
        if not client:
            return self.send(400, {'error': 'Save spotify_client_id first.'})
        url, verifier, state = spotify_login.start(client)
        self.server.spotify = (client, verifier, state)
        self.send(200, {'url': url})

    def spotify_wait(self):
        if not self.server.spotify:
            return self.send(400, {'error': 'Start the sign-in first.'})
        client, verifier, state = self.server.spotify
        try:
            token = spotify_login.refresh_token(client, spotify_login.wait_for_code(state, timeout=300), verifier)
        except spotify_login.SignInError as e:
            return self.send(400, {'error': str(e)})
        finally:
            self.server.spotify = None
        write(self.server.config, {'spotify_refresh_token': token})
        self.send(200, {'token': token})

    def install(self):
        """Builds and installs, sending the output as it comes; the last line says how it went."""
        values = read(self.server.config)
        ip, profile = values.get('tv_ip', ''), values.get('sign_profile', '')
        if not ip or not profile:
            return self.send(400, {'error': 'Save tv_ip and sign_profile first.'})
        if not self.server.busy.acquire(blocking=False):
            return self.send(409, {'error': 'A build is already running.'})
        try:
            setup = []
            url = self.server.listen_for_tv()
            if url:
                if not values.get('setup_key'):
                    write(self.server.config, {'setup_key': secrets.token_urlsafe(24)})
                setup = ['--setup', url]
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            steps = [[sys.executable, os.path.join(ROOT, 'tizen', 'build.py'), '--config', self.server.config,
                      '--sign', profile] + setup,
                     [sys.executable, os.path.join(ROOT, 'tizen', 'install.py'), ip]]
            for cmd in steps:
                self.wfile.write(('$ %s\n' % ' '.join(os.path.relpath(c, ROOT) if c.startswith(ROOT) else
                                                      os.path.basename(c) if os.path.isabs(c) else c
                                                      for c in cmd)).encode())
                run = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                       stdin=subprocess.DEVNULL)
                for line in run.stdout:
                    self.wfile.write(line)
                    self.wfile.flush()
                if run.wait() != 0:
                    self.wfile.write(b'\n@@FAILED\n')
                    return
            self.wfile.write(b'\n@@DONE\n')
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            self.server.busy.release()


def main():
    args = sys.argv[1:]
    path = os.path.abspath(args[args.index('--config') + 1]) if '--config' in args else \
        os.path.join(ROOT, 'config.properties')
    port = int(args[args.index('--port') + 1]) if '--port' in args else 8899
    for p in range(port, port + 10):
        try:
            server = Server(p, path)
            break
        except OSError:
            continue
    else:
        sys.exit('No free port from %d.' % port)
    url = 'http://127.0.0.1:%d/' % server.server_address[1]
    print('Frame TV setup: %s (%s). Ctrl-C stops it.' % (url, os.path.relpath(path, ROOT)), flush=True)
    tv = server.listen_for_tv()
    if tv:
        print('"Upload config" on the TV: %s' % tv, flush=True)
    if '--no-browser' not in args:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()


if __name__ == '__main__':
    main()
