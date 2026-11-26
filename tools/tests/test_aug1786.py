"""AUG-1786: "Upload config" is sealed with setup_key (tools/seal.py; web/seal.js passes the same vectors in
aug1786.test.js), every install makes a new key, Accept writes only the list the page showed, a new address leaves
its old token behind, and a body has to say its length and come in time.

Fake keys and tokens in temporary folders; the servers listen on 127.0.0.1 and nothing leaves this Mac.
"""
import hashlib
import hmac
import http.client
import io
import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from unittest import mock

sys.dont_write_bytecode = True

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import seal  # noqa: E402
import setup  # noqa: E402
import webapp  # noqa: E402
from test_aug1788 import load_build  # noqa: E402

KEY = 'FAKE-SETUP-1786'
VECTORS = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'seal_vectors.json'),
                         encoding='utf-8'))


class Vectors(unittest.TestCase):
    """The same file as aug1786.test.js reads for web/seal.js."""

    def test_sha256_standard_vectors(self):
        for v in VECTORS['sha256']:
            data = bytes.fromhex(v['hex']) if 'hex' in v else v['text'].encode() if 'text' in v else \
                v['repeat'].encode() * v['times']
            self.assertEqual(hashlib.sha256(data).hexdigest(), v['sha256'], v['name'])

    def test_hmac_rfc4231(self):
        for v in VECTORS['rfc4231']:
            mac = hmac.new(bytes.fromhex(v['key']), bytes.fromhex(v['data']), hashlib.sha256).hexdigest()
            self.assertEqual(mac[:len(v['hmac'])], v['hmac'], v['case'])
        self.assertEqual(len(VECTORS['rfc4231']), 7)

    def test_utf8(self):
        for v in VECTORS['utf8']:
            if 'note' not in v:   # a lone surrogate is the TV's to replace; Python never gets one
                self.assertEqual(v['text'].encode('utf-8').hex(), v['hex'])

    def test_derived_keys(self):
        for v in VECTORS['derive']:
            enc, mac = seal.keys(v['setup_key'])
            self.assertEqual((enc.hex(), mac.hex()), (v['enc'], v['mac']))
            self.assertNotEqual(enc, mac)

    def test_keystream_and_sealed_bodies(self):
        for v in VECTORS['seal']:
            plain = v['text'].encode('utf-8')
            enc, _ = seal.keys(v['setup_key'])
            self.assertEqual(seal.keystream(enc, v['nonce'], v['tv'], len(plain)).hex(), v['keystream'])
            self.assertEqual(seal.seal(v['setup_key'], v['nonce'], v['tv'], plain), v['body'])
            self.assertEqual(seal.open_sealed(v['setup_key'], v['body']), plain)

    def test_open_refuses_a_change_anywhere(self):
        body = VECTORS['seal'][1]['body']
        for name in ('n', 't', 'c', 'm'):
            changed = dict(body)
            changed[name] = changed[name][:-1] + ('0' if changed[name][-1] != '0' else '1')
            with self.subTest(name), self.assertRaises(seal.Refused) as e:
                seal.open_sealed(KEY, changed)
            self.assertEqual(e.exception.status, 403)
        with self.assertRaises(seal.Refused) as e:
            seal.open_sealed('FAKE-OTHER-KEY', body)
        self.assertEqual(e.exception.status, 403)

    def test_open_refuses_what_is_not_the_format(self):
        good = VECTORS['seal'][0]['body']
        for bad in (None, [], {}, dict(good, v=2), dict(good, v=True), dict(good, v='1'), dict(good, n='0' * 31),
                    dict(good, n='G' * 32), dict(good, t=''), dict(good, t='T' * 3), dict(good, t='a' * 65),
                    dict(good, c='abc'), dict(good, m='0' * 63), dict(good, m=None)):
            with self.subTest(bad), self.assertRaises(seal.Refused) as e:
                seal.open_sealed(KEY, bad)
            self.assertEqual(e.exception.status, 400)


