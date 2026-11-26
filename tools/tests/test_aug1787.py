"""AUG-1787: the setup page warns when a token goes to an http:// address. Fake configs in a temporary folder; the
server listens on 127.0.0.1 and nothing leaves this Mac. Every token here is made up."""
import contextlib
import http.client
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.dont_write_bytecode = True

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import setup  # noqa: E402
import webapp  # noqa: E402


class PlainHttp(unittest.TestCase):
    def test_a_token_to_an_http_address_is_warned_about(self):
        lines = setup.plain_http({'home_assistant_url': 'http://192.0.2.10:8123', 'home_assistant_token': 'DUMMY-HA-1',
                                  'art_url': 'HTTP://192.0.2.10:8099', 'art_key': 'DUMMY-ART-1',
                                  'stasera_url': 'http://192.0.2.20', 'stasera_token': 'DUMMY-STASERA-1'})
        self.assertEqual(len(lines), 3)
        self.assertIn('home_assistant_url is http://', lines[0])
        self.assertIn('home_assistant_token', lines[0])
        self.assertIn('art_key', lines[1])
        self.assertIn('stasera_token', lines[2])
        for line in lines:
            self.assertNotIn('DUMMY', line, 'the warning never shows the token')

    def test_https_or_no_token_is_not_warned_about(self):
        self.assertEqual(setup.plain_http({'home_assistant_url': 'https://ha.test', 'home_assistant_token': 'DUMMY-HA-1'}), [])
        self.assertEqual(setup.plain_http({'home_assistant_url': 'http://ha.test', 'home_assistant_token': ''}), [])
        self.assertEqual(setup.plain_http({'art_url': 'http://art.test:8099'}), [])
        self.assertEqual(setup.plain_http({'stasera_url': '', 'stasera_token': 'DUMMY-STASERA-1'}), [], 'the default is https')


class SavePrints(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.path = os.path.join(self.dir, 'config.properties')
        webapp.write_values(self.path, {'name': 'Ada'})
        patch = mock.patch.object(setup.Server, 'listen_for_tv', return_value=None)
        patch.start()
        self.addCleanup(patch.stop)
        self.server = setup.Server(0, self.path)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def save(self, values):
        c = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=10)
        try:
            c.request('POST', '/api/config', json.dumps({'values': values}),
                      {'Content-Type': 'application/json', 'X-Setup': self.server.key})
            r = c.getresponse()
            return r.status, r.read()
        finally:
            c.close()

    def test_saving_an_http_address_with_a_token_prints_a_warning_and_still_saves(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            status, _ = self.save({'home_assistant_url': 'http://192.0.2.10:8123', 'home_assistant_token': 'DUMMY-HA-1'})
        self.assertEqual(status, 200)
        self.assertIn('home_assistant_url is http://', out.getvalue())
        self.assertNotIn('DUMMY', out.getvalue())
        self.assertEqual(webapp.read_values(self.path)['home_assistant_url'], 'http://192.0.2.10:8123', 'nothing is blocked')

    def test_saving_https_prints_nothing(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            status, _ = self.save({'home_assistant_url': 'https://ha.test', 'home_assistant_token': 'DUMMY-HA-1'})
        self.assertEqual(status, 200)
        self.assertNotIn('Warning', out.getvalue())


if __name__ == '__main__':
    unittest.main()
