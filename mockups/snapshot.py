#!/usr/bin/env python3
"""Snapshot of real data for the Kino mockups (AUG-1452).

Reads the Stasera account the TV is linked to (dev deployment, read only, through `npx convex run --identity`),
adds TMDB logos, overviews and stills, YouTube RSS, local commits and GitHub repos, and writes
mockups/data/snapshot.js plus the images in mockups/img/. Both are gitignored: they hold personal data.

    python3 mockups/snapshot.py
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STASERA = os.path.expanduser('~/Utvikling/stasera')
DEV = os.path.expanduser('~/Utvikling')
USER_ID = os.environ.get('STASERA_USER_ID', '')  # the Stasera account the TV is linked to
IMG = os.path.join(HERE, 'img')

# The apps on the TV, and how Stasera names the same services.
APPS = ['Apple TV', 'TV 2 Play', 'Viaplay', 'Netflix', 'YouTube', 'Max', 'Disney+', 'NRK TV', 'Prime Video', 'VG TV']
PROVIDER_APP = {'Apple TV': 'Apple TV', 'Apple TV Plus': 'Apple TV', 'TV 2 Play': 'TV 2 Play', 'Viaplay': 'Viaplay',
                'Netflix': 'Netflix', 'HBO Max': 'Max', 'Max': 'Max', 'Disney Plus': 'Disney+', 'NRK TV': 'NRK TV',
                'Amazon Prime Video': 'Prime Video', 'Prime Video': 'Prime Video', 'VG+': 'VG TV'}
# Norwegian broadcasters Stasera knows as networks, for titles with no streaming provider listed.
NETWORK_APP = {'TV 2': 'TV 2 Play', 'TV 2 Direkte': 'TV 2 Play', 'TV 2 Play': 'TV 2 Play', 'TVNorge': 'Max',
               'NRK1': 'NRK TV', 'NRK2': 'NRK TV', 'NRK3': 'NRK TV', 'NRK P3': 'NRK TV', 'VGTV': 'VG TV'}

YT_CHANNELS = ['UCBJycsmduvYEL83R_U4JriQ', 'UCsXVk37bltHxD1rDPwtNM8Q', 'UCHnyfMqiRRG1u-2MsSQLbXA',
               'UCY1kMZp36IQSyNx_9h4mpCg', 'UCXuqSBlHAE6Xw-yeJA0Tunw', 'UCBa659QWEk1AI4Tg--mrJ2A',
               'UCtinbF-Q-fVthA0qrFQTgXQ', 'UCWFKCr40YwOZQx8FHU_ZqqQ']


def convex(fn, args=None):
    identity = json.dumps({'subject': USER_ID + '|mockup', 'tokenIdentifier': 'mockup'})
    cmd = ['npx', 'convex', 'run', fn, json.dumps(args or {})]
    if fn.split(':')[0] != 'tv':  # the tv:*ForDevice queries are internal and take the user id instead
        cmd += ['--identity', identity]
    out = subprocess.run(cmd,
                         cwd=STASERA, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def tmdb_key():
    with open(os.path.join(ROOT, 'config.properties')) as f:
        for line in f:
            if line.startswith('tmdb_key=') and line.split('=', 1)[1].strip():
                return line.split('=', 1)[1].strip()
    # Fall back to Stasera's own key in its dev deployment.
    key = subprocess.run(['npx', 'convex', 'env', 'get', 'TMDB_API_KEY'], cwd=STASERA,
                         capture_output=True, text=True).stdout.strip()
    if not key:
        sys.exit('No TMDB key: set tmdb_key in config.properties')
    return key


KEY = tmdb_key()


def tmdb(path, **params):
    headers = {}
    if len(KEY) > 40:
        headers['Authorization'] = 'Bearer ' + KEY
    else:
        params['api_key'] = KEY
    url = 'https://api.themoviedb.org/3' + path + '?' + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as r:
                return json.load(r)
        except Exception:
            if attempt == 2:
                return {}
            time.sleep(1)


downloads = {}


def image(url, sub):
    """Local path for a remote image, queued for download."""
    if not url:
        return None
    name = re.sub(r'[^A-Za-z0-9._-]', '_', url.split('/')[-1].split('?')[0])
    if sub in ('y', 'yh'):
        name = url.split('/vi/')[1].split('/')[0] + '.jpg'
    rel = 'img/%s/%s' % (sub, name)
    downloads[rel] = url
    return rel


def tmdb_img(path, size, sub):
    return image('https://image.tmdb.org/t/p/%s%s' % (size, path), sub) if path else None


def app_for(providers, networks=()):
    for p in providers or []:
        if p in PROVIDER_APP:
            return PROVIDER_APP[p]
    for n in networks or []:
        if n in NETWORK_APP:
            return NETWORK_APP[n]
    return (providers or [None])[0]


def has_alpha(path):
    """True unless the PNG is plain RGB or grey: some TMDB logos come on a black box."""
    req = urllib.request.Request('https://image.tmdb.org/t/p/w92' + path, headers={'Range': 'bytes=0-63'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            head = r.read(64)
    except Exception:
        return False
    return head[:4] == b'\x89PNG' and head[25] not in (0, 2)


def pick_logo(images):
    logos = [l for l in images.get('logos') or [] if not l['file_path'].endswith('.svg')]
    for lang in ('no', 'nb', 'en', None):
        for l in sorted(logos, key=lambda l: -(l.get('vote_average') or 0)):
            if l.get('iso_639_1') == lang and has_alpha(l['file_path']):
                return l['file_path']
    return None


def clean_backdrop(images):
    """The best backdrop without text in it, so a logo on top doesn't double the title."""
    plain = [b for b in images.get('backdrops') or [] if b.get('iso_639_1') is None]
    plain.sort(key=lambda b: -(b.get('vote_average') or 0) * (b.get('vote_count') or 0) - b.get('width', 0) / 1e6)
    return plain[0]['file_path'] if plain else None


