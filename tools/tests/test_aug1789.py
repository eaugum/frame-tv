"""AUG-1789: the Spotify sign-in on the Mac takes only the answer with its own state, can't be held up by a connection
that sends nothing, and has its port open before the browser goes to Spotify.

Everything stays on 127.0.0.1, on a free port in place of 8888; the token endpoint and the browser are fakes.
"""
import http.client
import io
import json
import os
import re
import shutil
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
from unittest import mock

sys.dont_write_bytecode = True

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import setup  # noqa: E402
import spotify_login  # noqa: E402
import webapp  # noqa: E402

STATE = 'FAKE-STATE-1789'
CODE = 'FAKE-CODE-1789'
TOKEN = 'FAKE-REFRESH-1789'


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def get(port, path, timeout=5):
    """A GET to 127.0.0.1:port; its status (http.client, so a patched urllib can't touch it)."""
    c = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
    try:
        c.request('GET', path)
        r = c.getresponse()
        r.read()
        return r.status
    finally:
        c.close()


def bound(port):
    with socket.socket() as s:
        return s.connect_ex(('127.0.0.1', port)) == 0


def token_endpoint(req, timeout=None):
    """Stands in for accounts.spotify.com/api/token: checks the code and gives a fake refresh token."""
    assert req.full_url == 'https://accounts.spotify.com/api/token', req.full_url
    assert urllib.parse.parse_qs(req.data.decode())['code'] == [CODE]
    return io.BytesIO(json.dumps({'refresh_token': TOKEN}).encode())


class Port(unittest.TestCase):
    def setUp(self):
        self.port = free_port()
        patch = mock.patch.object(spotify_login, 'PORT', self.port)
        patch.start()
        self.addCleanup(patch.stop)

    def waiting(self, timeout):
        """Listens for STATE and waits in a thread; returns (thread, result)."""
        listener = spotify_login.listen(STATE)
        result = {}

        def run():
            started = time.monotonic()
            try:
                result['code'] = spotify_login.wait_for_code(listener, timeout=timeout)
            except spotify_login.SignInError as e:
                result['error'] = str(e)
            result['seconds'] = time.monotonic() - started

        t = threading.Thread(target=run, daemon=True)
        t.start()
        return t, result


class Callback(Port):
    def test_only_the_answer_with_this_state_counts(self):
        t, result = self.waiting(timeout=10)
        foreign = ['/', '/other?state=%s&code=x' % STATE, '/callback', '/callback?code=x', '/callback?error=x',
                   '/callback?state=&code=x', '/callback?state=wrong&code=x', '/callback?state=%s0&code=x' % STATE,
                   '/callback?state=wrong&error=%1b%5b31mPWNED%0a']
        for path in foreign:
            with self.subTest(path):
                self.assertGreaterEqual(get(self.port, path), 400)
        time.sleep(0.3)
        self.assertTrue(t.is_alive(), result)   # still waiting
        self.assertEqual(get(self.port, '/callback?code=%s&state=%s' % (CODE, STATE)), 200)
        t.join(5)
        self.assertEqual(result.get('code'), CODE)
        self.assertFalse(bound(self.port))

    def test_an_error_with_this_state_ends_it_with_clean_text(self):
        for error, shown in (('access_denied', 'access_denied'), ('%1b%5b31mPWNED%0a', None), ('A' * 500, None)):
            with self.subTest(error):
                t, result = self.waiting(timeout=10)
                self.assertEqual(get(self.port, '/callback?error=%s&state=%s' % (error, STATE)), 200)
                t.join(5)
                text = result.get('error', '')
                self.assertTrue(text)
                self.assertRegex(text, r'^[\x20-\x7e]{1,120}$')
                self.assertNotIn('PWNED', text)
                if shown:
                    self.assertIn(shown, text)
                self.assertFalse(bound(self.port))

    def test_a_correct_state_without_code_ends_it(self):
        t, result = self.waiting(timeout=10)
        get(self.port, '/callback?state=%s' % STATE)
        t.join(5)
        self.assertTrue(result.get('error'))
        self.assertNotIn('code', result)

    def test_a_silent_connection_does_not_hold_up_the_answer(self):
        t, result = self.waiting(timeout=10)
        silent = socket.create_connection(('127.0.0.1', self.port))
        self.addCleanup(silent.close)
        time.sleep(0.3)
        self.assertEqual(get(self.port, '/callback?code=%s&state=%s' % (CODE, STATE), timeout=3), 200)
        t.join(5)
        self.assertEqual(result.get('code'), CODE)
        self.assertLess(result['seconds'], 3)

    def test_a_silent_connection_does_not_hold_up_the_timeout(self):
        t, result = self.waiting(timeout=1)
        silent = socket.create_connection(('127.0.0.1', self.port))
        self.addCleanup(silent.close)
        t.join(4)
        self.assertFalse(t.is_alive())
        self.assertIn('in time', result.get('error', ''))
        self.assertLess(result['seconds'], 2)
        self.assertFalse(bound(self.port))

    def test_the_timeout_is_seconds_not_requests(self):
        t, result = self.waiting(timeout=3)
        for _ in range(40):
            get(self.port, '/favicon.ico')
        self.assertTrue(t.is_alive(), result)
        get(self.port, '/callback?code=%s&state=%s' % (CODE, STATE))
        t.join(5)
        self.assertEqual(result.get('code'), CODE)

    def test_a_taken_port(self):
        with socket.socket() as other:
            other.bind(('127.0.0.1', self.port))
            other.listen(1)
            with self.assertRaises(spotify_login.SignInError) as e:
                spotify_login.listen(STATE)
        self.assertIn(str(self.port), str(e.exception))


