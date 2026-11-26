"""AUG-1788: config.properties is written whole or not at all, one line per value, readable only by its owner; the
packages and the preview likewise, and the preview leaves the tokens out unless asked.

Only fake tokens in temporary folders; nothing is sent anywhere.
"""
import glob
import importlib.util
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
import zipfile
from unittest import mock

sys.dont_write_bytecode = True

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import setup  # noqa: E402
import spotify_login  # noqa: E402
import webapp  # noqa: E402

EXAMPLE = os.path.join(ROOT, 'config.example.properties')
FAKE = {'stasera_token': 'FAKE-STASERA-1788', 'github_token': 'FAKE-GITHUB-1788', 'vercel_token': 'FAKE-VERCEL-1788',
        'home_assistant_token': 'FAKE-HA-1788', 'spotify_refresh_token': 'FAKE-SPOTIFY-1788',
        'youtube_client_secret': 'FAKE-YTSECRET-1788', 'youtube_refresh_token': 'FAKE-YTREFRESH-1788',
        'art_key': 'FAKE-ART-1788', 'setup_key': 'FAKE-SETUP-1788'}


def load_build():
    spec = importlib.util.spec_from_file_location('frametv_test_build_1788', os.path.join(ROOT, 'tizen', 'build.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def mode(path):
    return stat.S_IMODE(os.stat(path).st_mode)


class Folder(unittest.TestCase):
    """A temporary folder with a config.properties made from the example (0644, as a checkout gives it)."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        self.path = os.path.join(self.dir, 'config.properties')
        with open(EXAMPLE, encoding='utf-8') as f:
            text = f.read()
        for key, value in FAKE.items():
            text = text.replace('\n%s=\n' % key, '\n%s=%s\n' % (key, value))
        with open(self.path, 'w', encoding='utf-8') as f:
            f.write(text)
        os.chmod(self.path, 0o644)

    def content(self):
        with open(self.path, 'rb') as f:
            return f.read()

    def assertUntouched(self, before):
        self.assertEqual(self.content(), before)
        self.assertEqual(sorted(os.listdir(self.dir)), ['config.properties'])   # no temporary file left


class WriteValues(Folder):
    def test_sets_one_line_and_keeps_the_rest(self):
        before = self.content().decode('utf-8').splitlines(True)
        webapp.write_values(self.path, {'city': 'Bergen', 'github_token': 'FAKE-NEW-1788'})
        after = self.content().decode('utf-8').splitlines(True)
        changed = [(a, b) for a, b in zip(before, after) if a != b]
        self.assertEqual(len(before), len(after))
        self.assertEqual(changed, [('github_token=FAKE-GITHUB-1788\n', 'github_token=FAKE-NEW-1788\n'),
                                   ('city=\n', 'city=Bergen\n')])
        self.assertEqual(mode(self.path), 0o600)

    def test_a_new_file_starts_from_the_example_with_0600(self):
        path = os.path.join(self.dir, 'other.properties')
        webapp.write_values(path, {})
        with open(path, 'rb') as f, open(EXAMPLE, 'rb') as g:
            self.assertEqual(f.read(), g.read())
        self.assertEqual(mode(path), 0o600)

    def test_a_missing_key_goes_after_the_one_before_it_in_the_example(self):
        with open(self.path, 'w', encoding='utf-8') as f:
            f.write('# mine\nspotify_client_id=abc\nart_url=http://x\n')
        webapp.write_values(self.path, {'spotify_refresh_token': 'FAKE-1788'})
        self.assertEqual(self.content(), b'# mine\nspotify_client_id=abc\nspotify_refresh_token=FAKE-1788\n'
                                         b'art_url=http://x\n')

    def test_not_glued_onto_a_last_line_without_a_line_break(self):
        with open(self.path, 'w', encoding='utf-8') as f:
            f.write('spotify_client_id=abc')
        webapp.write_values(self.path, {'spotify_refresh_token': 'FAKE-1788'})
        self.assertEqual(webapp.read_values(self.path), {'spotify_client_id': 'abc',
                                                         'spotify_refresh_token': 'FAKE-1788'})

    def test_a_duplicate_key_sets_the_line_the_build_reads(self):
        with open(self.path, 'a', encoding='utf-8') as f:
            f.write('spotify_refresh_token=FAKE-OLD-1788\n')
        webapp.write_values(self.path, {'spotify_refresh_token': 'FAKE-NEW-1788'})
        self.assertEqual(webapp.read_values(self.path)['spotify_refresh_token'], 'FAKE-NEW-1788')

    def test_text_utf8_cannot_hold_leaves_the_file_as_it_was(self):
        before = self.content()
        with self.assertRaises(ValueError) as e:
            webapp.write_values(self.path, {'stasera_name': 'Stue \ud83d', 'city': 'Bergen'})
        self.assertNotIn('Stue', str(e.exception))
        self.assertUntouched(before)

    def test_a_line_break_is_refused_and_leaves_the_file_as_it_was(self):
        before = self.content()
        for brk in ('\n', '\r', '\r\n', '\v', '\f', '\x1c', '\x85', ' ', ' '):
            with self.subTest(repr(brk)), self.assertRaises(ValueError) as e:
                webapp.write_values(self.path, {'spotify_refresh_token': 'FAKE%shome_assistant_url=http://evil' % brk})
            self.assertNotIn('FAKE', str(e.exception))
            self.assertUntouched(before)

    def test_a_key_that_is_not_one_is_refused(self):
        before = self.content()
        for key in ('city\nart_url', 'city=x', '', '# city'):
            with self.subTest(repr(key)), self.assertRaises(ValueError):
                webapp.write_values(self.path, {key: 'x'})
        self.assertUntouched(before)

    def test_a_failure_before_the_swap_leaves_the_file_as_it_was(self):
        before = self.content()
        for name in ('fsync', 'replace'):
            with self.subTest(name), mock.patch.object(webapp.os, name, side_effect=OSError(28, 'No space left')):
                with self.assertRaises(OSError):
                    webapp.write_values(self.path, {'city': 'Bergen'})
            self.assertUntouched(before)

    def test_swaps_in_only_a_complete_0600_file(self):
        seen = {}
        real = os.replace

        def replace(src, dst):
            with open(src, 'rb') as f:
                seen['text'] = f.read()
            seen['mode'], seen['dst'] = mode(src), dst
            real(src, dst)

        with mock.patch.object(webapp.os, 'replace', side_effect=replace):
            webapp.write_values(self.path, {'city': 'Bergen'})
        self.assertEqual(seen['text'], self.content())
        self.assertEqual(seen['mode'], 0o600)
        self.assertEqual(seen['dst'], os.path.realpath(self.path))

    def test_a_symlink_stays_one(self):
        real = os.path.join(self.dir, 'real.properties')
        os.rename(self.path, real)
        os.symlink(real, self.path)
        webapp.write_values(self.path, {'city': 'Bergen'})
        self.assertTrue(os.path.islink(self.path))
        self.assertEqual(webapp.read_values(real)['city'], 'Bergen')

    def test_build_creates_a_missing_file_with_0600(self):
        path = os.path.join(self.dir, 'new.properties')
        with mock.patch('sys.stdout', io.StringIO()) as out:
            webapp.read_config(path)
        self.assertEqual(mode(path), 0o600)
        self.assertIn('new.properties', out.getvalue())


    def test_build_makes_an_existing_file_0600_without_rewriting_it(self):
        before = self.content()
        webapp.read_config(self.path)
        self.assertEqual(mode(self.path), 0o600)
        self.assertEqual(self.content(), before)

class SetupPage(Folder):
    """setup.py's handlers answer a value the file can't take with a problem, and leave the file alone."""

    def handler(self, pending=None):
        h = setup.Handler.__new__(setup.Handler)
        h.server = mock.Mock(config=self.path, pending=pending)
        h.answers = []
        h.send = lambda status, body, kind=None: h.answers.append((status, body))
        return h

    def test_save_with_half_an_emoji(self):
        before = self.content()
        h = self.handler()
        h.save(dict(webapp.read_values(self.path), stasera_name='Stue \ud83d'))
        self.assertEqual(h.answers[0][0], 400)
        self.assertNotIn('FAKE', json.dumps(h.answers))
        self.assertUntouched(before)

    def test_accepting_an_upload_with_half_an_emoji(self):
        before = self.content()
        h = self.handler({'values': setup.from_tv({'staseraName': 'Stue \ud83d'}), 'at': 0, 'upload': 'u-1788'})
        h.from_tv_accept(h.shown())   # the list as the page showed it (AUG-1786)
        self.assertEqual(h.answers[0][0], 400)
        self.assertUntouched(before)


    def read_only(self):
        os.chmod(self.dir, 0o500)   # the new file can't be made beside the old one
        self.addCleanup(os.chmod, self.dir, 0o700)

    def test_a_spotify_token_that_cant_be_saved(self):
        before = self.content()
        self.read_only()
        h = self.handler()
        h.server.spotify = ('client', 'verifier', 'state')
        with mock.patch.object(spotify_login, 'wait_for_code', return_value='code'), \
                mock.patch.object(spotify_login, 'refresh_token', return_value='FAKE-NEW-SPOTIFY-1788'):
            h.spotify_wait()
        self.assertEqual(h.answers[0][0], 400)
        self.assertTrue(h.answers[0][1]['error'])
        self.assertNotIn('FAKE', json.dumps(h.answers))
        self.assertUntouched(before)

    def test_a_setup_key_that_cant_be_saved(self):
        # build.py --setup makes the new setup_key since AUG-1786: when it can't be saved, it stops before building.
        before = self.content()
        self.read_only()
        run = subprocess.run([sys.executable, '-B', os.path.join(ROOT, 'tizen', 'build.py'), '--config', self.path,
                              '--setup', 'http://192.0.2.1:8890'], capture_output=True, text=True, timeout=60)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('Could not save a new setup_key', run.stderr)
        self.assertNotIn('Built', run.stdout)
        self.assertNotIn('FAKE', run.stdout + run.stderr)
        self.assertUntouched(before)

class SpotifyAnswer(unittest.TestCase):
    def answer(self, body):
        reply = io.BytesIO(json.dumps(body).encode())
        with mock.patch.object(spotify_login.urllib.request, 'urlopen', return_value=reply):
            return spotify_login.refresh_token('client', 'code', 'verifier')

    def test_a_token_on_one_line_is_taken(self):
        self.assertEqual(self.answer({'refresh_token': 'AQ-FAKE_1788.x'}), 'AQ-FAKE_1788.x')

    def test_a_token_that_is_not_one_line_of_text_is_refused(self):
        for token in ('AQ\nhome_assistant_url=http://evil:8123', 'AQ\rx', 'AQ x', 'AQ x', '', 7, None, ['AQ']):
            with self.subTest(repr(token)), self.assertRaises(spotify_login.SignInError) as e:
                self.answer({'refresh_token': token})
            self.assertNotIn('evil', str(e.exception))

    def test_an_answer_that_is_not_an_object_is_refused(self):
        with self.assertRaises(spotify_login.SignInError):
            self.answer(['refresh_token'])


class Packages(unittest.TestCase):
    """The package and the preview, built from fake settings into a temporary folder."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        self.build = load_build()
        self.build.WGT = os.path.join(self.dir, 'FrameTV.wgt')
        self.build.OUT = os.path.join(self.dir, 'out', 'tizen')
        self.config = dict(webapp.GENERIC, githubToken='FAKE-GITHUB-1788', vercelToken='FAKE-VERCEL-1788',
                           homeAssistantToken='FAKE-HA-1788', homeAssistantUrl='http://ha.invalid:8123',
                           spotifyRefreshToken='FAKE-SPOTIFY-1788', spotifyClientId='client-1788',
                           staseraToken='FAKE-STASERA-1788', youtubeClientSecret='FAKE-YTSECRET-1788',
                           youtubeRefreshToken='FAKE-YTREFRESH-1788', artKey='FAKE-ART-1788',
                           setupKey='FAKE-SETUP-1788', setupUrl='http://192.0.2.1:8890', github=True)

    def make(self, **kw):
        with mock.patch('sys.stdout', io.StringIO()) as out:
            self.build.build(True, self.config, None, **kw)
        return out.getvalue()

    def preview_config(self):
        with open(os.path.join(self.build.OUT, 'config.js'), encoding='utf-8') as f:
            return f.read()

    def test_the_preview_has_no_tokens_unless_asked(self):
        said = self.make()
        shown = self.preview_config()
        self.assertNotIn('FAKE', shown)
        self.assertIn('client-1788', shown)        # what isn't a secret stays, so the preview looks like the TV
        self.assertIn('"github": true', shown)
        self.assertNotIn('serve', said)
        with zipfile.ZipFile(self.build.WGT) as z:  # the TV's package still has them: the app needs them
            self.assertIn('FAKE-GITHUB-1788', z.read('config.js').decode())

    def test_the_preview_with_the_tokens_when_asked(self):
        self.make(tokens=True)
        shown = self.preview_config()
        for token in ('FAKE-GITHUB-1788', 'FAKE-HA-1788', 'FAKE-SPOTIFY-1788', 'FAKE-SETUP-1788'):
            self.assertIn(token, shown)

    def test_the_preview_shows_the_sample_data_and_calls_no_home_service(self):
        """web/ in the Node harness with the preview's config.js: Frame Art and Home Assistant keep their addresses in
        the file, but the preview shows their samples and asks nothing of them."""
        if not shutil.which('node'):
            self.skipTest('no node')
        self.config.update(art=True, artUrl='http://art.invalid:8099', homeAssistant=True)
        self.make()
        shown = self.preview_config()
        self.assertIn('"artUrl": ""', shown)
        probe = ("const {loadApp} = require(%s);"
                 "const t = require('fs').readFileSync(%s, 'utf8');"
                 "const app = loadApp({config: JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)),"
                 " xhr: [{url: /open-meteo/, status: 500}]});"
                 "app.advance(600000);"
                 "console.log(JSON.stringify({art: app.eval('Art.sample()'), ha: app.eval('HA.sample()'),"
                 " asked: app.requests.map((r) => r.url).concat(app.sockets.map((s) => s.url))"
                 ".filter((u) => /invalid/.test(u))}));") % (
            json.dumps(os.path.join(ROOT, 'tools', 'tests', 'harness.js')),
            json.dumps(os.path.join(self.build.OUT, 'config.js')))
        out = json.loads(subprocess.run(['node', '-e', probe], capture_output=True, text=True, check=True).stdout)
        self.assertEqual(out, {'art': True, 'ha': True, 'asked': []})
        self.make(tokens=True)
        self.assertIn('"artUrl": "http://art.invalid:8099"', self.preview_config())

    def test_the_package_and_the_preview_are_the_owners_alone(self):
        with open(self.build.WGT, 'wb') as f:
            f.write(b'old')
        os.chmod(self.build.WGT, 0o644)
        self.make(tokens=True)
        self.assertEqual(mode(self.build.WGT), 0o600)
        self.assertEqual(mode(self.build.OUT), 0o700)
        for path in glob.glob(os.path.join(self.build.OUT, '**'), recursive=True):
            with self.subTest(os.path.relpath(path, self.build.OUT)):
                self.assertEqual(mode(path), 0o700 if os.path.isdir(path) else 0o600)

    def test_a_signed_package_is_the_owners_alone(self):
        made = {}

        def tizen(cmd, **kw):   # stands in for `tizen package`: a signed copy in -o, with the default mode
            out = cmd[cmd.index('-o') + 1]
            with zipfile.ZipFile(os.path.join(out, 'FrameTV.wgt'), 'w') as z:
                z.writestr('author-signature.xml', '')
                z.writestr('signature1.xml', '')
            os.chmod(os.path.join(out, 'FrameTV.wgt'), 0o644)
            made['ok'] = True
            return mock.Mock(returncode=0, stdout='', stderr='')

        with open(self.build.WGT, 'wb') as f:
            f.write(b'unsigned')
        with mock.patch.object(self.build, 'tizen_cli', return_value='tizen'), \
                mock.patch.object(self.build.subprocess, 'run', side_effect=tizen):
            self.build.sign('profile', self.build.WGT)
        self.assertTrue(made)
        self.assertEqual(mode(self.build.WGT), 0o600)


class GitIgnore(unittest.TestCase):
    def ignored(self, name):
        try:
            return subprocess.run(['git', '-C', ROOT, 'check-ignore', '-q', '--no-index', name]).returncode == 0
        except OSError:
            self.skipTest('no git')

    def test_every_properties_file_but_the_example(self):
        self.assertTrue(self.ignored('config.properties'))
        self.assertTrue(self.ignored('other.properties'))
        self.assertTrue(self.ignored('tools/mine.properties'))
        self.assertFalse(self.ignored('config.example.properties'))

    def test_a_temporary_file_left_by_a_crash(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        seen = []
        with mock.patch.object(webapp.os, 'replace', side_effect=lambda src, dst: seen.append(src)):
            webapp.write_values(os.path.join(d, 'config.properties'), {})
        self.assertTrue(os.path.exists(seen[0]))
        self.assertEqual(mode(seen[0]), 0o600)
        self.assertTrue(self.ignored(os.path.basename(seen[0])))   # beside config.properties in the repo


if __name__ == '__main__':
    unittest.main()
