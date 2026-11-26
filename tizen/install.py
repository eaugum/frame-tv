#!/usr/bin/env python3
"""Installs Frame TV on a Samsung TV in Developer Mode, over your Wi-Fi, without Samsung's sdb.

    python3 tizen/install.py 192.168.1.50              # install or update, then open it
    python3 tizen/install.py 192.168.1.50 --uninstall  # remove it
    python3 tizen/install.py 192.168.1.50 mockups/KinoMockup.wgt   # another package (the mockups) the same way
    python3 tizen/install.py 192.168.1.50 --new-tv     # another TV than the one it was installed on before

FrameTVService.tpk, the small service that reads the TV's own settings for Frame Art (tizen/service/), goes on and
comes off with Frame TV when build.py made it.

First build and sign it: python3 tizen/build.py --sign <profile> (see README.md). Before the first install, on the
TV: open Apps, type 1 2 3 4 5 on the remote, turn Developer mode on with this computer's IP as Host PC IP, and
restart the TV.

The package holds the settings with their tokens. So the first install remembers what the TV calls itself in
known-tv.txt, and a TV that calls itself something else stops it before anything is sent; afterwards the copy on the
TV is removed again.

It speaks SDB (Samsung's ADB, port 26101) itself, so it needs only Python 3: no Tizen Studio, and no Rosetta on Apple
Silicon, where Samsung's sdb (an Intel binary) doesn't run. Like Samsung's tools it pushes the package to the folder
the TV names in its capabilities and installs it with `0 vd_appinstall`, the command community installers use on
every Tizen; `0 was_execute` opens it. Tested on a 2017 UN50MU6100 (Tizen 3.0) and a 2019 UN55RU7100 (Tizen 5.0).
"""
import os
import re
import shlex
import socket
import struct
import sys
import time
import unicodedata
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import webapp  # noqa: E402  (open_private)

WGT = os.path.join(ROOT, 'FrameTV.wgt')
TPK = os.path.join(ROOT, 'FrameTVService.tpk')
SERVICE = 'org.frametv.service'
PORT = 26101
MAX_DATA = 4096   # what this side announces; sdbd keeps each packet within both sides' maximum
MAX_PACKET = 256 * 1024   # sdbd's own maximum; anything longer isn't a TV
MAX_ANSWER = 1 << 20      # per stream; vd_appinstall says a few KB
WAIT = 30                 # seconds one step may take, unless it says otherwise
KNOWN_TV = os.path.join(ROOT, 'known-tv.txt')
# Terminal escapes (CSI, OSC up to BEL or ST, the rest of ESC) and every other control character but tab and newline.
CONTROL = re.compile(r'\x1b(\[[0-?]*[ -/]*[@-~]?|\][^\x07\x1b\x9c]*(\x07|\x1b\\|\x9c)?|.?)|[\x00-\x08\x0b-\x1f\x7f-\x9f]',
                     re.S)
ON_TV = 'Apps, Settings, Frame TV, Delete'   # removing it on the TV itself


def clean(text):
    """The TV's text, safe to print: no terminal escapes, control characters or invisible formatting (bidi)."""
    return ''.join(c for c in CONTROL.sub('', text) if unicodedata.category(c) not in ('Cf', 'Zl', 'Zp'))


