"""The web app's files and settings, for tizen/build.py.

The settings come from config.properties, as they are: the TV decides the rest (Settings and Modules in web/data.js),
since a setting changed on the TV can fill in what the file leaves empty. Each module is on only with its switch set to
true. The city gets its place from Open-Meteo here, when the app is built. --generic leaves the file out (the check
does that): then the TV's time zone picks the city, and Stasera is on with its default address.
"""
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import translate  # noqa: E402  (the catalogues and the keys the web app uses)

EXAMPLE = os.path.join(ROOT, 'config.example.properties')
MODULES = ('stasera', 'youtube', 'github', 'vercel', 'homeAssistant', 'spotify', 'art')

# What's picked on the TV (the Home row, hidden apps, Home Assistant's entities...) comes back here with "Send to the
# Mac" (AUG-1521): {key in the file: name in config.js}.
LISTS = {'hide_apps': 'hideApps', 'shelf': 'shelf', 'home_assistant_scenes': 'homeAssistantScenes',
         'home_assistant_lights': 'homeAssistantLights', 'home_assistant_power': 'homeAssistantPower',
         'home_assistant_laundry': 'homeAssistantLaundry', 'home_assistant_guest_wifi': 'homeAssistantGuestWifi'}
WHOLE = {'saver_minutes': 'saverMinutes', 'saver_every': 'saverEvery'}
TEXTS = {'youtube_playlist': 'youtubePlaylist', 'youtube_refresh_token': 'youtubeRefreshToken',
         'stasera_token': 'staseraToken'}

GENERIC = {'latitude': '', 'longitude': '', 'city': '', 'name': '', 'language': '', 'temperature': '',
           'staseraUrl': '', 'staseraName': '', 'githubToken': '', 'githubHide': [], 'vercelToken': '',
           'vercelTeam': '', 'youtubeClientId': '', 'youtubeClientSecret': '',
           'homeAssistantUrl': '', 'homeAssistantToken': '',
           'spotifyClientId': '', 'spotifyRefreshToken': '', 'artUrl': '', 'artKey': ''}
GENERIC.update({name: [] for name in LISTS.values()})
GENERIC.update({name: '' for name in list(WHOLE.values()) + list(TEXTS.values())})
GENERIC.update({name: name == 'stasera' for name in MODULES})


def config_from_args(args):
    """The settings for these command-line arguments (--generic, --config PATH or config.properties)."""
    if '--generic' in args:
        return dict(GENERIC)
    path = os.path.join(ROOT, 'config.properties')
    if '--config' in args:
        path = os.path.abspath(args[args.index('--config') + 1])
    return read_config(path)


def line_key(line):
    """The key a line of the file sets, or None (a comment, a blank line)."""
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line:
        return None
    return line.split('=', 1)[0].strip()


def read_values(path):
    """The file's key=value lines as {key: value}; a key on several lines has the last one's value."""
    values = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            key = line_key(line)
            if key is not None:
                values[key] = line.split('=', 1)[1].strip().strip('"')
    return values


LINE_BREAK = re.compile('[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]')   # where str.splitlines() breaks a line
_writing = threading.Lock()


def write_values(path, values):
    """Sets each key=value in the file and keeps the rest (comments, order, other keys): on the line read_values
    reads, or for a key the file lacks, after the one before it in the example. Without the file it starts from the
    example. A value that isn't one line of text raises ValueError (naming the key, not the value).

    All or nothing: the new text goes to a 0600 file beside it, which replaces the old one only when it's all on disk,
    so an error or a crash leaves the old file as it was."""
    path = os.path.realpath(path)   # a symlinked file stays a symlink
    values = {key: str(value) for key, value in values.items()}
    for key, value in values.items():
        if not re.fullmatch(r'[a-z_]+', key):
            raise ValueError('Not a setting: %r' % key)
        if LINE_BREAK.search(value):
            raise ValueError('%s must be on one line.' % key)
        try:
            value.encode('utf-8')
        except UnicodeEncodeError:
            raise ValueError('%s has a character that can\'t be saved (half an emoji?).' % key) from None
    with _writing:
        with open(path if os.path.exists(path) else EXAMPLE, encoding='utf-8') as f:
            lines = f.readlines()
        with open(EXAMPLE, encoding='utf-8') as f:
            order = [k for k in map(line_key, f) if k]

        def where(key):
            found = [i for i, line in enumerate(lines) if line_key(line) == key]
            return found[-1] if found else -1

        for key, value in values.items():
            line = '%s=%s\n' % (key, value)
            i = where(key)
            if i >= 0:
                lines[i] = line
                continue
            at = len(lines)
            n = order.index(key) if key in order else len(order)
            for prev in reversed(order[:n]):
                if where(prev) >= 0:
                    at = where(prev) + 1
                    break
            else:
                for nxt in order[n + 1:]:
                    if where(nxt) >= 0:
                        at = where(nxt)
                        break
            if at == len(lines) and lines and not lines[-1].endswith('\n'):
                lines[-1] += '\n'
            lines.insert(at, line)
        data = ''.join(lines).encode('utf-8')
        # mkstemp makes it 0600; the name ends in .properties so .gitignore covers one a crash leaves behind.
        fd, tmp = tempfile.mkstemp(prefix='.%s.' % os.path.basename(path), suffix='.properties',
                                   dir=os.path.dirname(path))
        try:
            with os.fdopen(fd, 'wb') as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise


