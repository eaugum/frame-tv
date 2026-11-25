"""AUG-1790: the setup page's lock, saving, language, key and frame headers.

Fake configs and fake commands in temporary folders (no city, so nothing is looked up); the servers listen on
127.0.0.1 and nothing leaves this Mac. The real build, install.py and root.sh are never run.
"""
import http.client
import io
import json
import os
import shutil
import socket
import sys
import tempfile
import textwrap
import threading
import time
import unittest
from unittest import mock

sys.dont_write_bytecode = True

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import setup  # noqa: E402
import webapp  # noqa: E402

# Stand-ins for build.py, install.py and root.sh: a line, then (after the page has gone) more output than a pipe holds,
# then they wait for "go" in their folder. SIGALRM ends them in any case, so nothing is left behind.
FAKE_BUILD = textwrap.dedent('''\
    import os, signal, sys, time
    signal.alarm(30)
    print('building', flush=True)
    while not os.path.exists('closed'):
        time.sleep(0.05)
    for _ in range(4000):
        sys.stdout.write('x' * 99 + '\\n')
    sys.stdout.flush()
    open('wrote', 'w').close()
    while not os.path.exists('go'):
        time.sleep(0.05)
''')
FAKE_INSTALL = "open('installed', 'w').close()\nprint('install completed')\n"
FAKE_ROOT = textwrap.dedent('''\
    echo start
    while [ ! -f closed ]; do sleep 0.05; done
    i=0; while [ $i -lt 4000 ]; do echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx; i=$((i+1)); done
    : > wrote
    n=0; while [ ! -f go ] && [ $n -lt 600 ]; do sleep 0.05; n=$((n+1)); done
    echo "$1" > rooted
''')


def wait_for(test, seconds=10):
    end = time.time() + seconds
    while time.time() < end:
        if test():
            return True
        time.sleep(0.05)
    return False