class Sdb:
    """The pieces of the SDB wire protocol this needs: ADB's framing (a 24-byte header whose checksum is a byte sum),
    streams opened with OPEN, and every WRTE answered with OKAY before the next one."""

    def __init__(self, ip):
        self.sock = socket.create_connection((ip, PORT), timeout=15)
        self.buf = b''
        self.next_id = 1
        self.okay, self.inbox, self.closed = {}, {}, set()
        self.wait = WAIT
        self.end = time.monotonic() + self.wait
        self.send(b'CNXN', 0x01000000, MAX_DATA, b'host::\0')
        cmd, _, max_data, data = self.read()
        if cmd != b'CNXN' or max_data < 64:
            raise ConnectionError('the TV answered %r instead of connecting' % cmd)
        self.max = min(max_data, MAX_DATA)
        self.banner = clean(data.rstrip(b'\0').decode('utf-8', 'replace'))
        name = self.banner.split(':')[2] if self.banner.count(':') >= 2 else self.banner
        self.name = re.sub(r'[\n\t]', '', name).strip()[:100]   # the model, on one line

    def send(self, cmd, arg0, arg1, data=b''):
        c = struct.unpack('<I', cmd)[0]
        self.sock.settimeout(max(1, self.end - time.monotonic()))
        self.sock.sendall(struct.pack('<6I', c, arg0, arg1, len(data), sum(data) & 0xFFFFFFFF, c ^ 0xFFFFFFFF) + data)

    def _fill(self, n):
        while len(self.buf) < n:
            left = self.end - time.monotonic()
            if left <= 0:
                raise TimeoutError('the TV stopped answering')
            self.sock.settimeout(left)
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError('the TV closed the connection')
            self.buf += chunk

    def read(self):
        """One whole packet; one cut short by a deadline stays in buf for the next read."""
        self._fill(24)
        cmd, arg0, arg1, n, _, _ = struct.unpack('<6I', self.buf[:24])
        if n > MAX_PACKET:
            raise ConnectionError('the TV announced a packet of %d bytes' % n)
        self._fill(24 + n)
        data, self.buf = self.buf[24:24 + n], self.buf[24 + n:]
        return struct.pack('<I', cmd), arg0, arg1, data

    def pump(self):
        """Reads one packet and files it under its stream: OKAY, data (answered with OKAY) or close."""
        cmd, remote, local, data = self.read()
        if not 0 < local < self.next_id:
            return   # not a stream this opened
        if cmd == b'OKAY':
            self.okay[local] = remote
        elif cmd == b'WRTE' and local not in self.closed:
            self.inbox[local] = self.inbox.get(local, b'') + data
            if len(self.inbox[local]) > MAX_ANSWER:
                del self.inbox[local]
                self.closed.add(local)   # the rest of it is dropped, unanswered
                raise ConnectionError('the TV sent too much')
            self.send(b'OKAY', local, remote)
        elif cmd == b'CLSE':
            self.closed.add(local)

    def open(self, service):
        local, self.next_id = self.next_id, self.next_id + 1
        self.end = time.monotonic() + self.wait
        self.send(b'OPEN', local, 0, service.encode() + b'\0')
        while local not in self.okay:
            if local in self.closed:
                raise ConnectionError('the TV refused ' + service)
            self.pump()
        return local, self.okay.pop(local)

    def write(self, stream, data):
        local, remote = stream
        self.end = time.monotonic() + self.wait
        self.send(b'WRTE', local, remote, data)
        while local not in self.okay:
            if local in self.closed:
                raise ConnectionError('the TV closed the stream')
            self.pump()
        del self.okay[local]

    def read_until(self, stream, done, seconds):
        """The stream's text until done(text) is true, the TV closes it, or time runs out."""
        local = stream[0]
        self.end = time.monotonic() + seconds
        while time.monotonic() < self.end and local not in self.closed and not done(self.inbox.get(local, b'')):
            try:
                self.pump()
            except (TimeoutError, socket.timeout):   # not the same before Python 3.10
                break
        return self.inbox.pop(local, b'')

    def shell(self, command, until=None, seconds=20):
        stream = self.open('shell:' + command)
        out = self.read_until(stream, lambda t: bool(until and re.search(until, t.decode('utf-8', 'replace'))), seconds)
        return clean(out.decode('utf-8', 'replace'))

    def capabilities(self):
        text = clean(self.read_until(self.open('capability:'), lambda t: False, 5).decode('utf-8', 'replace'))
        return dict(line.split(':', 1) for line in text.splitlines() if ':' in line)

    def push(self, path, data):
        """Copies data to path on the TV (sync SEND), then checks the TV's answer."""
        stream = self.open('sync:')
        spec = ('%s,%d' % (path, 0o100644)).encode()
        self.write(stream, b'SEND' + struct.pack('<I', len(spec)) + spec)
        step = self.max - 8
        for i in range(0, len(data), step):
            part = data[i:i + step]
            self.write(stream, b'DATA' + struct.pack('<I', len(part)) + part)
        self.write(stream, b'DONE' + struct.pack('<I', int(time.time())))
        answer = self.read_until(stream, lambda t: len(t) >= 8, 2 * self.wait)
        if answer[:4] != b'OKAY':
            raise ConnectionError('the TV didn\'t take the file: ' + clean(answer[8:].decode('utf-8', 'replace')))
        self.send(b'WRTE', stream[0], stream[1], b'QUIT' + struct.pack('<I', 0))

    def size(self, path):
        """path's size on the TV, None when it isn't there, -1 when the answer makes no sense (sync STAT)."""
        stream = self.open('sync:')
        name = path.encode()
        self.write(stream, b'STAT' + struct.pack('<I', len(name)) + name)
        answer = self.read_until(stream, lambda t: len(t) >= 16, self.wait)
        self.send(b'WRTE', stream[0], stream[1], b'QUIT' + struct.pack('<I', 0))
        if len(answer) < 16 or answer[:4] != b'STAT':
            return -1
        mode, size = struct.unpack('<2I', answer[4:12])
        return size if mode else None