class Live(unittest.TestCase):
    """setup.py's page server and its listener for the TV, on 127.0.0.1 with a temporary config."""

    values = {'setup_key': KEY, 'city': 'Oslo'}

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        self.path = os.path.join(self.dir, 'config.properties')
        webapp.write_values(self.path, self.values)
        self.server = setup.Server(0, self.path)
        with mock.patch.object(setup, 'FROM_TV_PORT', 0):
            self.tv = setup.FromTVServer('127.0.0.1', self.server)
        for s in (self.server, self.tv):
            threading.Thread(target=s.serve_forever, daemon=True).start()
            self.addCleanup(s.server_close)
            self.addCleanup(s.shutdown)
        out = mock.patch('sys.stdout', io.StringIO())
        self.out = out.start()
        self.addCleanup(out.stop)

    def call(self, srv, method, path, body=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', srv.server_address[1], timeout=10)
        try:
            data = body if isinstance(body, (bytes, str)) or body is None else json.dumps(body)
            c.request(method, path, data, headers or {})
            r = c.getresponse()
            return r.status, json.loads(r.read() or b'{}')
        finally:
            c.close()

    def page(self, method, path, body=None):
        return self.call(self.server, method, path, body, {'X-Setup': self.server.key})

    def nonce(self):
        status, got = self.call(self.tv, 'GET', '/api/from-tv/nonce')
        self.assertEqual(status, 200)
        return got['nonce']

    def sealed(self, settings, key=KEY, nonce=None):
        return seal.seal(key, nonce or self.nonce(), 'test.1786', json.dumps({'settings': settings}).encode())

    def post(self, body):
        return self.call(self.tv, 'POST', '/api/from-tv', json.dumps(body) if isinstance(body, dict) else body,
                         {'Content-Type': 'text/plain'})[0]

    def upload(self, settings, key=KEY):
        status = self.post(self.sealed(settings, key))
        self.assertEqual(status, 200)

    def shown(self):
        return self.page('GET', '/api/from-tv')[1]

    def accept(self, shown=None):
        shown = shown or self.shown()
        return self.page('POST', '/api/from-tv/accept', {'upload': shown.get('upload'), 'id': shown.get('id')})

    def file(self):
        return webapp.read_values(self.path)

    def raw(self, data, wait=5.0):
        """data straight on the TV's port; the status line that comes back ('' when the connection is cut)."""
        s = socket.create_connection(('127.0.0.1', self.tv.server_address[1]), timeout=wait)
        try:
            s.sendall(data)
            return s.recv(200).decode('latin-1').split('\r\n')[0]
        except (socket.timeout, ConnectionError):
            return ''
        finally:
            s.close()


class Sealed(Live):
    def test_an_upload_sealed_with_the_key_is_accepted(self):
        self.upload({'city': 'Bergen'})
        shown = self.shown()
        self.assertEqual([(c['key'], c['tv']) for c in shown['changes']], [('city', 'Bergen')])
        self.assertEqual(self.accept(shown)[0], 200)
        self.assertEqual(self.file()['city'], 'Bergen')

    def test_replay_of_the_same_body_is_refused(self):
        body = self.sealed({'city': 'Bergen'})
        self.assertEqual(self.post(body), 200)
        self.page('POST', '/api/from-tv/discard', {'upload': self.shown()['upload']})
        self.assertEqual(self.post(body), 410)
        self.assertEqual(self.shown(), {}, 'the replay put nothing on the page')

    def test_changed_ciphertext_mac_or_nonces_are_refused(self):
        for name in ('c', 'm', 't', 'n'):
            body = self.sealed({'city': 'Bergen'})
            if name == 'n':
                body['n'] = self.nonce()   # another good nonce: the MAC names the one it was made with
            else:
                body[name] = body[name][:-2] + ('00' if body[name][-2:] != '00' else '11')
            with self.subTest(name):
                self.assertEqual(self.post(body), 403)
        self.assertEqual(self.shown(), {})

    def test_a_wrong_key_is_refused_and_does_not_use_up_the_nonce(self):
        n = self.nonce()
        self.assertEqual(self.post(self.sealed({'city': 'Bergen'}, 'FAKE-OTHER-1786', n)), 403)
        self.assertEqual(self.post(self.sealed({'city': 'Bergen'}, KEY, n)), 200)

    def test_a_stale_nonce_is_refused(self):
        with mock.patch.object(setup, 'NONCE_SECONDS', 0.2):
            body = self.sealed({'city': 'Bergen'})
        time.sleep(0.3)
        self.assertEqual(self.post(body), 410)

    def test_a_made_up_nonce_is_refused(self):
        self.assertEqual(self.post(self.sealed({'city': 'Bergen'}, KEY, 'ab' * 16)), 410)

    def test_only_the_newest_nonces_are_kept(self):
        first = self.nonce()
        for _ in range(setup.NONCES_KEPT):
            self.nonce()
        self.assertEqual(self.post(self.sealed({'city': 'Bergen'}, KEY, first)), 410)

    def test_an_app_from_before_is_told_to_install_again(self):
        self.assertEqual(self.post({'key': KEY, 'settings': {'city': 'Bergen'}}), 403)
        self.assertEqual(self.shown(), {})

    def test_not_the_format(self):
        for body in (b'not json', b'[]', json.dumps(dict(self.sealed({}), v=2)), json.dumps(dict(self.sealed({}), c='x'))):
            with self.subTest(body):
                self.assertEqual(self.post(body), 400)

    def test_sealed_but_not_settings(self):
        n = self.nonce()
        self.assertEqual(self.post(seal.seal(KEY, n, 'x', b'{"no": 1}')), 400)
        self.assertEqual(self.post(seal.seal(KEY, self.nonce(), 'x', b'\xff\xfe')), 400)

    def test_l4_json_nested_too_deep_is_400_and_the_server_goes_on(self):
        for body in (b'[' * 200000, b'{"a":' * 40000):
            with self.subTest(body[:2]):
                self.assertEqual(self.post(body), 400)
        self.assertEqual(self.post(seal.seal(KEY, self.nonce(), 'x', b'{"settings":' + b'[' * 100000)), 400)
        status, _ = self.page('POST', '/api/config', b'[' * 200000)
        self.assertEqual(status, 400)
        self.nonce()
        self.assertNotIn('Traceback', self.out.getvalue())

    def test_without_setup_key_there_is_no_nonce(self):
        webapp.write_values(self.path, {'setup_key': ''})
        self.assertEqual(self.call(self.tv, 'GET', '/api/from-tv/nonce')[0], 403)
        self.assertEqual(self.call(self.tv, 'GET', '/api/from-tv/other')[0], 404)


class Lengths(Live):
    """T48 / ST14: a length that is missing, negative, not a number or too large; a body that stalls."""

    def head(self, *lines):
        return ('POST /api/from-tv HTTP/1.1\r\nHost: x\r\n' + ''.join(l + '\r\n' for l in lines) + '\r\n').encode()

    def test_fake_lengths_are_refused(self):
        for lines, want in ((['Content-Type: text/plain'], '411'), (['Content-Length: -1'], '400'),
                            (['Content-Length: abc'], '400'), (['Content-Length: +5'], '400'),
                            (['Content-Length: 5_0'], '400'), (['Content-Length: ٣'.encode().decode('latin-1')], '400'),
                            (['Content-Length: 1e3'], '400'), (['Content-Length: 99999999999'], '413'),
                            (['Content-Length: %d' % (setup.UPLOAD_MAX + 1)], '413'),
                            (['Content-Length: 2', 'Content-Length: 2'], '400'),
                            (['Transfer-Encoding: chunked'], '411')):
            with self.subTest(lines):
                self.assertIn(' ' + want + ' ', self.raw(self.head(*lines)) + ' ')
        self.assertEqual(self.shown(), {})

    def test_the_largest_body_is_still_read(self):
        status = self.post(b' ' * setup.UPLOAD_MAX)
        self.assertEqual(status, 400, 'read, then found not to be JSON')

    def test_a_body_that_stalls_gets_408_in_time(self):
        with mock.patch.object(setup, 'BODY_SECONDS', 0.5):
            started = time.monotonic()
            line = self.raw(self.head('Content-Length: 100') + b'{"v":', wait=5)
        self.assertIn(' 408 ', line + ' ')
        self.assertLess(time.monotonic() - started, 2)

    def test_a_body_that_comes_a_byte_at_a_time_gets_408_at_the_deadline(self):
        with mock.patch.object(setup, 'BODY_SECONDS', 0.6):
            s = socket.create_connection(('127.0.0.1', self.tv.server_address[1]), timeout=5)
            started = time.monotonic()
            s.sendall(self.head('Content-Length: 1000'))
            answer = b''
            try:
                for _ in range(40):
                    s.sendall(b' ')
                    time.sleep(0.05)
            except OSError:
                pass
            try:
                answer = s.recv(200)
            except OSError:
                pass
            s.close()
        self.assertIn(b' 408 ', answer)
        self.assertLess(time.monotonic() - started, 3)

    def test_a_body_that_pauses_for_the_idle_limit_is_cut_before_the_body_limit(self):
        with mock.patch.object(setup, 'IDLE_SECONDS', 0.3), mock.patch.object(setup, 'BODY_SECONDS', 10):
            started = time.monotonic()
            line = self.raw(self.head('Content-Length: 100') + b'{"v":', wait=5)
        self.assertIn(' 408 ', line + ' ')
        self.assertLess(time.monotonic() - started, 2)

    def test_the_cut_leaves_at_most_one_quiet_line(self):
        err = io.StringIO()
        with mock.patch.object(setup, 'REQUEST_SECONDS', 0.6), mock.patch('sys.stderr', err):
            for head in (b'POST /api/from-tv HTTP/1.1\r\n', self.head('Content-Length: 1000')):
                s = socket.create_connection(('127.0.0.1', self.tv.server_address[1]), timeout=5)
                s.sendall(head)
                try:
                    for _ in range(40):
                        s.sendall(b'X-Slow: 1\r\n' if head.endswith(b'1.1\r\n') else b' ')
                        time.sleep(0.05)
                except OSError:
                    pass
                s.close()
            time.sleep(0.3)
        said = err.getvalue() + self.out.getvalue()
        self.assertNotIn('Traceback', said)
        self.assertLessEqual(len([l for l in said.splitlines() if 'Upload config' in l]), 2, said)

    def test_l1_a_connection_flood_is_capped_and_the_rest_closed_at_once(self):
        held = [socket.create_connection(('127.0.0.1', self.tv.server_address[1]), timeout=5)
                for _ in range(setup.TV_CONNECTIONS)]
        for s in held:
            s.sendall(b'G')
        time.sleep(0.2)
        started = time.monotonic()
        for _ in range(50):   # past the cap: closed without an answer, right away
            s = socket.create_connection(('127.0.0.1', self.tv.server_address[1]), timeout=5)
            try:
                self.assertEqual(s.recv(10), b'')
            except ConnectionResetError:
                pass
            s.close()
        self.assertLess(time.monotonic() - started, 3)
        self.assertEqual(self.page('GET', '/api/status')[0], 200, 'the setup page still answers')
        for s in held:
            s.close()
        time.sleep(0.3)
        self.nonce()   # the TV gets in again

    def test_headers_that_stall_are_cut(self):
        with mock.patch.object(setup.FromTV, 'timeout', 0.3):
            started = time.monotonic()
            self.assertEqual(self.raw(b'POST /api/from-tv HTTP/1.1\r\n', wait=5), '')
        self.assertLess(time.monotonic() - started, 2)

    def test_headers_that_dribble_are_cut_at_the_request_limit(self):
        with mock.patch.object(setup, 'REQUEST_SECONDS', 0.6):
            s = socket.create_connection(('127.0.0.1', self.tv.server_address[1]), timeout=5)
            started = time.monotonic()
            s.sendall(b'POST /api/from-tv HTTP/1.1\r\n')
            cut = False
            for _ in range(60):
                try:
                    s.sendall(b'X-Slow: 1\r\n')
                    s.settimeout(0.05)
                    if s.recv(10) == b'':
                        cut = True
                        break
                except socket.timeout:
                    continue
                except OSError:
                    cut = True
                    break
            s.close()
        self.assertTrue(cut, 'the connection was cut')
        self.assertLess(time.monotonic() - started, 3)

    def test_the_page_server_checks_the_length_too(self):
        for length, want in (('-1', 400), ('abc', 400), (str(setup.PAGE_MAX + 1), 413)):
            c = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=10)
            c.putrequest('POST', '/api/config')
            c.putheader('X-Setup', self.server.key)
            c.putheader('Content-Length', length)
            c.endheaders()
            with self.subTest(length):
                self.assertEqual(c.getresponse().status, want)
            c.close()