def open_private(path):
    """path, emptied and opened for writing bytes, readable only by this user (0600) even when it was there before."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    return os.fdopen(fd, 'wb')


NUMBERS = ('latitude', 'longitude')   # no longer in the example, but an older file may have them
SWITCHES = {name: name for name in MODULES}
SWITCHES['homeAssistant'] = 'home_assistant'


def problems(values):
    """What's wrong with these values ({key: value}), as sentences; empty when nothing is."""
    out = []
    for key in NUMBERS:
        v = values.get(key, '')
        if v and not re.match(r'^-?\d+(\.\d+)?$', v):
            out.append('%s must be a number (got "%s")' % (key, v))
    for key in WHOLE:
        v = values.get(key, '')
        if v and not v.isdigit():
            out.append('%s must be a whole number (got "%s")' % (key, v))
    for key in SWITCHES.values():
        v = values.get(key, '').lower()
        if v not in ('', 'true', 'false'):
            out.append('%s must be true or false (got "%s")' % (key, v))
    return out


def read_config(path):
    if not os.path.exists(path):
        write_values(path, {})
        print('Created %s: add your Stasera address and your city there, then build again.'
              % os.path.relpath(path, ROOT))
    else:
        try:
            os.chmod(path, 0o600)   # one from before AUG-1788, or made by hand, may be 0644
        except OSError:
            pass
    values = read_values(path)
    wrong = problems(values)
    if wrong:
        sys.exit('\n'.join('%s: %s' % (os.path.basename(path), w) for w in wrong))

    def listed(key):
        return [s.strip() for s in values.get(key, '').split(',') if s.strip()]

    # Each module's switch: on only with true (the TV also wants what the module needs).
    switches = {name: values.get(SWITCHES[name], '').lower() == 'true' for name in MODULES}
    city = values.get('city', '')
    lat, lon = values.get('latitude', ''), values.get('longitude', '')
    if city and not (lat and lon):
        lat, lon, city = locate(city)

    return {
        'latitude': lat,
        'longitude': lon,
        'city': city,
        'name': values.get('name', ''),
        'language': values.get('language', ''),
        'temperature': values.get('temperature', ''),
        'staseraUrl': values.get('stasera_url', '').rstrip('/'),
        'staseraName': values.get('stasera_name', ''),
        'githubToken': values.get('github_token', ''),
        'githubHide': listed('github_hide'),
        'vercelToken': values.get('vercel_token', ''),
        'vercelTeam': values.get('vercel_team', ''),
        'youtubeClientId': values.get('youtube_client_id', ''),
        'youtubeClientSecret': values.get('youtube_client_secret', ''),
        'homeAssistantUrl': values.get('home_assistant_url', '').rstrip('/'),
        'homeAssistantToken': values.get('home_assistant_token', ''),
        'spotifyClientId': values.get('spotify_client_id', ''),
        'spotifyRefreshToken': values.get('spotify_refresh_token', ''),
        'artUrl': values.get('art_url', '').rstrip('/'),
        'artKey': values.get('art_key', ''),
        'setupKey': values.get('setup_key', ''),
        **{name: listed(key) for key, name in LISTS.items()},
        **{name: int(values[key]) if values.get(key) else '' for key, name in WHOLE.items()},
        **{name: values.get(key, '') for key, name in TEXTS.items()},
        **switches,
    }


def locate(city):
    """(latitude, longitude, name) for a city ("Bergen", or "Bergen, NO" to pick the country), from Open-Meteo's
    geocoding; without an answer, empty places and a warning (the TV's time zone decides then)."""
    name, _, country = (p.strip() for p in city.partition(','))
    url = 'https://geocoding-api.open-meteo.com/v1/search?' + urllib.parse.urlencode(
        {'name': name, 'count': 10, 'format': 'json'})
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            results = json.load(r).get('results') or []
    except (OSError, ValueError) as e:
        print('Could not look up the city "%s" (%s): the TV\'s time zone picks one.' % (city, e))
        return '', '', ''
    for r in results:
        if not country or r.get('country_code', '').lower() == country.lower():
            return str(r['latitude']), str(r['longitude']), r.get('name') or name
    print('Found no city called "%s": the TV\'s time zone picks one.' % city)
    return '', '', ''


def catalogues():
    """Each language's catalogue (i18n/), with only the keys the web app uses: {lang: {key: text}}."""
    keys = translate.web_keys()
    return {lang: {k: v for k, v in sorted(translate.load(lang).items()) if k in keys} for lang in translate.languages()}


def files(config, made_by):
    """The web app's files, {path inside the app: bytes}: web/ with its folders, the settings and the catalogues."""
    out = {}
    web = os.path.join(ROOT, 'web')
    for dirpath, _, names in os.walk(web):
        for name in sorted(names):
            if name == '.DS_Store':
                continue
            path = os.path.join(dirpath, name)
            with open(path, 'rb') as f:
                out[os.path.relpath(path, web).replace(os.sep, '/')] = f.read()
    out['config.js'] = config_js(config, made_by)
    out['i18n.js'] = ('/* Generated by %s from i18n/. */\nwindow.I18N_CATALOGUES = %s;\n'
                      % (made_by, json.dumps(catalogues(), ensure_ascii=False, separators=(',', ':')))).encode('utf-8')
    return out


def config_js(config, made_by):
    return ('/* Generated by %s. */\nwindow.CONFIG = %s;\n'
            % (made_by, json.dumps(config, ensure_ascii=False))).encode('utf-8')


def without_secrets(config):
    """The settings with every token, key and secret empty, as in the example: the preview's, so the modules show
    their sample data and a served out/tizen gives away no token. Frame Art's address goes too: with it, web/art.js
    calls the add-on instead of showing its sample."""
    return {k: '' if re.search(r'(Token|Key|Secret)$', k) or k == 'artUrl' else v for k, v in config.items()}


def preview(app, out_dir):
    """Leaves the app's files in out_dir, to open index.html in a browser; only this user can read them."""
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, mode=0o700)
    for path, content in app.items():
        target = os.path.join(out_dir, path)
        os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
        with open_private(target) as f:
            f.write(content)
