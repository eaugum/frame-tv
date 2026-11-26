"""The setup page for Frame TV, on this Mac (AUG-1478): every setting in config.properties, Spotify's sign-in, and
"Build and install".

Usage: python3 tools/setup.py [--config PATH] [--port N] [--no-browser]

It serves a page on 127.0.0.1 and opens it in the browser. The page's groups, keys and explanations are read from
config.example.properties, so a new setting there shows up here by itself. Saving keeps the file's comments and
order. Only Python's standard library.

"Root on the TV" runs tools/root/root.sh (status, apply, restore) the same way, when tools/root/root.local.env
is there.

"Upload config" on the TV (AUG-1521): with tv_ip set, it also listens on this Mac's address on the TV's network, on
port 8890, for that one call: a one-time nonce, then the settings sealed with setup_key (AUG-1786, tools/seal.py). The
page shows what came and writes exactly that into the file when accepted.
"""
import glob
import hashlib
import http.server
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import seal  # noqa: E402
import spotify_login  # noqa: E402
import translate  # noqa: E402
import webapp  # noqa: E402

ROOT_SH = os.path.join(ROOT, 'tools', 'root', 'root.sh')
ROOT_ACTIONS = ('status', 'apply', 'restore')
PAGE = os.path.join(ROOT, 'tools', 'setup.html')
SECRET = re.compile(r'_(token|key|secret)$')
FROM_TV_PORT = 8890
SPOTIFY_LOCK = threading.Lock()   # guards Server.spotify: one sign-in, and its port, at a time
NOT_FROM_TV = ('tv_ip', 'sign_profile', 'setup_key')   # the Mac's own, not the TV's
KEY_LINE = re.compile(r'^\s*([a-z_]+)\s*=(.*)$')
# What each module's switch needs before it can be on (as Modules in web/data.js; Stasera has a default address).
NEEDS = {'stasera': [], 'youtube': ['youtube_client_id', 'youtube_client_secret'],
         'github': ['github_token'], 'vercel': ['vercel_token'],
         'home_assistant': ['home_assistant_url', 'home_assistant_token'],
         'spotify': ['spotify_client_id', 'spotify_refresh_token'], 'art': ['art_url']}
# Each address and the token the TV sends there (AUG-1787; the TV keeps a token to the address it came with).
TOKEN_AT = (('home_assistant_url', 'home_assistant_token'), ('art_url', 'art_key'), ('stasera_url', 'stasera_token'))
DEFAULT_AT = {'stasera_url': 'https://www.stasera.app'}   # an empty address in the file (as DEFAULTS in web/data.js)
ORIGIN = re.compile(r'^\s*(https?://[^/?#\\\s]+)(?:[/?#\\]|\s*$)', re.I)   # as Settings.origin in web/data.js
REMOVED = 'Removed: a new address needs the token again'
AGAIN = 'The TV sent again while this was shown: look at the list again before accepting.'
# "Upload config" (AUG-1786): what a request may take, and for how long.
UPLOAD_MAX = 256 * 1024     # bytes of body from the TV
PAGE_MAX = 1024 * 1024      # bytes of body from the page
BODY_SECONDS = 10           # to read a whole body
REQUEST_SECONDS = 15        # for the TV's whole request, headers and all
IDLE_SECONDS = 5            # without a byte, in the headers or the body
TV_CONNECTIONS = 8          # at once on the TV's port; more are closed at once
NONCE_SECONDS = 60          # a nonce is good for this long, and once
NONCES_KEPT = 16            # the newest ones; an older one goes