class BoundAccept(Live):
    """ST21 / T52: Accept writes the list the page showed, or nothing."""

    def test_an_upload_between_show_and_accept_writes_nothing(self):
        self.upload({'city': 'Bergen'})
        seen = self.shown()
        self.upload({'city': 'Tromsø', 'name': 'Eve'})
        status, body = self.accept(seen)
        self.assertEqual(status, 409)
        self.assertEqual(body['error'], 'The TV sent again while this was shown: look at the list again before accepting.')
        self.assertEqual(self.file()['city'], 'Oslo')
        now = self.shown()
        self.assertEqual(sorted(c['key'] for c in now['changes']), ['city', 'name'])
        self.assertEqual(self.accept(now)[0], 200)
        self.assertEqual((self.file()['city'], self.file()['name']), ('Tromsø', 'Eve'))

    def test_a_file_changed_since_the_list_was_shown_writes_nothing(self):
        self.upload({'city': 'Bergen', 'name': 'Eve'})
        seen = self.shown()
        self.assertEqual(self.page('POST', '/api/config', {'values': {'name': 'Eve'}})[0], 200)
        status, body = self.accept(seen)
        self.assertEqual(status, 409)
        self.assertIn('The file changed', body['error'])
        self.assertEqual(self.file()['city'], 'Oslo')

    def test_accept_without_the_list_writes_nothing(self):
        self.upload({'city': 'Bergen'})
        for body in ({}, {'upload': self.shown()['upload']}, {'id': self.shown()['id']}):
            with self.subTest(body):
                self.assertEqual(self.page('POST', '/api/from-tv/accept', body)[0], 409)
        self.assertEqual(self.file()['city'], 'Oslo')

    def test_discard_names_the_upload_too(self):
        self.upload({'city': 'Bergen'})
        seen = self.shown()
        self.upload({'city': 'Tromsø'})
        self.assertEqual(self.page('POST', '/api/from-tv/discard', {'upload': seen['upload']})[0], 409)
        self.assertTrue(self.shown()['changes'], 'the new one is still there')
        self.assertEqual(self.page('POST', '/api/from-tv/discard', {'upload': self.shown()['upload']})[0], 200)
        self.assertEqual(self.shown(), {})