class Live(unittest.TestCase):
    """A real setup server on 127.0.0.1 with a fake config and a fake repo for the commands."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.path = os.path.join(self.dir, 'config.properties')
        webapp.write_values(self.path, {'tv_ip': '192.0.2.10', 'sign_profile': 'fake-1790', 'name': 'Ada'})
        self.repo = os.path.join(self.dir, 'repo')
        for rel, text in (('tizen/build.py', FAKE_BUILD), ('tizen/install.py', FAKE_INSTALL),
                          ('tools/root/root.sh', FAKE_ROOT), ('tools/root/root.local.env', '')):
            os.makedirs(os.path.dirname(os.path.join(self.repo, rel)), exist_ok=True)
            with open(os.path.join(self.repo, rel), 'w') as f:
                f.write(text)
        for patch in (mock.patch.object(setup, 'ROOT', self.repo),
                      mock.patch.object(setup, 'ROOT_SH', os.path.join(self.repo, 'tools', 'root', 'root.sh')),
                      mock.patch.object(setup.Server, 'listen_for_tv', return_value=None)):
            patch.start()
            self.addCleanup(patch.stop)
        self.server = setup.Server(0, self.path)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.addCleanup(lambda: open(os.path.join(self.repo, 'go'), 'w').close())   # no stand-in waits on

    def request(self, method, path, body=None, key=True, host=None):
        """(status, headers, body bytes)."""
        c = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=10)
        headers = {'Content-Type': 'application/json'}
        if key is True:
            headers['X-Setup'] = self.server.key
        elif key:
            headers['X-Setup'] = key
        if host:
            headers['Host'] = host
        try:
            c.request(method, path, json.dumps(body) if body is not None else None, headers)
            r = c.getresponse()
            return r.status, r.headers, r.read()
        finally:
            c.close()

    def answer(self, route, body):
        """Only the status: a run that was let through would stream until it ends."""
        c = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=10)
        try:
            c.request('POST', route, json.dumps(body), {'X-Setup': self.server.key})
            return c.getresponse().status
        finally:
            c.close()

    def status(self):
        return json.loads(self.request('GET', '/api/status')[2])

    def start_and_leave(self, route, body):
        """Starts a run the way the page does, reads its first line, then goes away as a closed tab does."""
        s = socket.create_connection(('127.0.0.1', self.server.server_address[1]), timeout=10)
        data = json.dumps(body).encode()
        s.sendall(('POST %s HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Setup: %s\r\nContent-Type: application/json\r\n'
                   'Content-Length: %d\r\n\r\n' % (route, self.server.key, len(data))).encode() + data)
        got = b''
        while b'$ ' not in got:
            chunk = s.recv(4096)
            self.assertTrue(chunk, 'the run did not start')
            got += chunk
        self.assertIn(b'200', got.split(b'\r\n')[0])
        s.close()
        open(os.path.join(self.repo, 'closed'), 'w').close()

    def file(self, name):
        return os.path.exists(os.path.join(self.repo, name))


class Lock(Live):
    def assertHeldUntilDone(self, route, body, name, result):
        self.start_and_leave(route, body)
        wait_for(lambda: self.file('wrote'), 5)
        # The page is gone, but the command is not: a second run is refused, and the page can see why.
        self.assertEqual(self.answer('/api/install', {}), 409)
        self.assertEqual(self.answer('/api/root', {'action': 'status'}), 409)
        self.assertEqual(self.status()['running'], name)
        self.assertTrue(self.file('wrote'), 'the output was not read after the page went (a full pipe stalls it)')
        open(os.path.join(self.repo, 'go'), 'w').close()
        self.assertTrue(wait_for(lambda: self.status()['running'] is None), 'the run never ended')
        self.assertTrue(self.file(result), 'the rest of the run did not happen without the page')
        self.assertFalse(self.server.busy.locked())
        self.assertIs(self.status()['ok'], True)

    def test_install_keeps_the_lock_after_the_page_goes(self):
        self.assertHeldUntilDone('/api/install', {}, 'install', 'installed')

    def test_root_keeps_the_lock_after_the_page_goes(self):
        self.assertHeldUntilDone('/api/root', {'action': 'status'}, 'root', 'rooted')

    def test_nothing_running_at_first(self):
        self.assertEqual(self.status(), {'running': None, 'ok': None})

    def test_a_failed_run_says_so(self):
        with open(os.path.join(self.repo, 'tizen', 'build.py'), 'w') as f:
            f.write('import sys\nprint("no")\nsys.exit(3)\n')
        status, _, body = self.request('POST', '/api/install', {})
        self.assertEqual(status, 200)
        self.assertTrue(body.endswith(b'@@FAILED\n'))
        self.assertEqual(self.status(), {'running': None, 'ok': False})


class Key(Live):
    def test_the_page_has_no_key(self):
        status, _, body = self.request('GET', '/', key=None)
        self.assertEqual(status, 200)
        self.assertFalse(self.server.key.encode() in body, 'the page has the key')   # no message with the key
        self.assertFalse(b'{{KEY}}' in body, 'the page has a place for the key')

    def test_the_api_wants_the_key(self):
        for key in (None, 'wrong-1790', self.server.key[:-1]):
            for method, path, body in (('GET', '/api/config', None), ('GET', '/api/from-tv', None),
                                       ('GET', '/api/status', None), ('POST', '/api/config', {'values': {}}),
                                       ('POST', '/api/install', {})):
                with self.subTest(key=bool(key), path=path):
                    status, _, answer = self.request(method, path, body, key=key)
                    self.assertEqual(status, 403)
                    self.assertNotIn(b'Ada', answer)
        self.assertEqual(self.request('GET', '/api/config')[0], 200)

    def test_a_name_pointed_here_is_still_refused(self):
        self.assertEqual(self.request('GET', '/api/config', host='evil.example')[0], 403)

    def test_the_terminal_and_the_browser_get_the_link_with_the_key(self):
        servers = []

        def serve(srv):
            servers.append(srv)
            raise KeyboardInterrupt

        out = io.StringIO()
        with mock.patch.object(sys, 'argv', ['setup.py', '--config', self.path, '--port', '0']), \
                mock.patch.object(setup.Server, 'serve_forever', autospec=True, side_effect=serve), \
                mock.patch.object(setup.webbrowser, 'open') as opened, mock.patch('sys.stdout', out):
            setup.main()
        srv = servers[0]
        self.addCleanup(srv.server_close)
        url = 'http://127.0.0.1:%d/#key=%s' % (srv.server_address[1], srv.key)
        # Compared without assert messages, which would print the key.
        self.assertTrue(opened.call_args_list == [mock.call(url)], 'the browser did not get the link with the key')
        self.assertTrue(url in out.getvalue(), 'the terminal did not get the link with the key')


class Frames(Live):
    def test_every_answer_forbids_frames(self):
        answers = [self.request('GET', '/', key=None), self.request('GET', '/api/config'),
                   self.request('GET', '/api/config', key=None), self.request('GET', '/nothing'),
                   self.request('POST', '/api/config', {'values': {'name': 'Bo'}}),
                   self.request('PUT', '/', key=None)]
        open(os.path.join(self.repo, 'closed'), 'w').close()
        open(os.path.join(self.repo, 'go'), 'w').close()
        answers.append(self.request('POST', '/api/install', {}))
        for status, headers, _ in answers:
            with self.subTest(status=status):
                self.assertEqual(headers['X-Frame-Options'], 'DENY')
                self.assertEqual(headers['Content-Security-Policy'], "frame-ancestors 'none'")


class Saving(Live):
    def save(self, values):
        status, _, body = self.request('POST', '/api/config', {'values': values})
        return status, json.loads(body or b'{}')

    def test_two_pages_with_different_fields_both_survive(self):
        self.assertEqual(self.save({'name': 'Bo'})[0], 200)            # page A
        self.assertEqual(self.save({'temperature': 'F'})[0], 200)      # page B, loaded before A saved
        values = webapp.read_values(self.path)
        self.assertEqual((values['name'], values['temperature']), ('Bo', 'F'))

    def test_a_switch_is_checked_against_the_file(self):
        webapp.write_values(self.path, {'spotify_client_id': 'fake-client', 'spotify_refresh_token': 'FAKE-1790'})
        self.assertEqual(self.save({'spotify': 'true'})[0], 200)
        self.assertEqual(webapp.read_values(self.path)['spotify'], 'true')
        webapp.write_values(self.path, {'spotify_refresh_token': ''})
        status, body = self.save({'spotify': 'true', 'name': 'Bo'})
        self.assertEqual(status, 400)
        self.assertIn('spotify', json.dumps(body))
        self.assertEqual(webapp.read_values(self.path)['name'], 'Ada')

    def test_a_new_city_still_drops_the_old_place(self):
        webapp.write_values(self.path, {'city': 'Bergen', 'latitude': '60.39', 'longitude': '5.32'})
        self.assertEqual(self.save({'city': 'Oslo'})[0], 200)
        values = webapp.read_values(self.path)
        self.assertEqual((values['city'], values['latitude'], values['longitude'], values['name']),
                         ('Oslo', '', '', 'Ada'))


class Language(unittest.TestCase):
    def test_english_can_be_picked(self):
        self.assertEqual(setup.field('language')['choices'], ['auto', 'en'] + [l for l in setup.translate.languages()])
        self.assertIn('nb', setup.field('language')['choices'])

    def test_the_build_takes_it(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        path = os.path.join(d, 'config.properties')
        webapp.write_values(path, {'language': 'en'})
        with mock.patch.object(webapp, 'locate', side_effect=AssertionError('no lookup')):
            self.assertEqual(webapp.read_config(path)['language'], 'en')


if __name__ == '__main__':
    unittest.main()