def schema():
    """config.example.properties as [{title, keys: [{key, help, kind, choices?, example}], note}]."""
    sections, section, comments = [], None, []
    with open(webapp.EXAMPLE, encoding='utf-8') as f:
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
        return {'key': key, 'kind': 'choice', 'choices': ['auto', 'en'] + translate.languages()}   # en: the source
    if key == 'temperature':
        return {'key': key, 'kind': 'choice', 'choices': ['auto', 'C', 'F']}
    if key == 'sign_profile':
        return {'key': key, 'kind': 'choice', 'choices': [''] + profiles()}
    if key == 'setup_key':   # made new at every install (AUG-1786); the page never has it
        return {'key': key, 'kind': 'fixed', 'text': 'New at every install'}
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
    return webapp.read_values(path if os.path.exists(path) else webapp.EXAMPLE)


def switched_on_without(values):
    """Sentences for a module switched on without what it needs."""
    out = []
    for switch, needs in NEEDS.items():
        missing = [k for k in needs if values.get(switch) == 'true' and not values.get(k)]
        if missing:
            out.append('%s can only be on with %s' % (switch, ' and '.join(missing)))
    return out


def plain_http(values):
    """Warnings for a token that goes to an http:// address: anyone on the way can read it."""
    return ['Warning: %s is http://, so %s goes there unencrypted. Use https:// if it has it (docs/modules.md).'
            % (url, token) for url, token in TOKEN_AT
            if values.get(token) and values.get(url, '').strip().lower().startswith('http://')]


def clean(values):
    """The page's values as the file's: known keys only, trimmed, on one line."""
    known = set(k['key'] for s in schema() for k in s['keys']) | set(webapp.NUMBERS)
    out = {}
    for key, value in values.items():
        if key in known:
            out[key] = re.sub(r'\s+', ' ', str(value)).strip()
    return out


def from_tv(settings):
    """What the TV sent ({name in config.js: value}) as the file's values; unknown names are left out."""
    known = [k['key'] for s in schema() for k in s['keys'] if k['key'] not in NOT_FROM_TV] + list(webapp.NUMBERS)
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


def origin(url):
    """An address's scheme, host and port, lower case; '' for one that can't be read."""
    m = ORIGIN.match(url or '')
    return m.group(1).lower() if m else ''


def masked(token):
    return '••••' + token[-4:]


def changes(file, tv):
    """What the TV sent that differs from the file, as [{key, file, tv, secret, token?}] (the raw values).

    An address the TV moved to another origin takes its token along only when the TV sent one for it (the TV sends a
    token only while it belongs to its address now). Otherwise the file's token is removed: it was for the old address.
    Those rows have token: 'removed' or 'kept'."""
    out = [{'key': k, 'file': file.get(k, ''), 'tv': v, 'secret': bool(SECRET.search(k))}
           for k, v in tv.items() if v != file.get(k, '')]
    for url, token in TOKEN_AT:
        if url not in tv:
            continue
        new, old = tv[url] or DEFAULT_AT.get(url, ''), file.get(url) or DEFAULT_AT.get(url, '')
        if origin(new) == origin(old) and (origin(new) or new == old):   # no origin is never the same one
            continue
        row = [c for c in out if c['key'] == token]
        if tv.get(token):
            for c in row:
                c['token'] = 'kept'
        elif file.get(token):
            out = [c for c in out if c['key'] != token] + [
                {'key': token, 'file': file[token], 'tv': '', 'secret': True, 'token': 'removed'}]
    return out