def check_tv(name, new_tv, remember):
    """Stops unless this is the TV it was installed on before; the first install, or --new-tv, remembers it."""
    file = os.path.basename(KNOWN_TV)
    if not name:
        sys.exit('The TV at this address doesn\'t say what it is, so nothing was sent. Check tv_ip, and that it\'s the '
                 'TV that answers there.')
    try:
        with open(KNOWN_TV, encoding='utf-8', errors='replace') as f:
            known = f.read().strip()
    except FileNotFoundError:
        known = None
    except OSError as e:   # --new-tv doesn't write over what it can't read
        sys.exit('Couldn\'t read %s (%s), so nothing was sent. Check it, or delete it in the frame-tv folder, then try '
                 'again.' % (file, e))
    if known == name:
        return
    if known is not None and not new_tv:
        sys.exit('This isn\'t the TV Frame TV was installed on before: it calls itself %s, %s has %s. Nothing was '
                 'sent. If it is a new TV, delete %s in the frame-tv folder and try again, or run '
                 'tizen/install.py with --new-tv.' % (name, file, clean(known)[:100], file))
    if remember:
        try:
            with webapp.open_private(KNOWN_TV) as f:
                f.write((name + '\n').encode('utf-8'))
        except OSError as e:
            sys.exit('Couldn\'t save %s (%s), so nothing was sent.' % (file, e))
        print('Remembered this TV in %s: another one at this address stops the install before anything is sent.' % file)


def remove(sdb, path):
    """Removes the copy from the TV's staging folder, since it holds the tokens; when that fails, empties it; says
    what's left."""
    sdb.wait = min(sdb.wait, 10)   # quick steps, and a TV that went quiet shouldn't hold it up long
    emptied = False
    try:
        sdb.shell('rm -f ' + shlex.quote(path), None, sdb.wait)
        if sdb.size(path) is None:
            return
        sdb.push(path, b'')
        size = sdb.size(path)
        if size is None:
            return
        emptied = size == 0
    except Exception:   # whatever the TV answers, the next copy still gets its turn
        pass
    if emptied:
        print('%s couldn\'t be removed from the TV, but it\'s emptied: the settings aren\'t in it any more.' % path)
        return
    print('%s is still on the TV, with the settings in it; the next install replaces it and tries again.' % path)


