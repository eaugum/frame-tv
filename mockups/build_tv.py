#!/usr/bin/env python3
"""Packs the Kino mockups as their own Tizen app, next to Frame TV: mockups/KinoMockup.wgt.

    python3 mockups/snapshot.py                    # the data and images first
    python3 mockups/build_tv.py --sign frametv
    python3 tizen/install.py <the TV's IP> mockups/KinoMockup.wgt
    python3 tizen/install.py <the TV's IP> mockups/KinoMockup.wgt --uninstall

Signed with the same profile as Frame TV, under another package id, so the two live side by side.
"""
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'tizen'))
import build  # noqa: E402

WGT = os.path.join(HERE, 'KinoMockup.wgt')

MANIFEST = '''<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" id="https://github.com/eaugum/frame-tv/mockups" version="0.1.0" viewmodes="maximized">
    <tizen:application id="KinoMockup.Kino" package="KinoMockup" required_version="3.0"/>
    <name>Kino mockup</name>
    <author href="https://github.com/eaugum/frame-tv">Eivind Augum</author>
    <description>Mockups of the Kino home screen (AUG-1452).</description>
    <content src="home.html"/>
    <icon src="icon.png"/>
    <feature name="http://tizen.org/feature/screen.size.all"/>
    <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
    <tizen:profile name="tv-samsung"/>
    <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="disable" encryption="disable" install-location="auto" hwkey-event="enable"/>
</widget>
'''


def main():
    args = sys.argv[1:]
    profile = args[args.index('--sign') + 1] if '--sign' in args else None
    if not os.path.exists(os.path.join(HERE, 'data', 'snapshot.js')):
        sys.exit('No data yet: python3 mockups/snapshot.py')

    files = {'config.xml': MANIFEST.encode('utf-8')}
    with open(os.path.join(ROOT, 'tizen', 'icon.png'), 'rb') as f:
        files['icon.png'] = f.read()
    for name in ('index.html', 'home.html'):
        files[name] = open(os.path.join(HERE, name), 'rb').read()
    for sub in ('shared', 'data'):
        for name in os.listdir(os.path.join(HERE, sub)):
            files[sub + '/' + name] = open(os.path.join(HERE, sub, name), 'rb').read()
    # Only the images the snapshot points at.
    snapshot = files['data/snapshot.js'].decode('utf-8')
    for rel in sorted(set(re.findall(r'"(img/[^"]+)"', snapshot))):
        path = os.path.join(HERE, rel)
        if os.path.exists(path):
            files[rel] = open(path, 'rb').read()

    # The small copies for the glow behind hero C.
    for name in os.listdir(os.path.join(HERE, 'img', 'a')):
        files['img/a/' + name] = open(os.path.join(HERE, 'img', 'a', name), 'rb').read()

    with zipfile.ZipFile(WGT, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in sorted(files):
            z.writestr(path, files[path])
    if profile:
        build.WGT = WGT  # sign() signs build.WGT in place
        build.sign(profile)
    print('Built %s (%d files, %d MB, %s)' % (os.path.relpath(WGT, ROOT), len(files), os.path.getsize(WGT) // 2**20,
                                             'signed with "%s"' % profile if profile else 'not signed'))


if __name__ == '__main__':
    main()