def body_of(handler, cap):
    """The request's body: Content-Length, a number from 0 to cap, read within BODY_SECONDS and with no pause of
    IDLE_SECONDS; else seal.Refused."""
    if handler.headers.get('Transfer-Encoding'):
        raise seal.Refused(411, 'length required')   # chunked isn't read here
    lengths = handler.headers.get_all('Content-Length') or []
    if not lengths:
        raise seal.Refused(411, 'length required')
    if len(lengths) > 1 or not re.fullmatch(r'[0-9]{1,12}', lengths[0].strip()):
        raise seal.Refused(400, 'bad length')
    left = int(lengths[0].strip())
    if left > cap:
        raise seal.Refused(413, 'too large')
    deadline, chunks, sock = time.monotonic() + BODY_SECONDS, [], handler.connection
    before = sock.gettimeout()
    try:
        while left:
            wait = deadline - time.monotonic()
            if wait <= 0:
                raise seal.Refused(408, 'too slow')
            sock.settimeout(min(wait, IDLE_SECONDS))
            try:
                chunk = handler.rfile.read1(min(left, 65536))
            except OSError:   # the time ran out, or the connection was cut
                raise seal.Refused(408, 'too slow')
            if not chunk:
                raise seal.Refused(400, 'cut short')
            chunks.append(chunk)
            left -= len(chunk)
    finally:
        try:
            sock.settimeout(before)
        except OSError:
            pass
    return b''.join(chunks)


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
        self.key = secrets.token_urlsafe(24)   # only in the link setup.py opens, never served
        self.spotify = None
        self.busy = threading.Lock()
        self.running = None   # 'install' or 'root' while busy, page or not
        self.ok = None        # how the last run ended
        self.tv = None        # the listener for "Upload config"
        self.pending = None   # what the TV sent: {values, at, upload}
        self.nonces = {}      # for "Upload config": {nonce: when it expires}, the newest NONCES_KEPT
        self.nonce_lock = threading.Lock()

    def nonce(self):
        """A new one-time nonce for the TV."""
        with self.nonce_lock:
            now = time.monotonic()
            self.nonces = {n: t for n, t in self.nonces.items() if t > now}
            while len(self.nonces) >= NONCES_KEPT:
                del self.nonces[min(self.nonces, key=self.nonces.get)]
            n = secrets.token_hex(16)
            self.nonces[n] = now + NONCE_SECONDS
            return n

    def use_nonce(self, n):
        """Whether n is one of ours, not used and not expired; it can't be used again either way."""
        with self.nonce_lock:
            expires = self.nonces.pop(n, None)
            return expires is not None and expires > time.monotonic()

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
    """The TV's port: at most TV_CONNECTIONS at once, each cut after REQUEST_SECONDS by one reaper thread."""
    daemon_threads = True

    def __init__(self, ip, setup):
        super().__init__((ip, FROM_TV_PORT), FromTV)
        self.setup = setup
        self.url = 'http://%s:%d' % (ip, FROM_TV_PORT)
        self.open = {}   # {socket: when it came}
        self.open_lock = threading.Lock()
        self.closed = threading.Event()
        threading.Thread(target=self.reap, daemon=True).start()

    def verify_request(self, request, client_address):
        with self.open_lock:
            if len(self.open) >= TV_CONNECTIONS:
                return False   # socketserver closes it now
            self.open[request] = time.monotonic()
            return True

    def shutdown_request(self, request):
        with self.open_lock:
            self.open.pop(request, None)
        super().shutdown_request(request)

    def reap(self):
        """Cuts what a TV, or anyone sending a byte now and then, keeps open past REQUEST_SECONDS."""
        while not self.closed.wait(min(0.5, REQUEST_SECONDS / 4)):
            with self.open_lock:
                late = [r for r, at in self.open.items() if time.monotonic() - at > REQUEST_SECONDS]
            for r in late:
                try:
                    r.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def server_close(self):
        self.closed.set()
        super().server_close()

    def handle_error(self, request, client_address):
        print('"Upload config": a request from %s was cut (%s).' % (client_address[0], sys.exc_info()[0].__name__),
              flush=True)


