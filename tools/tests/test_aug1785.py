"""AUG-1785: install.py checks the TV's id before it sends anything, bounds what it reads from the TV, cleans the TV's
text before printing it, and removes the package from the TV's staging folder afterwards.

A fake SDB peer on 127.0.0.1 stands in for the TV, a fake package holds only DUMMY tokens, and the TV's id is kept in a
temporary folder. Nothing leaves this Mac.
"""
import contextlib
import importlib.util
import io
import json
import os
import shlex
import shutil
import socket
import stat
import struct
import sys
import tempfile
import textwrap
import threading
import time
import unittest
import warnings
import zipfile
from unittest import mock

sys.dont_write_bytecode = True

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import setup  # noqa: E402
import webapp  # noqa: E402

INSTALL = os.path.join(ROOT, 'tizen', 'install.py')
TOKEN = b'DUMMY-TOKEN-1785'
STAGING = '/home/owner/share/tmp/sdk_tools/'


def load_install(path=INSTALL):
    spec = importlib.util.spec_from_file_location('frametv_test_install_1785', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def packet(cmd, arg0, arg1, data=b''):
    c = struct.unpack('<I', cmd)[0]
    return struct.pack('<6I', c, arg0, arg1, len(data), sum(data) & 0xFFFFFFFF, c ^ 0xFFFFFFFF) + data


class FakeTV(threading.Thread):
    """Speaks enough SDB to be installed on, one connection after another, and writes down everything it gets.

    name: the device name in the CNXN banner. install_text: what `0 vd_appinstall` answers. Misbehaving on purpose:
    huge (a header that announces 2 GB, then junk), silent_on_send (stops answering once a file starts coming),
    trickle_on_send (answers a file's first piece with a packet that never ends, a byte at a time), flood (answers
    `0 vd_appinstall` with more than any answer needs), refuse (shell commands it refuses to open), rm_works=False
    (`rm -f` does nothing), keep_content (refuses to overwrite a file that's there), stat_answer (what STAT gets
    instead of the truth), staging (the sdk_toolpath it names)."""

    def __init__(self, name=b'FAKE-MODEL', platform=b'6.5', install_text=b'installing\ninstall completed\nspend time\n',
                 huge=False, silent_on_send=False, trickle_on_send=False, flood=0, refuse=(), rm_works=True,
                 keep_content=False, stat_answer=None, staging=STAGING):
        super().__init__(daemon=True)
        self.rm_works, self.keep_content, self.stat_answer, self.staging = rm_works, keep_content, stat_answer, staging
        self.device, self.platform, self.install_text = name, platform, install_text
        self.huge, self.silent_on_send, self.trickle_on_send = huge, silent_on_send, trickle_on_send
        self.flood, self.refuse = flood, refuse
        self.listener = socket.socket()
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(('127.0.0.1', 0))
        self.listener.listen(4)
        self.port = self.listener.getsockname()[1]
        self.received = bytearray()   # every byte the installer sent
        self.opened = []              # the services it opened
        self.commands = []            # the shell commands
        self.files = {}               # what's in the staging folder now
        self.pushed = {}              # what was ever pushed there
        self.junk_sent = 0
        self.stopped = False

    def stop(self):
        self.stopped = True
        try:
            self.listener.close()
        except OSError:
            pass

    def run(self):
        while not self.stopped:
            try:
                conn, _ = self.listener.accept()
            except OSError:
                return
            try:
                self.serve(conn)
            except OSError:
                pass
            finally:
                conn.close()

    def serve(self, conn):
        conn.settimeout(300)
        buf = b''
        streams = {}   # our id: {'local': their id, 'service': ..., 'sync': bytes}
        next_id = [100]

        def recv(n):
            nonlocal buf
            while len(buf) < n:
                chunk = conn.recv(65536)
                if not chunk:
                    raise ConnectionError('gone')
                self.received.extend(chunk)
                buf += chunk
            out, buf = buf[:n], buf[n:]
            return out

        quiet = False
        while not self.stopped:
            cmd, arg0, arg1, n, _, _ = struct.unpack('<6I', recv(24))
            data = recv(n) if n else b''
            cmd = struct.pack('<I', cmd)
            if quiet:
                continue
            if cmd == b'CNXN':
                if self.huge:
                    conn.sendall(struct.pack('<6I', struct.unpack('<I', b'CNXN')[0], 0x01000000, 4096, 0x7FFFFFFF, 0, 0))
                    try:
                        for _ in range(2000):   # up to 8 MB of junk, while the installer still reads it
                            conn.sendall(b'\0' * 4096)
                            self.junk_sent += 4096
                    except OSError:
                        pass
                    return
                conn.sendall(packet(b'CNXN', 0x01000000, 4096, b'device::' + self.device + b'::0\0'))
            elif cmd == b'OPEN':
                service = data.rstrip(b'\0').decode('utf-8', 'replace')
                self.opened.append(service)
                if service.startswith('shell:') and any(r in service for r in self.refuse):
                    conn.sendall(packet(b'CLSE', 0, arg0))
                    continue
                mine = next_id[0]
                next_id[0] += 1
                streams[mine] = {'local': arg0, 'service': service, 'sync': b''}
                conn.sendall(packet(b'OKAY', mine, arg0))
                if service == 'capability:':
                    conn.sendall(packet(b'WRTE', mine, arg0, b'cpu_arch:armv7\nsdk_toolpath:' + self.staging.encode() +
                                        b'\nplatform_version:' + self.platform + b'\nprofile_name:tv\n'))
                    conn.sendall(packet(b'CLSE', mine, arg0))
                elif service.startswith('shell:'):
                    self.shell(conn, mine, arg0, service[len('shell:'):])
            elif cmd == b'WRTE':
                s = streams.get(arg1)
                if s is None:
                    continue
                if s['service'] == 'sync:' and data[:4] == b'SEND' and self.silent_on_send:
                    quiet = True
                    continue
                if s['service'] == 'sync:' and data[:4] == b'DATA' and self.trickle_on_send:
                    conn.sendall(struct.pack('<6I', struct.unpack('<I', b'WRTE')[0], arg1, arg0, 4000, 0, 0))
                    while not self.stopped:
                        conn.sendall(b'x')
                        self.junk_sent += 1
                        time.sleep(0.2)
                    return
                conn.sendall(packet(b'OKAY', arg1, arg0))
                if s['service'] == 'sync:':
                    s['sync'] += data
                    self.sync(conn, arg1, arg0, s)

    def shell(self, conn, mine, theirs, command):
        self.commands.append(command)
        words = shlex.split(command)
        if command.startswith('0 vd_appinstall'):
            if self.flood:
                for _ in range(self.flood // 4096 + 1):
                    conn.sendall(packet(b'WRTE', mine, theirs, b'y' * 4096))
            answer = self.install_text
        elif command.startswith('0 vd_appuninstall'):
            answer = b'uninstall completed\nspend time\n'
        elif command.startswith('0 was_execute'):
            answer = b'launched\n'
        elif words[:2] == ['rm', '-f'] and len(words) == 3:
            if self.rm_works:
                self.files.pop(words[2], None)
            answer = b''
        else:
            answer = b'not allowed\n'
        if answer:
            conn.sendall(packet(b'WRTE', mine, theirs, answer))
        conn.sendall(packet(b'CLSE', mine, theirs))

    def sync(self, conn, mine, theirs, s):
        """Takes SEND, DATA, DONE, STAT and QUIT from what came on a sync stream so far."""
        while len(s['sync']) >= 8:
            kind, n = s['sync'][:4], struct.unpack('<I', s['sync'][4:8])[0]
            if kind in (b'DONE', b'QUIT'):
                body, s['sync'] = b'', s['sync'][8:]
            elif len(s['sync']) < 8 + n:
                return
            else:
                body, s['sync'] = s['sync'][8:8 + n], s['sync'][8 + n:]
            if kind == b'SEND':
                s['path'], s['data'] = body.decode().rsplit(',', 1)[0], b''
            elif kind == b'DATA':
                s['data'] += body
            elif kind == b'DONE' and self.keep_content and s['path'] in self.files:
                conn.sendall(packet(b'WRTE', mine, theirs, b'FAIL\x04\0\0\0busy'))
            elif kind == b'DONE':
                self.files[s['path']] = s['data']
                self.pushed.setdefault(s['path'], s['data'])
                conn.sendall(packet(b'WRTE', mine, theirs, b'OKAY\0\0\0\0'))
            elif kind == b'STAT' and self.stat_answer is not None:
                conn.sendall(packet(b'WRTE', mine, theirs, self.stat_answer))
                conn.sendall(packet(b'CLSE', mine, theirs))
            elif kind == b'STAT':
                there = body.decode() in self.files
                conn.sendall(packet(b'WRTE', mine, theirs, b'STAT' + struct.pack(
                    '<3I', 0o100644 if there else 0, len(self.files.get(body.decode(), b'')), 0)))


def fake_package(path):
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('config.xml', '<widget><tizen:application id="FrameTVapp.FrameTV" package="FrameTVapp"/></widget>')
        z.writestr('author-signature.xml', '<Signature/>')
        z.writestr('config.js', b'var CONFIG = {"stasera_token": "' + TOKEN + b'", "setup_key": "DUMMY-SETUP-1785"};')


class Case(unittest.TestCase):
    def setUp(self):
        self.install = load_install()
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.known = os.path.join(self.dir, 'known-tv.txt')
        self.wgt = os.path.join(self.dir, 'FrameTV.wgt')
        fake_package(self.wgt)
        self.tpk = os.path.join(self.dir, 'FrameTVService.tpk')   # not there unless a test makes it

    def tv(self, **kw):
        tv = FakeTV(**kw)
        tv.start()
        self.addCleanup(tv.stop)
        return tv

    def remember(self, name):
        with open(self.known, 'w') as f:
            f.write(name + '\n')

    def run_install(self, tv, *flags, wait=2):
        """(exit code or message, what was printed); every deadline shortened to `wait` seconds."""
        out = io.StringIO()
        patches = [mock.patch.object(self.install, 'PORT', tv.port), mock.patch.object(self.install, 'WGT', self.wgt),
                   mock.patch.object(self.install, 'TPK', self.tpk), mock.patch.object(self.install, 'KNOWN_TV', self.known),
                   mock.patch.object(self.install, 'WAIT', wait),
                   mock.patch.object(sys, 'argv', ['install.py', '127.0.0.1'] + list(flags))]
        with contextlib.ExitStack() as stack:
            for p in patches:
                stack.enter_context(p)
            stack.enter_context(contextlib.redirect_stdout(out))
            stack.enter_context(warnings.catch_warnings())
            warnings.simplefilter('ignore', ResourceWarning)   # install.py leaves closing its socket to the exit
            try:
                self.install.main()
                code = 0
            except SystemExit as e:
                code = e.code
        return code, out.getvalue()


class TheTVsId(Case):
    def test_the_first_install_remembers_the_tv_readable_only_by_this_user(self):
        tv = self.tv()
        code, out = self.run_install(tv)
        self.assertEqual(code, 0, out)
        with open(self.known) as f:
            self.assertEqual(f.read().strip(), 'FAKE-MODEL')
        self.assertEqual(stat.S_IMODE(os.stat(self.known).st_mode), 0o600)
        self.assertIn('Remembered this TV', out)

    def test_another_tv_stops_it_before_anything_is_sent(self):
        self.remember('FAKE-MODEL')
        tv = self.tv(name=b'OTHER-MODEL')
        code, out = self.run_install(tv)
        self.assertIsInstance(code, str)
        self.assertIn('--new-tv', code)
        self.assertIn(os.path.basename(self.known), code)
        self.assertNotIn('sync:', tv.opened)
        self.assertEqual(tv.commands, [])
        self.assertEqual(tv.pushed, {})
        self.assertNotIn(TOKEN, bytes(tv.received))
        with open(self.known) as f:
            self.assertEqual(f.read().strip(), 'FAKE-MODEL')

    def test_the_same_tv_goes_on_quietly(self):
        self.remember('FAKE-MODEL')
        tv = self.tv()
        code, out = self.run_install(tv)
        self.assertEqual(code, 0, out)
        self.assertNotIn('Remembered', out)
        self.assertIn(STAGING + 'FrameTV.wgt', tv.pushed)

    def test_new_tv_accepts_another_one(self):
        self.remember('FAKE-MODEL')
        tv = self.tv(name=b'OTHER-MODEL')
        code, out = self.run_install(tv, '--new-tv')
        self.assertEqual(code, 0, out)
        with open(self.known) as f:
            self.assertEqual(f.read().strip(), 'OTHER-MODEL')

    def test_uninstall_checks_it_too(self):
        self.remember('FAKE-MODEL')
        tv = self.tv(name=b'OTHER-MODEL')
        code, _ = self.run_install(tv, '--uninstall')
        self.assertIn('--new-tv', code)
        self.assertEqual(tv.commands, [])

    def test_uninstall_does_not_remember_one(self):
        tv = self.tv()
        code, out = self.run_install(tv, '--uninstall')
        self.assertEqual(code, 0, out)
        self.assertFalse(os.path.exists(self.known))

    def test_a_broken_file_stops_it_and_new_tv_mends_it(self):
        with open(self.known, 'wb') as f:
            f.write(b'\xff\xfe\0garbage')
        tv = self.tv()
        code, _ = self.run_install(tv)
        self.assertIn('--new-tv', code)
        self.assertEqual(tv.pushed, {})
        code, out = self.run_install(tv, '--new-tv')
        self.assertEqual(code, 0, out)

    def test_the_setup_page_shows_why_it_stopped(self):
        self.remember('FAKE-MODEL')
        tv = self.tv(name=b'OTHER-MODEL')
        repo = os.path.join(self.dir, 'repo')
        os.makedirs(os.path.join(repo, 'tizen'))
        with open(os.path.join(repo, 'tizen', 'build.py'), 'w') as f:
            f.write('print("built")\n')
        with open(os.path.join(repo, 'tizen', 'install.py'), 'w') as f:   # the real one, pointed at the fake TV
            f.write(textwrap.dedent('''\
                import importlib.util, sys
                spec = importlib.util.spec_from_file_location('install', %r)
                m = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(m)
                m.PORT, m.WGT, m.TPK, m.KNOWN_TV = %d, %r, %r, %r
                sys.argv = ['install.py', '127.0.0.1']
                m.main()
            ''' % (INSTALL, tv.port, self.wgt, self.tpk, self.known)))
        config = os.path.join(self.dir, 'config.properties')
        webapp.write_values(config, {'tv_ip': '127.0.0.1', 'sign_profile': 'fake-1785'})
        with mock.patch.object(setup, 'ROOT', repo), mock.patch.object(setup.Server, 'listen_for_tv', return_value=None):
            server = setup.Server(0, config)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                import http.client
                c = http.client.HTTPConnection('127.0.0.1', server.server_address[1], timeout=30)
                c.request('POST', '/api/install', json.dumps({}), {'X-Setup': server.key,
                                                                 'Content-Type': 'application/json'})
                body = c.getresponse().read().decode()
                c.close()
            finally:
                server.shutdown()
                server.server_close()
        self.assertIn('--new-tv', body)
        self.assertIn('known-tv.txt', body)
        self.assertTrue(body.endswith('@@FAILED\n'), body[-200:])
        self.assertEqual(tv.pushed, {})


class Cleanup(Case):
    def test_the_package_is_removed_after_an_install(self):
        tv = self.tv()
        code, out = self.run_install(tv)
        self.assertEqual(code, 0, out)
        path = STAGING + 'FrameTV.wgt'
        self.assertIn(TOKEN, tv.pushed[path])
        self.assertIn('rm -f ' + path, tv.commands)
        self.assertEqual(tv.files, {})
        self.assertIn('install completed', ''.join(tv.install_text.decode()))
        self.assertIn('Installed and open on the TV.', out)

    def test_the_service_is_removed_too(self):
        with open(self.tpk, 'wb') as f:
            f.write(b'fake service')
        tv = self.tv()
        code, out = self.run_install(tv)
        self.assertEqual(code, 0, out)
        self.assertEqual(sorted(tv.pushed), [STAGING + 'FrameTV.wgt', STAGING + 'FrameTVService.tpk'])
        self.assertEqual(tv.files, {})

    def test_a_failed_install_still_removes_it(self):
        tv = self.tv(install_text=b'install failed: different certificate\nspend time\n')
        code, _ = self.run_install(tv)
        self.assertIn('different certificate', code)
        self.assertEqual(tv.files, {})

    def test_an_error_after_the_push_still_removes_it(self):
        tv = self.tv(refuse=('vd_appinstall',))
        code, _ = self.run_install(tv)
        self.assertIsInstance(code, str)
        self.assertIn(STAGING + 'FrameTV.wgt', tv.pushed)
        self.assertEqual(tv.files, {})

    def test_it_says_so_when_the_package_stays(self):
        tv = self.tv(rm_works=False, keep_content=True)
        code, out = self.run_install(tv)
        self.assertIn(TOKEN, tv.files[STAGING + 'FrameTV.wgt'])
        self.assertIn('still on the TV, with the settings in it', out)

    def test_a_copy_rm_cant_remove_is_emptied(self):
        tv = self.tv(rm_works=False)
        code, out = self.run_install(tv)
        self.assertEqual(code, 0, out)
        self.assertEqual(tv.files, {STAGING + 'FrameTV.wgt': b''})
        self.assertIn('emptied', out)
        self.assertNotIn('with the settings in it', out)

    def test_a_garbled_stat_answer_counts_as_still_there_and_the_next_file_is_still_done(self):
        with open(self.tpk, 'wb') as f:
            f.write(b'fake service')
        for answer in (b'STAT\x01', b'ST', b'NOPE' + b'\0' * 12):
            with self.subTest(answer):
                tv = self.tv(stat_answer=answer)
                code, out = self.run_install(tv)
                self.assertEqual(code, 0, out)
                self.assertEqual([c for c in tv.commands if c.startswith('rm')],
                                 ['rm -f ' + STAGING + 'FrameTVService.tpk', 'rm -f ' + STAGING + 'FrameTV.wgt'])
                self.assertEqual(out.count('still on the TV'), 2, out)

    def test_the_staged_path_is_quoted_in_every_command(self):
        tv = self.tv(staging='/tmp/odd dir;x/')
        code, out = self.run_install(tv)
        self.assertEqual(code, 0, out)
        self.assertIn("0 vd_appinstall FrameTVapp '/tmp/odd dir;x/FrameTV.wgt'", tv.commands)
        self.assertIn("rm -f '/tmp/odd dir;x/FrameTV.wgt'", tv.commands)
        self.assertEqual(tv.files, {})

    def test_nothing_else_is_removed(self):
        tv = self.tv()
        tv.files['/home/owner/share/tmp/sdk_tools/other.wgt'] = b'not ours'
        self.run_install(tv)
        self.assertEqual(list(tv.files), ['/home/owner/share/tmp/sdk_tools/other.wgt'])
        self.assertEqual([c for c in tv.commands if c.startswith('rm')], ['rm -f ' + STAGING + 'FrameTV.wgt'])


class Limits(Case):
    def test_a_huge_packet_is_refused_at_once(self):
        tv = self.tv(huge=True)
        start = time.time()
        code, _ = self.run_install(tv)
        self.assertLess(time.time() - start, 3)
        self.assertIsInstance(code, str)
        self.assertLess(tv.junk_sent, 8 << 20)

    def test_a_silent_tv_stops_it_within_the_deadline(self):
        tv = self.tv(silent_on_send=True)
        start = time.time()
        code, out = self.run_install(tv, wait=1)
        took = time.time() - start
        self.assertIsInstance(code, str)
        self.assertIn('stopped answering', code)
        self.assertLess(took, 6)
        self.assertIn('still on the TV', out)

    def test_a_trickling_tv_stops_it_within_the_deadline(self):
        tv = self.tv(trickle_on_send=True)
        start = time.time()
        code, _ = self.run_install(tv, wait=1)
        self.assertIsInstance(code, str)
        self.assertLess(time.time() - start, 6)

    def test_an_endless_answer_is_cut_off(self):
        tv = self.tv(flood=3 << 20)
        code, _ = self.run_install(tv)
        self.assertIsInstance(code, str)
        self.assertIn('too much', code)
        self.assertEqual(tv.files, {})   # the rest of the answer is dropped, and the copy still removed


class Text(Case):
    NASTY = b'\x1b]52;c;RFVNTVktT1NDNTI=\x07\x1b[2J\x1b[1A\r\xc2\x9b31m\x07\x08'

    def test_the_tvs_text_is_cleaned_before_it_is_printed(self):
        tv = self.tv(name=b'FAKE' + self.NASTY + b'-MODEL', platform=b'6.5' + self.NASTY,
                     install_text=self.NASTY + b'install failed\x1b]0;title\x1b\\\nspend time\n')
        code, out = self.run_install(tv)
        printed = out + code
        for bad in ('\x1b', '\x07', '\x08', '\r', '\x9b', '52;c;'):
            self.assertNotIn(bad, printed)
        self.assertIn('FAKE31m-MODEL', out)
        self.assertIn('install failed', code)
        self.assertIn('\n', code)

    def test_install_completed_is_still_seen(self):
        tv = self.tv(install_text=b'\x1b[32minstall completed\x1b[0m\x1b]52;c;eA==\x07\nspend time\n')
        code, out = self.run_install(tv)
        self.assertEqual(code, 0, out)
        self.assertIn('Installed and open on the TV.', out)

    def test_clean(self):
        clean = self.install.clean
        self.assertEqual(clean('a\u202eb\u200bc\ufeffd\u2028e\u2029f\u2066g\u2069h\u200fi'), 'abcdefghi')
        self.assertEqual(clean('a\x1b]52;c;eA==\x07b'), 'ab')
        self.assertEqual(clean('a\x1b]52;c;eA==\x1b\\b'), 'ab')
        self.assertEqual(clean('a\x1b[31;1mb\x1b[0m'), 'ab')
        self.assertEqual(clean('a\x9b31mb\x9d0;t\x9c'), 'a31mb0;t')
        self.assertEqual(clean('one\ttwo\nthree\r\n'), 'one\ttwo\nthree\n')
        self.assertEqual(clean('blåbær ✓'), 'blåbær ✓')



class TheIdItself(Case):
    def test_a_tv_without_a_name_stops_it_before_anything_is_sent(self):
        for name in (b'', b'\n\t \xe2\x80\xae\xe2\x80\x8b', b'\x1b]0;x\x07'):
            with self.subTest(name):
                tv = self.tv(name=name)
                code, _ = self.run_install(tv)
                self.assertIsInstance(code, str)
                self.assertIn("doesn't say what it is", code)
                self.assertEqual(tv.pushed, {})
                self.assertNotIn('sync:', tv.opened)
                self.assertFalse(os.path.exists(self.known))

    def test_an_empty_known_tv_txt_matches_nothing(self):
        for content in ('', '\n', '  \t\n'):
            with self.subTest(content):
                with open(self.known, 'w') as f:
                    f.write(content)
                tv = self.tv(name=b'')
                code, _ = self.run_install(tv)
                self.assertIsInstance(code, str)
                self.assertEqual(tv.pushed, {})

    def test_the_id_is_one_line_of_printable_text(self):
        tv = self.tv(name=b'FAKE\n\tMO\xe2\x80\xaeDEL\xef\xbb\xbf\xe2\x80\xa8')
        code, out = self.run_install(tv)
        self.assertEqual(code, 0, out)
        with open(self.known, encoding='utf-8') as f:
            self.assertEqual(f.read(), 'FAKEMODEL\n')

    def test_an_unreadable_known_tv_txt_stops_it_with_a_way_out(self):
        os.mkdir(self.known)
        tv = self.tv()
        for flags in ((), ('--new-tv',)):
            with self.subTest(flags):
                code, _ = self.run_install(tv, *flags)
                self.assertIsInstance(code, str)
                self.assertIn('known-tv.txt', code)
                self.assertIn('delete', code)
                self.assertEqual(tv.pushed, {})
        os.rmdir(self.known)
        if os.getuid() != 0:
            self.remember('FAKE-MODEL')
            os.chmod(self.known, 0)
            code, _ = self.run_install(tv, '--new-tv')
            self.assertIn('known-tv.txt', code)
            self.assertEqual(tv.pushed, {})


class Clock(Case):
    def test_a_clock_that_jumps_doesnt_cut_steps_short(self):
        start, calls = time.time(), [0]

        def jumping():
            calls[0] += 1
            return start + calls[0] * 3600   # an hour on with every look
        tv = self.tv()
        with mock.patch.object(self.install.time, 'time', jumping):
            code, out = self.run_install(tv)
        self.assertEqual(code, 0, out)


class OldTimeout(OSError):
    """socket.timeout as Python 3.9 has it (macOS's /usr/bin/python3): an OSError, but not a TimeoutError."""


class SilentSocket:
    def settimeout(self, seconds):
        pass

    def sendall(self, data):
        pass

    def recv(self, n):
        raise OldTimeout('timed out')


class OlderPython(Case):
    def setUp(self):
        super().setUp()
        patch = mock.patch.object(socket, 'timeout', OldTimeout)
        patch.start()
        self.addCleanup(patch.stop)

    def test_read_until_stops_at_a_socket_timeout(self):
        sdb = object.__new__(self.install.Sdb)
        sdb.sock, sdb.buf, sdb.next_id, sdb.wait = SilentSocket(), b'', 2, 1
        sdb.okay, sdb.inbox, sdb.closed = {}, {1: b'so far'}, set()
        self.assertEqual(sdb.read_until((1, 7), lambda t: False, 5), b'so far')

    def test_a_socket_timeout_says_the_tv_stopped_answering(self):
        tv = self.tv()
        with mock.patch.object(self.install.Sdb, 'push', side_effect=OldTimeout('timed out')):
            code, _ = self.run_install(tv)
        self.assertEqual(code, 'Stopped: the TV stopped answering.')


if __name__ == '__main__':
    unittest.main()