def details(kind, tmdb_id):
    path = '/tv/%d' % tmdb_id if kind == 'show' else '/movie/%d' % tmdb_id
    d = tmdb(path, language='nb-NO', append_to_response='images', include_image_language='no,nb,en,null')
    overview = d.get('overview')
    if not overview:
        overview = tmdb(path, language='en-US').get('overview')
    year = (d.get('first_air_date') or d.get('release_date') or '')[:4]
    return {
        'overview': overview or '',
        'genres': [g['name'] for g in d.get('genres', [])][:2],
        'year': year,
        'logo': tmdb_img(pick_logo(d.get('images') or {}), 'w500', 'l'),
        'clean': clean_backdrop(d.get('images') or {}),
        'networks': [n['name'] for n in d.get('networks', [])],
        'seasons': d.get('number_of_seasons'),
        'runtime': d.get('runtime'),
        'vote': round(d.get('vote_average') or 0, 1),
    }


def episode(tmdb_id, season, number):
    e = tmdb('/tv/%d/season/%d/episode/%d' % (tmdb_id, season, number), language='nb-NO')
    if not e.get('overview'):
        en = tmdb('/tv/%d/season/%d/episode/%d' % (tmdb_id, season, number), language='en-US')
        e['overview'] = en.get('overview')
    return {'still': tmdb_img(e.get('still_path'), 'w780', 's'), 'overview': e.get('overview') or ''}


def show_card(r, extra):
    d = extra[('show', r['showTmdbId'])]
    return {
        'kind': 'show', 'id': r['showTmdbId'], 'title': r['showName'],
        'backdrop': tmdb_img(d['clean'] or r['backdropPath'], 'w780', 'b'),
        'hero': tmdb_img(d['clean'] or r['backdropPath'], 'w1280', 'h'),
        'poster': tmdb_img(r['posterPath'], 'w342', 'p'),
        'season': r['seasonNumber'], 'episode': r['episodeNumber'],
        'episodeName': r.get('localizedEpisodeName') or r.get('episodeName'),
        'airDate': r.get('airDate'), 'runtime': r.get('runtime'), 'watched': r['watched'], 'total': r['total'], 'remaining': r['remaining'],
        'app': app_for(r.get('providers'), d['networks']), 'providers': r.get('providers') or [],
        'overview': d['overview'], 'genres': d['genres'], 'year': d['year'], 'logo': d['logo'], 'vote': d['vote'],
        'lastWatchedAt': r.get('lastWatchedAt'), 'followedAt': r.get('followedAt'),
    }