class Main(Port):
    """tools/spotify_login.py from the terminal, with a fake config, browser and token endpoint."""

    def setUp(self):
        super().setUp()
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        self.path = os.path.join(self.dir, 'config.properties')
        with open(self.path, 'w', encoding='utf-8') as f:
            f.write('spotify_client_id=fake-client-1789\n')

    def run_main(self, browser):
        out = io.StringIO()
        with mock.patch.object(sys, 'argv', ['spotify_login.py', '--config', self.path]), \
                mock.patch.object(spotify_login.webbrowser, 'open', side_effect=browser) as opened, \
                mock.patch.object(spotify_login.urllib.request, 'urlopen', side_effect=token_endpoint), \
                mock.patch('sys.stdout', out):
            try:
                spotify_login.main()
                exit_text = None
            except SystemExit as e:
                exit_text = str(e.code)
        return opened, out.getvalue(), exit_text

    def test_the_port_is_open_before_the_browser(self):
        seen = []

        def browser(url):
            seen.append(bound(self.port))
            state = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)['state'][0]
            # Spotify redirects at once when the app is already approved
            self.assertEqual(get(self.port, '/callback?code=%s&state=%s' % (CODE, state)), 200)

        opened, out, exit_text = self.run_main(browser)
        self.assertEqual(seen, [True])
        self.assertIsNone(exit_text)
        self.assertEqual(webapp.read_values(self.path)['spotify_refresh_token'], TOKEN)
        self.assertNotIn(CODE, out)
        self.assertNotIn(TOKEN, out)
        self.assertFalse(bound(self.port))

    def test_a_taken_port_stops_before_the_browser(self):
        with socket.socket() as other:
            other.bind(('127.0.0.1', self.port))
            other.listen(1)
            opened, out, exit_text = self.run_main(lambda url: None)
        opened.assert_not_called()
        self.assertIn('taken', exit_text)
        self.assertNotIn('spotify_refresh_token', webapp.read_values(self.path))