class NewAddressDropsToken(Live):
    """T82 / done-when 3 and 5: a new address from the TV needs the token again, unless the TV sent one for it."""

    values = {'setup_key': KEY, 'home_assistant': 'true', 'home_assistant_url': 'http://ha.local:8123',
              'home_assistant_token': 'DUMMY-HA-ab12', 'art_url': 'http://art.local:8099', 'art_key': 'DUMMY-ART-cd34',
              'stasera_url': '', 'stasera_token': 'DUMMY-ST-ef56', 'spotify_refresh_token': 'DUMMY-SP-0000'}

    def rows(self):
        return {c['key']: c for c in self.shown()['changes']}

    def test_a_new_address_without_a_token_removes_the_old_one(self):
        self.upload({'homeAssistantUrl': 'http://10.9.9.9:8123'})
        row = self.rows()['home_assistant_token']
        self.assertEqual((row['file'], row['tv'], row['token']), ('••••ab12', setup.REMOVED, 'removed'))
        self.assertNotIn('DUMMY', json.dumps(self.shown()), 'the page gets only the last four')
        self.assertEqual(self.accept()[0], 200)
        values = self.file()
        self.assertEqual(values['home_assistant_url'], 'http://10.9.9.9:8123')
        self.assertEqual(values['home_assistant_token'], '')
        config = webapp.read_config(self.path)
        self.assertEqual(config['homeAssistantToken'], '', 'the next build sends no token to the TV-chosen address')

    def test_a_token_the_tv_sent_for_the_new_address_is_kept(self):
        self.upload({'homeAssistantUrl': 'http://10.9.9.9:8123', 'homeAssistantToken': 'DUMMY-NEW-9876'})
        row = self.rows()['home_assistant_token']
        self.assertEqual((row['file'], row['tv'], row['token']), ('••••ab12', '••••9876', 'kept'))
        self.assertEqual(self.accept()[0], 200)
        self.assertEqual(self.file()['home_assistant_token'], 'DUMMY-NEW-9876')

    def test_art_and_stasera_too_and_the_default_stasera_counts_as_its_address(self):
        self.upload({'artUrl': 'http://10.9.9.9:8099', 'staseraUrl': 'https://www.stasera.app/'})
        rows = self.rows()
        self.assertEqual(rows['art_key']['tv'], setup.REMOVED)
        self.assertNotIn('stasera_token', rows, 'the default address, written out: the same origin')
        self.upload({'staseraUrl': 'https://stasera.test'})
        self.assertEqual(self.rows()['stasera_token']['tv'], setup.REMOVED)
        self.assertEqual(self.accept()[0], 200)
        self.assertEqual(self.file()['stasera_token'], '')

    def test_the_same_origin_keeps_the_token(self):
        self.upload({'homeAssistantUrl': 'HTTP://HA.local:8123/'})
        self.assertNotIn('home_assistant_token', self.rows())
        self.assertEqual(self.accept()[0], 200)
        self.assertEqual(self.file()['home_assistant_token'], 'DUMMY-HA-ab12')

    def test_fixed_addresses_are_as_before(self):
        self.upload({'spotifyRefreshToken': 'DUMMY-SP-1111', 'city': 'Bergen'})
        rows = self.rows()
        self.assertNotIn('token', rows['spotify_refresh_token'])
        self.assertEqual(sorted(rows), ['city', 'spotify_refresh_token'])

    def test_no_row_when_the_file_had_no_token(self):
        webapp.write_values(self.path, {'home_assistant_token': ''})
        self.upload({'homeAssistantUrl': 'http://10.9.9.9:8123'})
        self.assertEqual(list(self.rows()), ['home_assistant_url'])

    def test_l3_no_origin_is_never_the_same_origin(self):
        for old in ('', 'ha.local:8123', 'nonsense'):
            for new in ('//evil.com:8123', 'evil.com', ''):
                if new == old:
                    continue
                rows = setup.changes({'home_assistant_url': old, 'home_assistant_token': 'K1'}, {'home_assistant_url': new})
                with self.subTest(old=old, new=new):
                    self.assertIn(('home_assistant_token', 'removed'), [(c['key'], c.get('token')) for c in rows])
        # The same unreadable address as the file: nothing moved, nothing to remove.
        rows = setup.changes({'home_assistant_url': 'ha.local:8123', 'home_assistant_token': 'K1'},
                             {'home_assistant_url': 'ha.local:8123'})
        self.assertEqual(rows, [])

    def test_changes_alone(self):
        rows = setup.changes({'art_url': 'http://a', 'art_key': 'K1'}, {'art_url': 'nonsense'})
        self.assertEqual([(c['key'], c.get('token')) for c in rows], [('art_url', None), ('art_key', 'removed')])
        rows = setup.changes({'art_url': 'http://a', 'art_key': 'K1'}, {'art_url': 'http://b', 'art_key': ''})
        self.assertEqual([(c['key'], c['tv'], c.get('token')) for c in rows], [('art_url', 'http://b', None),
                                                                                ('art_key', '', 'removed')])