def main():
    now = int(time.time() * 1000)
    print('Stasera …')
    rows = convex('tonight:listTonight')
    tv_tonight = {r['tmdbId']: r for r in convex('tv:tonightForDevice', {'userId': USER_ID, 'now': now})}
    upcoming = convex('tv:upcomingForDevice', {'userId': USER_ID, 'today': time.strftime('%Y-%m-%d'), 'days': 14})
    recs = convex('tv:recommendationsForDevice', {'userId': USER_ID})
    movies = convex('movies:listMovies')
    feed = convex('friendActivity:listFriendFeed')
    stats = convex('userStats:getUserStats').get('stats') or {}

    for r in rows:
        r['providers'] = (tv_tonight.get(r['showTmdbId']) or {}).get('providers', [])
    watching = sorted([r for r in rows if r['watched'] > 0], key=lambda r: -r['lastWatchedAt'])
    unstarted = sorted([r for r in rows if r['watched'] == 0], key=lambda r: -r['followedAt'])[:16]
    watchlist = sorted([m for m in movies if m.get('listType') == 'watchlist'], key=lambda m: -m['addedAt'])[:10]

    print('TMDB …')
    wanted = [('show', r['showTmdbId']) for r in watching + unstarted]
    wanted += [('movie', m['movieTmdbId']) for m in watchlist]
    wanted += [('show' if u['kind'] == 'episode' else 'movie', u['tmdbId']) for u in upcoming]
    wanted = list(dict.fromkeys(wanted))
    with ThreadPoolExecutor(8) as pool:
        extra = dict(zip(wanted, pool.map(lambda k: details(*k), wanted)))
        eps = dict(zip([r['showTmdbId'] for r in watching[:8]],
                       pool.map(lambda r: episode(r['showTmdbId'], r['seasonNumber'], r['episodeNumber']),
                                watching[:8])))

    watching_cards = []
    for r in watching:
        c = show_card(r, extra)
        if r['showTmdbId'] in eps:
            c['still'] = eps[r['showTmdbId']]['still']
            c['episodeOverview'] = eps[r['showTmdbId']]['overview']
        watching_cards.append(c)

    want_cards = [show_card(r, extra) for r in unstarted]
    for m in watchlist:
        d = extra[('movie', m['movieTmdbId'])]
        want_cards.append({
            'kind': 'movie', 'id': m['movieTmdbId'], 'title': m['title'],
            'backdrop': tmdb_img(d['clean'] or m.get('backdropPath'), 'w780', 'b'),
            'hero': tmdb_img(d['clean'] or m.get('backdropPath'), 'w1280', 'h'),
            'poster': tmdb_img(m.get('localizedPosterPath') or m.get('posterPath'), 'w342', 'p'),
            'runtime': d['runtime'], 'overview': d['overview'], 'genres': d['genres'], 'year': d['year'],
            'logo': d['logo'], 'vote': d['vote'], 'app': None, 'followedAt': m['addedAt'],
        })
    # Shows and movies mixed, newest first, the way the row would read.
    want_cards.sort(key=lambda c: -(c.get('followedAt') or 0))

    upcoming_cards = []
    for u in upcoming:
        k = ('show' if u['kind'] == 'episode' else 'movie', u['tmdbId'])
        d = extra[k]
        upcoming_cards.append({
            'kind': u['kind'], 'id': u['tmdbId'], 'title': u['title'], 'date': u['date'],
            'season': u.get('seasonNumber'), 'episode': u.get('episodeNumber'), 'episodeName': u.get('episodeName'),
            'backdrop': tmdb_img(d['clean'] or u.get('backdropPath'), 'w780', 'b'),
            'hero': tmdb_img(d['clean'] or u.get('backdropPath'), 'w1280', 'h'),
            'poster': tmdb_img(u.get('posterPath'), 'w342', 'p'), 'app': app_for(u.get('providers'), d['networks']),
            'overview': d['overview'], 'genres': d['genres'], 'year': d['year'], 'logo': d['logo'],
        })

    feed_cards = []
    for f in feed:
        meta = f['entity'].get('meta') or {}
        feed_cards.append({
            'kind': f['kind'], 'at': f['at'], 'friend': f['friend']['name'], 'detail': f.get('detail'),
            'title': meta.get('title') or meta.get('name'), 'entity': f['entity']['kind'],
            'backdrop': tmdb_img(meta.get('backdropPath'), 'w780', 'b'),
            'poster': tmdb_img(meta.get('posterPath'), 'w342', 'p'), 'count': f.get('count'),
            'together': bool(f.get('partner') and f['partner'].get('isViewer')),
        })

    print('YouTube …')
    youtube = []
    for ch in YT_CHANNELS:
        try:
            with urllib.request.urlopen('https://www.youtube.com/feeds/videos.xml?channel_id=' + ch, timeout=20) as r:
                xml = r.read().decode('utf-8')
        except Exception:
            continue
        name = re.search(r'<name>(.*?)</name>', xml).group(1)
        for vid, title, published, views in re.findall(
                r'<yt:videoId>(.*?)</yt:videoId>.*?<title>(.*?)</title>.*?<published>(.*?)</published>'
                r'.*?<media:statistics views="(\d+)"', xml, re.S)[:2]:
            youtube.append({'channel': name, 'id': vid, 'title': html_unescape(title), 'published': published,
                            'views': int(views),
                            'thumb': image('https://i.ytimg.com/vi/%s/hqdefault.jpg' % vid, 'y'),
                            'hero': image('https://i.ytimg.com/vi/%s/maxresdefault.jpg' % vid, 'yh')})
    youtube.sort(key=lambda v: v['published'], reverse=True)

    print('GitHub …')
    days, per_repo, last = Counter(), Counter(), {}
    since = time.strftime('%Y-%m-%d', time.localtime(time.time() - 182 * 86400))
    for d in sorted(os.listdir(DEV)):
        if not os.path.isdir(os.path.join(DEV, d, '.git')):
            continue
        log = subprocess.run(['git', '-C', os.path.join(DEV, d), 'log', '--branches', '--since=' + since,
                              '--format=%ad|%s', '--date=short'], capture_output=True, text=True).stdout
        for line in log.splitlines():
            day, _, msg = line.partition('|')
            days[day] += 1
            per_repo[d] += 1
            if d not in last or day > last[d]['day']:
                last[d] = {'day': day, 'message': msg[:90]}
    repos = json.loads(subprocess.run(
        ['gh', 'api', 'user/repos?sort=pushed&per_page=10&affiliation=owner'],
        capture_output=True, text=True).stdout or '[]')
    github = {
        'days': dict(days),
        'repos': [{'name': r['name'], 'pushedAt': r['pushed_at'], 'language': r.get('language'),
                   'commits': per_repo.get(r['name'], 0), 'last': last.get(r['name'])} for r in repos],
    }

    s = stats
    stasera_stats = {k: s.get(k) for k in (
        'totalEpisodes', 'totalMovies', 'totalShows', 'totalRuntimeMinutes', 'episodeRuntimeMinutes',
        'movieRuntimeMinutes', 'byYear', 'byMonth', 'byWeek', 'activeDays', 'longestStreakDays',
        'currentStreakDays', 'backlog', 'catchUp', 'followedShows', 'followedInProduction', 'showGenres',
        'topNetworks', 'ratings', 'computedAt')}
    stasera_stats['hourCounts'] = (s.get('badgeInputs') or {}).get('hourCounts')
    stasera_stats['completions'] = (s.get('badgeInputs') or {}).get('completions')
    stasera_stats['topShows'] = [{'title': t['name'], 'episodes': t['episodes'], 'minutes': t.get('runtimeMinutes'),
                                  'backdrop': tmdb_img(t.get('backdropPath'), 'w780', 'b')}
                                 for t in (s.get('topShowsByTime') or [])[:5]]

    data = {
        'generatedAt': now, 'apps': APPS,
        'watching': watching_cards, 'wantToStart': want_cards, 'upcoming': upcoming_cards,
        'recommendations': [{'kind': r['kind'], 'id': r['tmdbId'], 'title': r['title'], 'year': r.get('year'),
                             'backdrop': tmdb_img(r.get('backdropPath'), 'w780', 'b'),
                             'poster': tmdb_img(r.get('posterPath'), 'w342', 'p'),
                             'app': app_for(r.get('providers'))} for r in recs],
        'friends': feed_cards, 'stats': stasera_stats, 'youtube': youtube, 'github': github,
    }

    print('Images: %d …' % len(downloads))
    with ThreadPoolExecutor(12) as pool:
        list(pool.map(lambda kv: fetch(*kv), downloads.items()))
    # Tiny copies for the glow around the screen in hero C: stretched to full screen they come out soft by
    # themselves, which a TV draws far cheaper than filter: blur.
    os.makedirs(os.path.join(IMG, 'a'), exist_ok=True)
    for sub in ('b', 'y'):
        for name in os.listdir(os.path.join(IMG, sub)):
            out = os.path.join(IMG, 'a', name)
            if not os.path.exists(out):
                subprocess.run(['sips', '-Z', '64', os.path.join(IMG, sub, name), '--out', out], capture_output=True)

    os.makedirs(os.path.join(HERE, 'data'), exist_ok=True)
    with open(os.path.join(HERE, 'data', 'snapshot.js'), 'w') as f:
        f.write('// Generated by mockups/snapshot.py. Personal data: not committed.\nvar SNAPSHOT = ')
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write(';\n')
    print('Wrote mockups/data/snapshot.js: %d watching, %d want to start, %d upcoming, %d friends, %d videos'
          % (len(watching_cards), len(want_cards), len(upcoming_cards), len(feed_cards), len(youtube)))


def html_unescape(s):
    import html
    return html.unescape(s)


def fetch(rel, url):
    path = os.path.join(HERE, rel)
    if os.path.exists(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        with urllib.request.urlopen(url, timeout=30) as r, open(path, 'wb') as f:
            f.write(r.read())
    except Exception as e:
        print('  missing', url, e)


if __name__ == '__main__':
    main()