class SetupPage(Port):
    """The setup page's button: /api/spotify/start, then the browser, then /api/spotify/wait, on a real setup server."""

    def setUp(self):
        super().setUp()
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        self.path = os.path.join(self.dir, 'config.properties')
        with open(self.path, 'w', encoding='utf-8') as f:
            f.write('spotify_client_id=fake-client-1789\n')
        self.server = setup.Server(0, self.path)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        patch = mock.patch.object(spotify_login.urllib.request, 'urlopen', side_effect=token_endpoint)
        patch.start()
        self.addCleanup(patch.stop)

    def post(self, route):
        c = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=20)
        try:
            c.request('POST', route, body='{}', headers={'X-Setup': self.server.key, 'Content-Type': 'application/json'})
            r = c.getresponse()
            return r.status, json.loads(r.read() or b'{}')
        finally:
            c.close()

    def test_signing_in_from_the_page(self):
        status, body = self.post('/api/spotify/start')
        self.assertEqual(status, 200, body)
        self.assertTrue(bound(self.port))   # open before the page sends the browser to Spotify
        state = urllib.parse.parse_qs(urllib.parse.urlparse(body['url']).query)['state'][0]
        waited = {}
        t = threading.Thread(target=lambda: waited.update(answer=self.post('/api/spotify/wait')), daemon=True)
        t.start()
        get(self.port, '/callback?code=x&state=wrong')
        get(self.port, '/callback?code=%s&state=%s' % (CODE, state))
        t.join(10)
        self.assertEqual(waited['answer'], (200, {'token': TOKEN}))
        self.assertEqual(webapp.read_values(self.path)['spotify_refresh_token'], TOKEN)
        self.assertFalse(bound(self.port))

    def test_starting_again_frees_the_first_sign_in(self):
        self.assertEqual(self.post('/api/spotify/start')[0], 200)
        status, body = self.post('/api/spotify/start')
        self.assertEqual(status, 200, body)
        state = urllib.parse.parse_qs(urllib.parse.urlparse(body['url']).query)['state'][0]
        t = threading.Thread(target=lambda: get(self.port, '/callback?code=%s&state=%s' % (CODE, state)), daemon=True)
        t.start()
        self.assertEqual(self.post('/api/spotify/wait'), (200, {'token': TOKEN}))

    def test_a_taken_port_gives_no_url(self):
        with socket.socket() as other:
            other.bind(('127.0.0.1', self.port))
            other.listen(1)
            status, body = self.post('/api/spotify/start')
        self.assertEqual(status, 400)
        self.assertNotIn('url', body)
        self.assertIn('taken', body['error'])

    def test_two_starts_at_once_leave_one_sign_in_that_holds_the_port(self):
        real = spotify_login.listen

        def slow(state):   # widens the gap between looking at the pending sign-in and replacing it
            time.sleep(0.3)
            return real(state)

        with mock.patch.object(spotify_login, 'listen', side_effect=slow):
            answers = []
            starts = [threading.Thread(target=lambda: answers.append(self.post('/api/spotify/start')), daemon=True)
                      for _ in range(2)]
            for t in starts:
                t.start()
            for t in starts:
                t.join(10)
        self.assertEqual(sorted(a[0] for a in answers), [200, 200], answers)
        pending = self.server.spotify
        self.assertIsNotNone(pending)
        self.assertTrue(bound(self.port))
        spotify_login.stop(pending[2])
        self.assertFalse(bound(self.port))   # nothing else was left holding it


class TokenError(unittest.TestCase):
    """Spotify's error reply from the token endpoint reaches the terminal only as short, clean text."""

    def refused(self, body):
        fp = io.BytesIO(body)
        error = urllib.error.HTTPError('https://accounts.spotify.com/api/token', 400, 'Bad Request', {}, fp)
        with mock.patch.object(spotify_login.urllib.request, 'urlopen', side_effect=error), \
                self.assertRaises(spotify_login.SignInError) as e:
            spotify_login.refresh_token('fake-client-1789', CODE, 'FAKE-VERIFIER-1789')
        return str(e.exception), fp.tell()

    def assertClean(self, text):
        self.assertTrue(re.fullmatch(r'[\x20-\x7e]{1,260}', text), '%d chars: %r' % (len(text), text[:300]))
        self.assertNotIn(CODE, text)
        self.assertNotIn('FAKE-VERIFIER-1789', text)

    def test_the_json_error_is_shown_clean(self):
        text, _ = self.refused(json.dumps({'error': 'invalid_grant',
                                           'error_description': 'Invalid authorization code\x1b]52;c;eA==\x07\n'
                                                                'Signed in!'}).encode())
        self.assertClean(text)
        self.assertIn('invalid_grant', text)
        self.assertIn('Invalid authorization code', text)

    def test_a_body_that_is_not_json_is_cut_and_cleaned(self):
        text, read = self.refused(b'\x1b[31mPWNED\n\x1b[2J' + b'A' * (10 * 1024 * 1024))
        self.assertClean(text)
        self.assertLessEqual(read, 8192, 'read %d bytes' % read)

    def test_the_code_and_verifier_are_never_shown(self):
        for body in (('{"error": "invalid_grant", "error_description": "code %s verifier FAKE-VERIFIER-1789"}' % CODE)
                     .encode(), ('code=%s&code_verifier=FAKE-VERIFIER-1789' % CODE).encode(),
                     ('F\x1bAKE-CODE-1789 FAKE-VERI\nFIER-1789').encode()):
            with self.subTest(body):
                text, _ = self.refused(body)
                self.assertClean(text)


if __name__ == '__main__':
    unittest.main()