class NewKeyEveryInstall(Live):
    """T43 / ST11: every install makes a new key, and an app built with the one before can't upload any more."""

    values = {'setup_key': 'FAKE-OLD-1786', 'tv_ip': '192.0.2.10', 'sign_profile': 'fake'}

    def build(self):
        b = load_build()
        b.WGT = os.path.join(self.dir, 'FrameTV.wgt')
        b.main(['--config', self.path, '--setup', 'http://192.0.2.1:8890'])
        with zipfile.ZipFile(b.WGT) as z:
            js = z.read('config.js').decode()
        return json.loads(js[js.index('{'):js.rindex('}') + 1])

    def test_build_setup_makes_a_new_key_and_the_old_one_is_refused(self):
        first = self.build()
        key1 = self.file()['setup_key']
        self.assertEqual(first['setupKey'], key1)
        self.assertNotEqual(key1, 'FAKE-OLD-1786')
        self.assertGreaterEqual(len(key1), 40)
        self.assertEqual(self.post(self.sealed({'city': 'Bergen'}, 'FAKE-OLD-1786')), 403)
        self.assertEqual(self.post(self.sealed({'city': 'Bergen'}, key1)), 200)
        second = self.build()
        self.assertNotEqual(second['setupKey'], key1)
        self.assertEqual(self.post(self.sealed({'city': 'Bergen'}, key1)), 403, 'the install before stops working')
        self.assertEqual(self.post(self.sealed({'city': 'Bergen'}, second['setupKey'])), 200)

    def plain_build(self, *args):
        b = load_build()
        b.WGT = os.path.join(self.dir, 'FrameTV.wgt')
        b.main(list(args) or ['--config', self.path])
        return b

    def test_without_setup_there_is_no_key_in_the_app_and_none_in_the_file(self):
        b = self.plain_build()
        with zipfile.ZipFile(b.WGT) as z:
            self.assertNotIn('FAKE-OLD-1786', z.read('config.js').decode())
        self.assertEqual(self.file()['setup_key'], '')

    def test_m1_after_a_plain_build_the_key_before_is_refused(self):
        key = self.build()['setupKey']
        self.assertEqual(self.post(self.sealed({'city': 'Bergen'}, key)), 200)
        n = self.nonce()   # handed out before the plain build
        self.plain_build()
        self.assertEqual(self.post(self.sealed({'city': 'Pwned'}, key, n)), 403)
        self.assertEqual(self.call(self.tv, 'GET', '/api/from-tv/nonce')[0], 403, 'no key: no nonce either')

    def test_m1_a_plain_build_without_a_key_leaves_the_file_as_it_is(self):
        webapp.write_values(self.path, {'setup_key': ''})
        before = open(self.path, 'rb').read()
        self.plain_build()
        self.assertEqual(open(self.path, 'rb').read(), before)

    def test_m1_a_generic_build_touches_no_config_file(self):
        with mock.patch.object(webapp, 'write_values', side_effect=AssertionError('wrote a file')), \
                mock.patch.object(webapp, 'read_values', side_effect=AssertionError('read a file')):
            self.plain_build('--generic')
        self.assertEqual(self.file()['setup_key'], 'FAKE-OLD-1786')

    def test_generic_with_setup_stops(self):
        b = load_build()
        b.WGT = os.path.join(self.dir, 'FrameTV.wgt')
        with self.assertRaises(SystemExit):
            b.main(['--generic', '--setup', 'http://192.0.2.1:8890'])
        self.assertFalse(os.path.exists(b.WGT))

    def test_install_on_the_page_builds_with_setup_and_does_not_write_the_key_itself(self):
        h = setup.Handler.__new__(setup.Handler)
        h.server = mock.Mock(config=self.path, busy=threading.Lock())
        h.server.listen_for_tv.return_value = 'http://192.0.2.1:8890'
        h.send = mock.Mock()
        h.run = mock.Mock(return_value=True)
        h.install()
        build = h.run.call_args[0][0][0]
        self.assertEqual(build[build.index('--setup') + 1], 'http://192.0.2.1:8890')
        self.assertEqual(self.file()['setup_key'], 'FAKE-OLD-1786', 'build.py makes it, once')

    def test_the_page_cannot_set_or_clear_setup_key(self):
        for value in ('', 'FAKE-TYPED-1786'):
            self.assertEqual(self.page('POST', '/api/config', {'values': {'setup_key': value}})[0], 200)
            self.assertEqual(self.file()['setup_key'], 'FAKE-OLD-1786')
        fields = [k for s in self.page('GET', '/api/config')[1]['sections'] for k in s['keys'] if k['key'] == 'setup_key']
        self.assertEqual(fields, [dict(fields[0], kind='fixed', text='New at every install', value='')])


if __name__ == '__main__':
    unittest.main()