class FromTV(http.server.BaseHTTPRequestHandler):
    """The TV's "Upload config": GET a nonce, then POST the settings sealed with it and setup_key (tools/seal.py), as
    text/plain so the TV skips the preflight. The whole request has REQUEST_SECONDS, and IDLE_SECONDS without a byte."""
    server: FromTVServer
    timeout = IDLE_SECONDS

    def log_message(self, *args):
        pass

    def finish(self):
        try:
            super().finish()
        except OSError:
            pass

    def reply(self, status, body=None):
        data = json.dumps(body or {}).encode()
        self.send_response(status)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        if status >= 400:
            self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.reply(204)

    def key(self):
        return read(self.server.setup.config).get('setup_key', '')

    def do_GET(self):
        if urllib.parse.urlparse(self.path).path != '/api/from-tv/nonce':
            return self.reply(404, {'error': 'not found'})
        if not self.key():
            return self.reply(403, {'error': 'no setup_key: install from the setup page'})
        self.reply(200, {'v': seal.VERSION, 'nonce': self.server.setup.nonce()})

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != '/api/from-tv':
            return self.reply(404, {'error': 'not found'})
        try:
            body = json.loads(body_of(self, UPLOAD_MAX) or b'{}')
        except seal.Refused as e:
            return self.reply(e.status, {'error': str(e)})
        except (ValueError, RecursionError):   # RecursionError: nested too deep
            return self.reply(400, {'error': 'not JSON'})
        key = self.key()
        if isinstance(body, dict) and 'key' in body and 'v' not in body:
            return self.reply(403, {'error': 'an app from before AUG-1786: install it again'})
        try:
            if not key:
                raise seal.Refused(403, 'no setup_key')
            plain = seal.open_sealed(key, body)
            if not self.server.setup.use_nonce(body['n']):
                return self.reply(410, {'error': 'stale or used nonce'})
            settings = seal.settings_of(plain)
        except seal.Refused as e:
            return self.reply(e.status, {'error': str(e)})
        self.server.setup.pending = {'values': from_tv(settings), 'at': time.time(), 'upload': secrets.token_hex(16)}
        print('The TV sent its settings: accept them on the setup page.', flush=True)
        self.reply(200, {'ok': True})


