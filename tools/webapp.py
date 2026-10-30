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
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import translate  # noqa: E402  (the catalogues and the keys the web app uses)

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


def read_values(path):
    """The file's key=value lines as {key: value}."""
    values = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('"')
    return values


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
        shutil.copy(os.path.join(ROOT, 'config.example.properties'), path)
        print('Created config.properties: add your Stasera address and your city there, then build again.')
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
    out['config.js'] = ('/* Generated by %s. */\nwindow.CONFIG = %s;\n'
                        % (made_by, json.dumps(config, ensure_ascii=False))).encode('utf-8')
    out['i18n.js'] = ('/* Generated by %s from i18n/. */\nwindow.I18N_CATALOGUES = %s;\n'
                      % (made_by, json.dumps(catalogues(), ensure_ascii=False, separators=(',', ':')))).encode('utf-8')
    return out


def preview(app, out_dir):
    """Leaves the app's files in out_dir, to open index.html in a browser."""
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    for path, content in app.items():
        target = os.path.join(out_dir, path)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'wb') as f:
            f.write(content)