def this_computer(ip):
    """This computer's address on the TV's network (what Host PC IP must be)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect((ip, PORT))
        return s.getsockname()[0]
    except OSError:
        return 'this computer\'s IP'


def main():
    global WGT
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) not in (1, 2):
        sys.exit(__doc__)
    ip = args[0]
    other = len(args) == 2
    if other:
        WGT = os.path.abspath(args[1])
    uninstall = '--uninstall' in sys.argv
    if uninstall and other:
        with zipfile.ZipFile(WGT) as z:
            manifest = z.read('config.xml').decode('utf-8')
    elif uninstall:
        # Removing needs only the app's ids: the manifest the package is built from has them, so no build is needed.
        with open(os.path.join(ROOT, 'tizen', 'config.xml'), encoding='utf-8') as f:
            manifest = f.read()
    else:
        if not os.path.exists(WGT):
            sys.exit('Build and sign it first: python3 tizen/build.py --sign <profile>' if not other else
                     'No such package: ' + WGT)
        with zipfile.ZipFile(WGT) as z:
            if 'author-signature.xml' not in z.namelist():
                sys.exit(os.path.basename(WGT) + ' isn\'t signed, and the TV only installs signed apps: '
                         'python3 tizen/build.py --sign <profile>')
            manifest = z.read('config.xml').decode('utf-8')
    tag = re.search(r'<tizen:application[^>]*>', manifest).group(0)
    app_id = re.search(r'\bid="([^"]+)"', tag).group(1)
    package = re.search(r'\bpackage="([^"]+)"', tag).group(1)

    try:
        sdb = Sdb(ip)
        caps = sdb.capabilities()
    except OSError as e:
        sys.exit('Couldn\'t reach the TV on port %d (%s). On the TV: Apps, 1 2 3 4 5, Developer mode on with Host PC '
                 'IP %s, then restart the TV.' % (PORT, e, this_computer(ip)))
    print('Connected: %s, Tizen %s.' % (sdb.name, caps.get('platform_version', '?')))
    check_tv(sdb.name, '--new-tv' in sys.argv, not uninstall)

    staged = []   # what's been copied to the TV, removed again however it ends
    try:
        if uninstall:
            if not other:
                sdb.shell('0 vd_appuninstall ' + SERVICE, r'spend time', 120)
            out = sdb.shell('0 vd_appuninstall ' + package, r'spend time', 120).strip()
            if not re.search(r'uninstall completed', out):
                # Some TVs' sdbd refuses this command and answers nothing.
                sys.exit(('The TV said:\n' + out if out else 'The TV didn\'t answer.') + '\nRemove it on the TV instead: ' + ON_TV + '.')
            print('Removed.')
            return

        folder = caps.get('sdk_toolpath', '/home/owner/share/tmp/sdk_tools').rstrip('/') + '/'
        if not other and os.path.exists(TPK):
            print('Installing the service ...')
            staged.append(folder + os.path.basename(TPK))
            with open(TPK, 'rb') as f:
                sdb.push(staged[-1], f.read())
            out = sdb.shell('0 vd_appinstall %s %s' % (SERVICE, shlex.quote(staged[-1])), r'spend time', 120)
            if not re.search(r'install completed', out):
                sys.exit('The TV didn\'t install the service. It said:\n' + out.strip())
        remote = folder + os.path.basename(WGT)
        with open(WGT, 'rb') as f:
            data = f.read()
        print('Copying the app to the TV ...')
        staged.append(remote)
        sdb.push(remote, data)
        print('Installing ...')
        out = sdb.shell('0 vd_appinstall %s %s' % (package, shlex.quote(remote)), r'spend time', 120)
        if not re.search(r'install completed', out):
            hint = ''
            if 'different certificate' in out:
                hint = ('\nThe Frame TV app on the TV was signed with another certificate, and the TV only updates it with the '
                        'same one. Remove it on the TV (' + ON_TV + '), then run this again.')
            sys.exit('The TV didn\'t finish installing. It said:\n' + out.strip() + hint)
        sdb.shell('0 was_execute ' + app_id, r'launched|spend time', 20)
        print('Installed and open on the TV.')
        if not other:
            print('Tip: turn on Autorun Last App in the TV\'s settings (General, Smart Features; where it is changes by year) '
                  'and the TV turns on into Frame TV.')
    except OSError as e:
        sys.exit('Stopped: %s.' % ('the TV stopped answering' if isinstance(e, (TimeoutError, socket.timeout)) else e))
    finally:
        for path in staged:
            remove(sdb, path)


if __name__ == '__main__':
    main()