class Handler(http.server.BaseHTTPRequestHandler):
    server: Server

    def log_message(self, *args):
        pass

    def allowed(self):
        host = (self.headers.get('Host') or '').split(':')[0]
        return host in ('127.0.0.1', 'localhost')   # not a name that was pointed here (DNS rebinding)

    def keyed(self):
        return self.allowed() and secrets.compare_digest(self.headers.get('X-Setup', '').encode(),
                                                         self.server.key.encode())

    def end_headers(self):   # every answer, errors too: no other page may frame this one
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy', "frame-ancestors 'none'")
        super().end_headers()

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
                return self.send(200, f.read(), 'text/html')
        if url.path.startswith('/api/') and not self.keyed():
            return self.send(403, {'error': 'forbidden'})
        if url.path == '/api/status':
            return self.send(200, {'running': self.server.running, 'ok': self.server.ok})
        if url.path == '/api/from-tv':
            return self.send(200, self.from_tv_changes())
        if url.path == '/api/config':
            values = read(self.server.config)
            sections = schema()
            for s in sections:
                for k in s['keys']:
                    k['value'] = '' if k['kind'] == 'fixed' else values.get(k['key'], '')
            return self.send(200, {'path': self.server.config, 'exists': os.path.exists(self.server.config),
                                   'sections': sections, 'problems': webapp.problems(values)})
        self.send(404, {'error': 'not found'})

    def do_POST(self):
        if not self.keyed():
            return self.send(403, {'error': 'forbidden'})
        try:
            body = json.loads(body_of(self, PAGE_MAX) or b'{}')
        except seal.Refused as e:
            self.close_connection = True
            return self.send(e.status, {'error': str(e)})
        except (ValueError, RecursionError):
            return self.send(400, {'error': 'not JSON'})
        if not isinstance(body, dict):
            return self.send(400, {'error': 'not an object'})
        route = urllib.parse.urlparse(self.path).path
        if route == '/api/config':
            return self.save(body.get('values') or {})
        if route == '/api/spotify/start':
            return self.spotify_start()
        if route == '/api/spotify/wait':
            return self.spotify_wait()
        if route == '/api/install':
            return self.install()
        if route == '/api/root':
            return self.root(body.get('action'))
        if route == '/api/from-tv/accept':
            return self.from_tv_accept(body)
        if route == '/api/from-tv/discard':
            pending = self.server.pending
            if pending and body.get('upload') != pending['upload']:
                return self.send(409, {'error': AGAIN})
            self.server.pending = None
            return self.send(200, {'ok': True})
        self.send(404, {'error': 'not found'})

    def save(self, values):
        """Writes the fields the page changed; the rest of the file stays as it is now."""
        values = clean(values)
        values.pop('setup_key', None)   # only an install makes one
        old = read(self.server.config)
        wrong = webapp.problems(dict(old, **values)) + switched_on_without(dict(old, **values))
        if wrong:
            return self.send(400, {'problems': wrong})
        if 'city' in values and values['city'] != old.get('city', '') and (old.get('latitude') or old.get('longitude')):
            values.update(latitude='', longitude='')   # a new city must not keep the old place (it would win)
        try:
            webapp.write_values(self.server.config, values)
        except (OSError, ValueError) as e:   # the file is as it was
            return self.send(400, {'problems': [str(e)]})
        for line in plain_http(dict(old, **values)):
            print(line, flush=True)
        self.send(200, {'ok': True})

    def from_tv_changes(self):
        """What the TV sent that differs from the file, as the page shows it:
        {at, upload, id, changes: [{key, file, tv, secret, token?}]}, or {}. id names exactly this list."""
        shown = self.shown()
        if not shown:
            return {}
        rows = []
        for c in shown['changes']:
            c = dict(c)
            if c.get('token'):   # a token that follows an address: only its last four
                c['file'] = masked(c['file']) if c['file'] else ''
                c['tv'] = REMOVED if c['token'] == 'removed' else masked(c['tv'])
            rows.append(c)
        return dict(shown, changes=rows)

    def shown(self):
        pending = self.server.pending
        if not pending:
            return None
        rows = changes(read(self.server.config), pending['values'])
        digest = hashlib.sha256(json.dumps([pending['upload'], rows], sort_keys=True).encode()).hexdigest()[:32]
        return {'at': pending['at'], 'upload': pending['upload'], 'id': digest, 'changes': rows}

    def from_tv_accept(self, body):
        """Writes the list the page showed (its id), and nothing when another came or the file changed since."""
        shown = self.shown()
        if not shown:
            return self.send(400, {'error': 'Nothing from the TV.'})
        if body.get('upload') != shown['upload']:
            return self.send(409, {'error': AGAIN})
        if body.get('id') != shown['id']:
            return self.send(409, {'error': 'The file changed while this was shown: look at the list again before '
                                            'accepting.'})
        file, write = read(self.server.config), {c['key']: c['tv'] for c in shown['changes']}
        values = dict(file, **write)
        for switch, needs in NEEDS.items():   # a switch the file can't have on: it stays as the file has it
            if switch in write and values.get(switch) == 'true' and not all(values.get(k) for k in needs):
                del write[switch]
        wrong = webapp.problems(dict(file, **write))
        if wrong:
            return self.send(400, {'problems': wrong})
        try:
            webapp.write_values(self.server.config, write)
        except (OSError, ValueError) as e:
            return self.send(400, {'problems': [str(e)]})
        self.server.pending = None
        self.send(200, {'ok': True})

    def spotify_start(self):
        client = read(self.server.config).get('spotify_client_id', '')
        if not client:
            return self.send(400, {'error': 'Save spotify_client_id first.'})
        url, verifier, state = spotify_login.start(client)
        with SPOTIFY_LOCK:
            if self.server.spotify:   # a sign-in started again frees the port of the one before
                spotify_login.stop(self.server.spotify[2])
                self.server.spotify = None
            try:   # before the page sends the browser to Spotify
                self.server.spotify = (client, verifier, spotify_login.listen(state))
            except spotify_login.SignInError as e:
                return self.send(400, {'error': str(e)})
        self.send(200, {'url': url})

    def spotify_wait(self):
        with SPOTIFY_LOCK:
            pending = self.server.spotify
        if not pending:
            return self.send(400, {'error': 'Start the sign-in first.'})
        client, verifier, listener = pending
        try:
            token = spotify_login.refresh_token(client, spotify_login.wait_for_code(listener, timeout=300), verifier)
        except spotify_login.SignInError as e:
            return self.send(400, {'error': str(e)})
        finally:
            with SPOTIFY_LOCK:
                if self.server.spotify is pending:
                    self.server.spotify = None
        try:
            webapp.write_values(self.server.config, {'spotify_refresh_token': token})
        except (OSError, ValueError) as e:   # names the file or the key, never the token
            return self.send(400, {'error': 'Signed in, but the token could not be saved: %s' % e})
        self.send(200, {'token': token})

    def run(self, steps):
        """Runs the commands one after another, sending the output as it comes; the last line says how it went.
        A page that goes away doesn't stop them: their output is still read (a full pipe would stall them), not sent.
        True when every command ended well."""
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        page = True

        def out(data):
            nonlocal page
            try:
                if page:
                    self.wfile.write(data)
                    self.wfile.flush()
            except OSError:   # the page is gone
                page = False

        for cmd in steps:
            out(('$ %s\n' % ' '.join(os.path.relpath(c, ROOT) if c.startswith(ROOT) else
                                     os.path.basename(c) if os.path.isabs(c) else c for c in cmd)).encode())
            with subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  stdin=subprocess.DEVNULL) as run:   # waits for it, and closes the pipe
                for line in run.stdout:
                    out(line)
            if run.returncode != 0:
                out(b'\n@@FAILED\n')
                return False
        out(b'\n@@DONE\n')
        return True

    def install(self):
        """Builds and installs."""
        values = read(self.server.config)
        ip, profile = values.get('tv_ip', ''), values.get('sign_profile', '')
        if not ip or not profile:
            return self.send(400, {'error': 'Save tv_ip and sign_profile first.'})
        if not self.server.busy.acquire(blocking=False):
            return self.send(409, {'error': 'Something is already running.'})
        self.server.running, self.server.ok = 'install', None
        try:
            url = self.server.listen_for_tv()
            setup = ['--setup', url] if url else []   # build.py makes a new setup_key: the one before stops working
            self.server.ok = self.run([[sys.executable, os.path.join(ROOT, 'tizen', 'build.py'), '--config',
                                        self.server.config, '--sign', profile] + setup,
                                       [sys.executable, os.path.join(ROOT, 'tizen', 'install.py'), ip]])
        except (BrokenPipeError, ConnectionResetError):   # gone before anything started
            pass
        finally:
            self.server.running = None
            self.server.busy.release()

    def root(self, action):
        """tools/root/root.sh with one of its own actions; nothing else can be passed through."""
        if action not in ROOT_ACTIONS:
            return self.send(400, {'error': 'Unknown action.'})
        if not os.path.exists(os.path.join(ROOT, 'tools', 'root', 'root.local.env')):
            return self.send(400, {'error': 'Copy tools/root/root.example.env to root.local.env and fill it in first.'})
        if not self.server.busy.acquire(blocking=False):
            return self.send(409, {'error': 'Something is already running.'})
        self.server.running, self.server.ok = 'root', None
        try:
            self.server.ok = self.run([['/bin/sh', ROOT_SH, action]])
        except (BrokenPipeError, ConnectionResetError):   # gone before anything started
            pass
        finally:
            self.server.running = None
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
    url = 'http://127.0.0.1:%d/#key=%s' % (server.server_address[1], server.key)   # the page's only way to the key
    print('Frame TV setup: %s (%s). Ctrl-C stops it.' % (url, os.path.relpath(path, ROOT)), flush=True)
    for line in plain_http(read(path)):
        print(line, flush=True)
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
