#!/usr/bin/env python3
"""Builds Frame TV for Samsung TVs (Tizen): FrameTV.wgt, the app package the TV installs.

    python3 tizen/build.py                 # → FrameTV.wgt, not signed yet
    python3 tizen/build.py --sign PROFILE  # signed with a certificate profile of Samsung's Tizen tools
    python3 tizen/build.py --preview       # also leaves the files in out/tizen/ to open index.html in a browser,
                                           # with sample data in place of the tokens (--preview-tokens: the real ones)
    python3 tizen/build.py --config other.properties
    python3 tizen/build.py --generic       # without config.properties: the TV's time zone picks the city (the check)
    python3 tizen/build.py --setup URL     # "Upload config" on the TV sends to URL with setup_key (tools/setup.py)

The home screen (web/) with tizen/config.xml and tizen/icon.png, in a zip as Tizen Studio makes it. TVs only install
signed packages: --sign uses `tizen package` from tizen-studio/ (or Tizen Studio elsewhere) with a profile made there.
With --sign it also builds FrameTVService.tpk (tizen/service/, the TV's own settings for Frame Art's TV tab) when .NET 6
is there (tizen/get-tools.sh); without it Frame TV works as before, only the TV tab has less.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import webapp  # noqa: E402

OUT = os.path.join(ROOT, 'out', 'tizen')
WGT = os.path.join(ROOT, 'FrameTV.wgt')
TPK = os.path.join(ROOT, 'FrameTVService.tpk')


def tizen_cli():
    """Samsung's `tizen` command (Tizen Studio or the Tizen SDK), or None."""
    name = 'tizen.bat' if os.name == 'nt' else 'tizen'
    home = os.path.expanduser('~')
    for base in (os.environ.get('TIZEN_STUDIO', ''), os.path.join(ROOT, 'tizen-studio'),
                 os.path.join(home, 'tizen-studio'), os.path.join(home, 'tizen-sdk'), 'C:\\tizen-studio'):
        path = os.path.join(base, 'tools', 'ide', 'bin', name)
        if base and os.path.exists(path):
            return path
    return shutil.which('tizen')


def sign(profile, package=WGT):
    cli = tizen_cli()
    if not cli:
        sys.exit('Signing needs Samsung\'s Tizen tools (tizen-studio/ in this folder, or Tizen Studio). Not found: set '
                 'TIZEN_STUDIO to where they are installed.')
    kind = package.rsplit('.', 1)[1]
    out = tempfile.mkdtemp()
    try:
        run = subprocess.run([cli, 'package', '-t', kind, '-s', profile, '-o', out, '--', package],
                             capture_output=True, text=True)
        made = [n for n in os.listdir(out) if n.endswith('.' + kind)]
        if run.returncode != 0 or not made:
            sys.exit('`tizen package` didn\'t sign it:\n' + (run.stdout + run.stderr).strip())
        os.chmod(os.path.join(out, made[0]), 0o600)   # Frame TV's holds the tokens
        shutil.move(os.path.join(out, made[0]), package)
    finally:
        shutil.rmtree(out, ignore_errors=True)
    with zipfile.ZipFile(package) as z:
        names = z.namelist()
    if 'author-signature.xml' not in names or 'signature1.xml' not in names:
        sys.exit('The package came back without its signatures.')


def dotnet():
    """The .NET 6 SDK's dotnet (tizen/get-tools.sh puts it in dotnet/), or None."""
    for path in (os.environ.get('DOTNET', ''), os.path.join(ROOT, 'dotnet', 'dotnet'),
                 os.path.join(ROOT, 'tools', 'root', 'work', 'dotnet', 'dotnet')):
        if path and os.path.exists(path):
            return path
    return shutil.which('dotnet')


def build_service(profile):
    """FrameTVService.tpk, signed like Frame TV; None when there's no .NET to build it with."""
    cli = dotnet()
    if not cli:
        if os.path.exists(TPK):
            os.remove(TPK)
        return None
    work = tempfile.mkdtemp()
    try:
        src = os.path.join(work, 'service')
        shutil.copytree(os.path.join(ROOT, 'tizen', 'service'), src)
        os.makedirs(os.path.join(src, 'shared', 'res'))
        shutil.copy(os.path.join(ROOT, 'tizen', 'icon.png'), os.path.join(src, 'shared', 'res', 'icon.png'))
        env = dict(os.environ, DOTNET_ROOT=os.path.dirname(os.path.realpath(cli)), DOTNET_CLI_TELEMETRY_OPTOUT='1',
                   DOTNET_NOLOGO='1')
        run = subprocess.run([cli, 'build', '-c', 'Release'], cwd=src, env=env, capture_output=True, text=True)
        made = [os.path.join(d, n) for d, _, names in os.walk(os.path.join(src, 'bin')) for n in names
                if n.endswith('.tpk')] if run.returncode == 0 else []
        if not made:
            sys.exit('`dotnet build` didn\'t build the service:\n' + (run.stdout + run.stderr).strip()[-3000:])
        shutil.move(made[0], TPK)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    sign(profile, TPK)
    with open(os.path.join(ROOT, 'tizen', 'service', 'tizen-manifest.xml'), encoding='utf-8') as f:
        version = re.search(r'<manifest [^>]*?\sversion="([^"]+)"', f.read()).group(1)
    return version


def build(preview, config, profile, tokens=False):
    with open(os.path.join(ROOT, 'tizen', 'config.xml'), encoding='utf-8') as f:
        manifest = f.read()
    app_id = re.search(r'<tizen:application id="([^"]+)"', manifest).group(1)
    version = re.search(r'<widget [^>]*version="([^"]+)"', manifest).group(1)
    app = webapp.files(config, 'tizen/build.py')
    for name in ('config.xml', 'icon.png'):
        with open(os.path.join(ROOT, 'tizen', name), 'rb') as f:
            app[name] = f.read()

    with webapp.open_private(WGT) as f, zipfile.ZipFile(f, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in sorted(app):
            z.writestr(path, app[path])
    if profile:
        sign(profile)

    if preview:
        shown = dict(app)
        if not tokens:
            shown['config.js'] = webapp.config_js(webapp.without_secrets(config), 'tizen/build.py')
        webapp.preview(shown, OUT)
        print('Preview: open out/tizen/index.html in a browser, as a file (%s).' %
              ('with your tokens: don\'t serve the folder' if tokens else 'sample data in place of the tokens'))
    print('Built %s (%s %s, %d KB, %s)' % (os.path.basename(WGT), app_id, version, os.path.getsize(WGT) // 1024,
                                           'signed with "%s"' % profile if profile else 'not signed'))
    if profile:
        service = build_service(profile)
        print('Built %s (%s, %d KB)' % (os.path.basename(TPK), service, os.path.getsize(TPK) // 1024) if service else
              'No .NET 6 (tizen/get-tools.sh), so no FrameTVService.tpk: the TV tab shows less.')


if __name__ == '__main__':
    args = sys.argv[1:]
    profile = args[args.index('--sign') + 1] if '--sign' in args else None
    config = webapp.config_from_args(args)
    if '--setup' in args:
        if not config.get('setupKey'):
            sys.exit('--setup needs setup_key in the config.')
        config['setupUrl'] = args[args.index('--setup') + 1]
    else:
        config.pop('setupKey', None)
    build('--preview' in args or '--preview-tokens' in args, config, profile, '--preview-tokens' in args)
