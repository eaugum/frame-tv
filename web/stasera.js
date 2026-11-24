/*
 * Stasera (stasera.app), the TV and movie tracker: what we're watching, what we want to start, the watchlist's movies
 * that stream here, what friends watch and the stats, all from one call (GET /tv/home). On with stasera_url in
 * config.properties (stasera=false turns it off, and then it asks nothing); the TV is linked once
 * from Home Settings → Stasera with a QR code, and keeps a token for its account. The last answer stays in localStorage,
 * so the home screen draws it at once and asks again in the background. An error keeps the last answer; a 401 unlinks.
 * search() looks titles up for the search tab (GET /tv/search); title() and want() are the title page's
 * (GET /tv/title, POST /tv/want), and person() the page of someone in its cast (GET /tv/person). /tv/home also gives Hjem's greeting for the TV's hour, picked by Stasera as on its
 * own home page and finished in the TV's language (nb or en); an older Stasera doesn't, and then home.js greets by
 * itself.
 */
var Stasera = (function () {
  'use strict';

  var BASE = Settings.get('staseraUrl').replace(/\/+$/, '');
  var ON = !!BASE && Modules.on('stasera');
  var TOKEN = 'fmtv.stasera.token', CACHE = 'fmtv.stasera.home2';
  var EVERY = 5 * 60000, POLL = 3000;
  var EMPTY = {watching: [], watchingCount: 0, shelves: null, wantToStart: [], movies: [], friends: [], stats: null};

  // The fields home.js shows as text, and those it counts with: another type is made one (5 → '5') or left out.
  var TEXT = ['title', 'episodeName', 'episodeOverview', 'overview', 'airDate', 'releaseDate', 'friendName', 'kind',
    'together', 'status', 'network', 'month', 'posterPath', 'backdropPath', 'textlessBackdropPath', 'logoPath', 'stillPath'];
  var NUMBERS = ['year', 'seasonNumber', 'episodeNumber', 'watched', 'total', 'runtime', 'remaining', 'count', 'minutes',
    'episodes'];
  // Names that would hide Object's own (a value there makes String() or a lookup throw).
  var OWN = /^(toString|valueOf|hasOwnProperty|toLocaleString|isPrototypeOf|propertyIsEnumerable|constructor|__proto__|toJSON)$/;

  var token = null, data = EMPTY, at = 0, name = '', hello = null, askedFor = '', askedMe = false;
  try {
    token = localStorage.getItem(TOKEN);
    localStorage.removeItem('fmtv.stasera');   // the lists before /tv/home
    // Checked as an answer is (and movies saved before AUG-1477 become a list).
    var c = JSON.parse(localStorage.getItem(CACHE));
    if (c && token && c.data && typeof c.data === 'object') {
      data = clean(c.data, c.data.shelves);
      at = typeof c.at === 'number' && isFinite(c.at) ? c.at : 0;
      name = text(c.name);
      hello = c.hello && text(c.hello.text) && text(c.hello.lang) && typeof c.hello.at === 'number' ? c.hello : null;
    }
    // A link sent to config.properties (AUG-1521): a new one there wins once, so unlinking on the TV stays.
    var seed = Settings.get('staseraToken');
    if (seed && localStorage.getItem('fmtv.stasera.seed') !== seed) {
      if (token !== seed) { token = seed; data = EMPTY; at = 0; name = ''; hello = null; }
      localStorage.setItem('fmtv.stasera.seed', seed);
      localStorage.setItem(TOKEN, token);
    }
  } catch (e) {}

  var listeners = [];
  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }
  function save() { try { localStorage.setItem(CACHE, JSON.stringify({data: data, at: at, name: name, hello: hello})); } catch (e) {} }

  /** One call to Stasera's API; done(status, json). Status 0: no connection. */
  function request(method, path, body, done) {
    var x = new XMLHttpRequest(), over = false;
    try {
      // An address the browser can't parse, or a token outside Latin-1, throws here: no connection, not a crash.
      x.open(method, BASE + path, true);
      x.timeout = 15000;
      x.setRequestHeader('Accept', 'application/json');
      if (body) x.setRequestHeader('Content-Type', 'application/json');
      if (token && path.indexOf('/tv/pair/') !== 0) x.setRequestHeader('Authorization', 'Bearer ' + token);
    } catch (e) {
      setTimeout(function () { done(0, null); }, 0);
      return;
    }
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      var json = null;
      try { json = JSON.parse(x.responseText); } catch (e) {}
      done(x.status, json);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(0, null); } };
    try { x.send(body ? JSON.stringify(body) : null); } catch (e) { over = true; setTimeout(function () { done(0, null); }, 0); }
  }

  /** The token no longer works (unlinked on the phone, or the account is gone). */
  function forget() {
    token = null;
    data = EMPTY;
    at = 0;
    name = '';
    hello = null;
    askedMe = false;
    try { localStorage.removeItem(TOKEN); localStorage.removeItem(CACHE); } catch (e) {}
    changed();
  }

  // MARK: - Linking

  var pairing = null, pollTimer = 0;

  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = 0;
  }

  /** Asks for a code; done(error) when it couldn't. The QR and the code are in pairing() until it's approved. */
  function link(deviceName, done) {
    stopPolling();
    pairing = null;
    request('POST', '/tv/pair/start', {name: deviceName}, function (status, json) {
      if (status !== 200 || !json || !json.secret) { done(new Error(status === 429 ? 'busy' : 'offline')); return; }
      pairing = json;
      done(null);
      changed();
      poll();
    });
  }

  function poll() {
    pollTimer = setTimeout(function () {
      if (!pairing) return;
      request('POST', '/tv/pair/poll', {secret: pairing.secret}, function (status, json) {
        if (!pairing) return;
        if (status === 200 && json && json.status === 'approved' && json.token) {
          token = json.token;
          try { localStorage.setItem(TOKEN, token); } catch (e) {}
          pairing = null;
          at = 0;
          changed();
          refresh();
        } else if (status === 410 || Date.now() > pairing.expiresAt) {
          pairing = null;   // expired: home.js offers a new code
          changed();
        } else {
          poll();
        }
      });
    }, POLL);
  }

  function cancel() {
    stopPolling();
    pairing = null;
  }

  // MARK: - What it shows

  var fetching = false, failedAt = 0, askingMe = false;

  /** The local date (yyyy-mm-dd): the stats' month and year are the TV's, not UTC's. */
  function today() {
    var d = new Date();
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  /** A real list, cut short; anything else is empty. */
  function list(v) { return Object.prototype.toString.call(v) === '[object Array]' ? v.slice(0, 500) : []; }
  function text(v) { return typeof v === 'string' ? v : ''; }
  function isObject(v) { return !!v && typeof v === 'object' && Object.prototype.toString.call(v) !== '[object Array]'; }
  function objects(v) { return list(v).map(item).filter(isObject); }
  /** A title the home screen can draw: an object with its name. */
  function isTitle(v) { return isObject(v) && typeof v.title === 'string'; }

  /** JSON without what can't be shown: numbers that aren't finite, Object's own names; three levels deep. */
  function plain(v, depth) {
    if (typeof v === 'string' || typeof v === 'boolean' || v === null) return v;
    if (typeof v === 'number') return isFinite(v) ? v : undefined;
    if (!v || typeof v !== 'object' || depth <= 0) return undefined;
    if (Object.prototype.toString.call(v) === '[object Array]') {
      return list(v).map(function (x) { return plain(x, depth - 1); }).filter(function (x) { return x !== undefined; });
    }
    var out = {};
    for (var k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k) || OWN.test(k)) continue;
      var x = plain(v[k], depth - 1);
      if (x !== undefined) out[k] = x;
    }
    return out;
  }

  /** One title, friend's entry or stats row, with TEXT as text and NUMBERS as numbers; one that isn't an object: null. */
  function item(v) {
    var o = plain(v, 3), i, k;
    if (!isObject(o)) return null;
    for (i = 0; i < TEXT.length; i++) {
      k = TEXT[i];
      if (!o.hasOwnProperty(k) || o[k] === null || typeof o[k] === 'string') continue;
      if (typeof o[k] === 'number') o[k] = String(o[k]);
      else delete o[k];
    }
    for (i = 0; i < NUMBERS.length; i++) {
      k = NUMBERS[i];
      if (!o.hasOwnProperty(k) || o[k] === null || typeof o[k] === 'number') continue;
      var n = typeof o[k] === 'string' && o[k] !== '' ? Number(o[k]) : NaN;
      if (isFinite(n)) o[k] = n;
      else delete o[k];
    }
    if (o.hasOwnProperty('entity')) o.entity = item(o.entity);
    return o;
  }

  /**
   * /tv/home's answer (or the one kept from an earlier start) with what home.js relies on checked: lists are real
   * lists of titles, and the stats' lists too, so a bad answer costs Stasera's tiles at most and never the start.
   * shelves: watchingShelves from the answer, or the kept shelves; their indexes follow the titles that are kept.
   */
  function clean(o, shelves) {
    var all = list(o.watching), watching = [], at = {}, i;
    for (i = 0; i < all.length; i++) {
      var t = item(all[i]);
      if (isTitle(t)) { at[i] = watching.length; watching.push(t); }
    }
    var sh = shelvesOf(shelves, all.length);
    if (sh) {
      for (var k in sh) {
        if (sh.hasOwnProperty(k)) sh[k] = sh[k].filter(function (n) { return at[n] !== undefined; }).map(function (n) { return at[n]; });
      }
    }
    var count = o.watchingCount;
    return {
      watching: watching, watchingCount: typeof count === 'number' && isFinite(count) && count > 0 ? count : watching.length,
      shelves: sh, wantToStart: objects(o.wantToStart).filter(isTitle), movies: objects(o.movies).filter(isTitle),
      friends: objects(o.friends).filter(function (f) { return isObject(f.entity); }), stats: cleanStats(o.stats)
    };
  }

  /** The stats' lists as real lists of objects, and hourCounts as up to 24 numbers. */
  function cleanStats(s) {
    if (!isObject(s)) return null;
    var out = {}, k;
    for (k in s) if (Object.prototype.hasOwnProperty.call(s, k)) out[k] = s[k];
    out.hourCounts = list(s.hourCounts).slice(0, 24).map(function (n) { return typeof n === 'number' && isFinite(n) ? n : 0; });
    var lists = ['byMonth', 'byYear', 'topShowsByTime', 'topShowsLast30Days', 'topNetworks'];
    for (var i = 0; i < lists.length; i++) if (s[lists[i]] !== undefined && s[lists[i]] !== null) out[lists[i]] = objects(s[lists[i]]);
    if (s.completions !== undefined) out.completions = isObject(s.completions) ? item(s.completions) : null;
    if (out.completions) out.completions.latest = objects(out.completions.latest);
    if (s.backlog !== undefined && !isObject(s.backlog)) out.backlog = null;
    return out;
  }

  /** The greeting's language: Stasera has Norwegian and English. */
  function lang() { return I18N.base === 'nb' ? 'nb' : 'en'; }

  /** The TV's date, hour and language: a new one asks again, since Hjem's greeting can change with it. */
  function hour() { return today() + 'T' + new Date().getHours() + ':' + lang(); }

  /**
   * Stasera's split of Watching into Home's rows (AUG-1718): {watching, stale, newSeason}, each a list of indexes into
   * watching. null from a Stasera without it; then Watching stays one row.
   */
  function shelvesOf(s, n) {
    if (!s || typeof s !== 'object') return null;
    function ix(a) { return list(a).filter(function (i) { return typeof i === 'number' && i >= 0 && i < n; }); }
    return {watching: ix(s.watching), stale: ix(s.stale), newSeason: ix(s.newSeason)};
  }

  function refresh(force) {
    if (!ON || !token || fetching) return;
    var t = Date.now(), h = hour();
    if (!force && t - at < EVERY && t >= at && askedFor === h) return;
    if (!force && failedAt && t - failedAt < 60000) return;
    fetching = true;
    var path = '/tv/home?today=' + today() + '&hour=' + new Date().getHours() + '&lang=' + lang();
    request('GET', path, null, function (status, json) {
      fetching = false;   // first, so a listener that throws can't leave it set
      if (status === 401) { forget(); return; }
      if (status !== 200 || !isObject(json)) { failedAt = Date.now(); return; }   // keep the last answer
      data = clean(json, json.watchingShelves);
      at = Date.now();
      var g = json.greeting;
      // Without lang it is an older Stasera's, in English with the first name: home.js greets by itself then.
      hello = g && text(g.text) && text(g.lang) ? {text: g.text, lang: g.lang, at: at} : null;
      askedFor = h;
      failedAt = 0;
      save();
      askMe();
      changed();
    });
  }

  /** Once per start: the TV can be renamed in Stasera. */
  function askMe() {
    if (askedMe || askingMe) return;
    askingMe = true;
    request('GET', '/tv/me', null, function (s2, me) {
      askingMe = false;
      if (s2 !== 200 || !me) return;
      askedMe = true;
      name = text(me.name) || name;
      save();
    });
  }

  // Some of the services and channels Stasera names lead to an app under another name.
  var ALIAS = {'TVNorge': 'Max', 'VGTV': 'VG TV', 'VG+': 'VG TV'};

  /** The service of a title among the TV's apps ({key, name}), from its providers, then its channels. */
  function service(item) {
    if (!item) return null;
    var names = list(item.providers).concat(list(item.networks)).filter(function (n) { return typeof n === 'string'; });
    for (var i = 0; i < names.length; i++) if (ALIAS[names[i]]) names[i] = ALIAS[names[i]];
    return Data.serviceFor(names);
  }

  // MARK: - Search

  // As Stasera's own search (lib/search.ts): shorter queries aren't sent.
  var MIN_QUERY = 3;

  // The browser preview while the server has no /tv/search: our own titles, then these (seasons, or a movie's
  // minutes, and the overview for the title page).
  var SAMPLE = [
    ['Severance', 2022, 'tv', ['Apple TV+'], 'watching', 2,
      'Mark leads a team of office workers whose memories have been surgically divided between work and home.'],
    ['Exit', 2019, 'tv', ['NRK TV'], 'watched', 4, 'Four rich men in Oslo, and what their money lets them get away with.'],
    ['Succession', 2018, 'tv', ['Max'], 'watchlist', 4,
      'The Roy family controls one of the biggest media companies in the world, and its future is up for grabs.'],
    ['Dune: Part Two', 2024, 'movie', ['Max'], null, 167,
      'Paul Atreides unites with Chani and the Fremen on a path of revenge against those who destroyed his family.'],
    ['Stranger Things', 2016, 'tv', ['Netflix'], null, 5,
      'When a young boy vanishes, a small town uncovers a mystery of secret experiments and a strange little girl.'],
    ['Okkupert', 2015, 'tv', ['Viaplay'], null, 3, 'Russia occupies Norway, softly, to keep the oil and gas flowing.']
  ];

  function sampleSearch(q) {
    var out = [], h = data, all = h.watching.concat(h.wantToStart, h.movies), lower = q.toLowerCase(), i;
    for (i = 0; i < all.length; i++) {
      var w = all[i];
      if (w.title.toLowerCase().indexOf(lower) < 0) continue;
      out.push({titleId: w.titleId, type: w.kind === 'movie' ? 'movie' : 'tv', title: w.title, year: w.year, posterPath: w.posterPath,
        providers: list(w.providers), networks: list(w.networks), status: i < h.watching.length ? 'watching' : 'watchlist'});
    }
    for (i = 0; i < SAMPLE.length; i++) {
      var s = SAMPLE[i];
      if (s[0].toLowerCase().indexOf(lower) < 0) continue;
      out.push({titleId: -1 - i, type: s[2], title: s[0], year: s[1], posterPath: null, providers: s[3], networks: [], status: s[4]});
    }
    return out;
  }

  /** Titles in Stasera; done(error, results, sample). Error: 'busy' (429), 'offline' or 'unlinked' (the token is gone). */
  function search(q, done) {
    q = (q || '').replace(/^\s+|\s+$/g, '');
    if (!ON || !token) { done(new Error('unlinked'), []); return; }
    if (q.length < MIN_QUERY) { done(null, []); return; }
    request('GET', '/tv/search?q=' + encodeURIComponent(q), null, function (status, json) {
      if (status === 401) { forget(); done(new Error('unlinked'), []); return; }
      if (status === 200 && json) { done(null, list(json.results)); return; }
      if (TV.name === 'browser' && (status === 0 || status === 404)) { done(null, sampleSearch(q), true); return; }
      done(new Error(status === 429 ? 'busy' : 'offline'), []);
    });
  }

  // MARK: - A title's page

  // The preview's people (negative ids): name, role, birthday, place of birth and a line of biography.
  var PEOPLE = [
    ['Adam Scott', 'Mark Scout', '1973-04-03', 'Santa Cruz, California, USA',
      'An American actor and producer, known for Parks and Recreation, Step Brothers and Severance.'],
    ['Britt Lower', 'Helly R.', '1985-10-02', 'Chicago, Illinois, USA',
      'An American actress, known for Severance, Man Seeking Woman and High Maintenance.'],
    ['Patricia Arquette', 'Harmony Cobel', '1968-04-08', 'Chicago, Illinois, USA',
      'An American actress and director, with an Oscar for Boyhood.'],
    ['John Turturro', 'Irving B.', '1957-02-28', 'Brooklyn, New York, USA',
      'An American actor, writer and director, known for Barton Fink and The Big Lebowski.'],
    ['Christopher Walken', 'Burt G.', '1943-03-31', 'Queens, New York, USA',
      'An American actor with more than a hundred films, from The Deer Hunter to Dune: Part Two.']
  ];

  function sampleCast() {
    var out = [];
    for (var i = 0; i < PEOPLE.length; i++) out.push({personId: -1 - i, name: PEOPLE[i][0], character: PEOPLE[i][1], profilePath: null});
    return out;
  }

  /** The preview's seasons: as many as it has, a year apart. */
  function sampleSeasons(n, year) {
    var out = [];
    for (var i = 1; i <= n; i++) {
      out.push({seasonNumber: i, name: 'Season ' + i, episodeCount: 8 + i, year: year ? year + i - 1 : null, posterPath: null});
    }
    return out;
  }

  /** The preview's details for a title: ours from /tv/home, else the sample's, with people and seasons. */
  function sampleTitle(kind, titleId) {
    var all = data.watching.concat(data.wantToStart, data.movies), out = null, i, k;
    for (i = 0; i < all.length && !out; i++) {
      if (all[i].titleId === titleId && all[i].kind === kind) {
        var w = all[i];
        out = {};
        for (k in w) if (w.hasOwnProperty(k)) out[k] = w[k];
        out.status = i < data.watching.length ? 'watching' : 'watchlist';
        if (w.episodeId) {
          out.nextEpisode = {episodeId: w.episodeId, seasonNumber: w.seasonNumber, episodeNumber: w.episodeNumber,
            name: w.episodeName, overview: w.episodeOverview, stillPath: w.stillPath, airDate: w.airDate, released: true};
        }
      }
    }
    var s = SAMPLE[-1 - titleId];
    if (!out && s) {
      out = {kind: kind, titleId: titleId, title: s[0], year: s[1], providers: s[3], networks: [], status: s[4],
        seasons: kind === 'show' ? s[5] : null, runtime: kind === 'movie' ? s[5] : null, overview: s[6], genres: []};
      if (s[4] === 'watching') {
        out.nextEpisode = {episodeId: 1, seasonNumber: 2, episodeNumber: 5, name: 'Trojan\'s Horse',
          overview: 'Mark and Helly try to find out what Lumon has done with the outies.', stillPath: null, airDate: '2025-02-14',
          released: true};
      }
    }
    if (!out) return null;
    out.cast = sampleCast();
    out.certification = kind === 'movie' ? '12' : '15';
    out.trailerKey = 'xEQP4VVuyrY';
    out.creators = kind === 'show' ? ['Dan Erickson'] : [];
    out.directors = kind === 'movie' ? ['Denis Villeneuve'] : [];
    if (kind === 'show') out.seasonList = sampleSeasons(out.seasons || 2, out.year);
    return out;
  }

  /** The preview's page for a person: the sample titles are what they're known for. */
  function samplePerson(personId) {
    var p = PEOPLE[-1 - personId];
    if (!p) return null;
    var credits = [];
    for (var i = 0; i < SAMPLE.length; i++) {
      var s = SAMPLE[i];
      credits.push({kind: s[2] === 'movie' ? 'movie' : 'show', titleId: -1 - i, title: s[0], year: s[1], posterPath: null,
        backdropPath: null, character: i ? '' : p[1], jobs: [], status: s[4]});
    }
    return {personId: personId, name: p[0], profilePath: null, biography: p[4], birthday: p[2], deathday: null,
      placeOfBirth: p[3], knownForDepartment: 'Acting', credits: credits};
  }

  /** The error for an answer that isn't 200; 'old': Stasera doesn't have the route yet. */
  function failure(status, json) {
    if (status === 401) { forget(); return new Error('unlinked'); }
    if (status === 404 || status === 405) return new Error(json && json.error ? 'notfound' : 'old');
    return new Error(status === 429 ? 'busy' : 'offline');
  }

  /**
   * One title for its page (GET /tv/title): what the cards on Hjem have, seasons or runtime and where it is in the
   * library, and (from AUG-1485) the cast, who made it, the age rating, the trailer, and a show's next episode and
   * seasons. An older Stasera leaves those out. kind: 'show' or 'movie'. done(error, title, sample).
   */
  function title(kind, titleId, done) {
    if (!ON || !token) { done(new Error('unlinked'), null); return; }
    request('GET', '/tv/title?kind=' + kind + '&id=' + titleId, null, function (status, json) {
      if (status === 200 && json && json.title) { done(null, json.title); return; }
      // The sample's ids are negative, and Stasera says no to them.
      if (TV.name === 'browser' && (status === 0 || status === 404 || titleId < 0) && sampleTitle(kind, titleId)) {
        done(null, sampleTitle(kind, titleId), true);
        return;
      }
      done(failure(status, json), null);
    });
  }

  /**
   * A person's page (GET /tv/person): the photo, the biography and the titles they're known for, with where each is
   * in the library. done(error, person, sample).
   */
  function person(personId, done) {
    if (!ON || !token) { done(new Error('unlinked'), null); return; }
    request('GET', '/tv/person?id=' + personId, null, function (status, json) {
      if (status === 200 && json && json.person) { done(null, json.person); return; }
      if (TV.name === 'browser' && (status === 0 || status === 404 || personId < 0) && samplePerson(personId)) {
        done(null, samplePerson(personId), true);
        return;
      }
      done(failure(status, json), null);
    });
  }

  /** Puts a title in Want to Start (POST /tv/want): a show is followed, a movie goes on the watchlist. */
  function want(kind, titleId, done) {
    if (!ON || !token) { done(new Error('unlinked'), null); return; }
    request('POST', '/tv/want', {kind: kind, titleId: titleId}, function (status, json) {
      if (status === 200 && json && json.title) { done(null, json.title); refresh(true); return; }
      if (TV.name === 'browser' && (status === 0 || status === 404) && sampleTitle(kind, titleId)) {
        var t = sampleTitle(kind, titleId);
        if (!t.status) t.status = 'watchlist';
        done(null, t, true);
        return;
      }
      done(failure(status, json), null);
    });
  }

  /** The preview's answer to a mark: the sample with its new place in the library. */
  function sampleMarked(item, undoing, previous) {
    var t = sampleTitle(item.kind, item.titleId);
    if (!t) return null;
    if (item.kind === 'movie') t.status = undoing ? previous : 'watched';
    else if (!undoing && t.nextEpisode) t.nextEpisode.episodeNumber = item.episodeNumber + 1;
    return t;
  }

  /** POST to /tv/watched or /tv/unwatched; done(error, title, changed), and a false changed: nothing to undo. */
  function mark(path, item, previous, done) {
    if (!ON || !token) { done(new Error('unlinked'), null); return; }
    var undoing = path === '/tv/unwatched', body;
    if (item.kind === 'movie') body = {kind: 'movie', titleId: item.titleId};
    else body = {episodeId: item.episodeId};
    if (undoing) { if (item.kind === 'movie') body.previous = previous; }
    else body.localHour = new Date().getHours();
    request('POST', path, body, function (status, json) {
      if (status === 200) { done(null, json && json.title, !json || json.changed !== false); refresh(true); return; }
      if (TV.name === 'browser' && (status === 0 || status === 404 || item.titleId < 0) && sampleMarked(item, undoing, previous)) {
        done(null, sampleMarked(item, undoing, previous), true);
        return;
      }
      // An older Stasera says 400 to a movie.
      done(status === 400 ? new Error('old') : failure(status, json), null);
    });
  }

  return {
    /** The module is on, with stasera_url in config.properties. */
    enabled: function () { return ON; },
    /** This TV has a token for a Stasera account. */
    linked: function () { return ON && !!token; },
    /** The link's token, for "Upload config", or ''. */
    token: function () { return token || ''; },
    /** The name the TV was linked with ("The Frame"). */
    name: function () { return name; },
    /**
     * Hjem's greeting from Stasera, finished in the TV's language ('Ada Lovelace, oppe sent?'), or '': not linked,
     * an older Stasera, an answer in another language than the TV's now, or the last answer is over an hour old.
     */
    greeting: function () {
      var t = Date.now();
      return ON && token && hello && hello.lang === lang() && t - hello.at < 3600000 && t >= hello.at ? hello.text : '';
    },
    onChange: function (fn) { listeners.push(fn); },
    refresh: refresh,
    link: link,
    cancel: cancel,
    unlink: forget,
    /** The code waiting for approval ({code, url, expiresAt}), or null. */
    pairing: function () { return pairing; },
    /** The last answer: {watching, watchingCount, shelves, wantToStart, movies, friends, stats}. */
    home: function () { return ON && token ? data : EMPTY; },
    service: service,
    search: search,
    title: title,
    person: person,
    want: want,
    /** The shortest query search() sends. */
    minQuery: MIN_QUERY,
    /** Photos for the screensaver: what we're watching, then what we want to start and our movies ({title, backdrop}). */
    showcase: function () {
      var out = [], all = data.watching.concat(data.wantToStart, data.movies);
      for (var i = 0; ON && token && i < all.length; i++) {
        var p = all[i].textlessBackdropPath || all[i].backdropPath;
        if (p && service(all[i])) out.push({title: all[i].title, backdrop: p});
      }
      return out;
    },
    /** Marks a movie, or the episode in a show's item, as watched; done(error, title, changed). */
    watched: function (item, done) { mark('/tv/watched', item, null, done); },
    /** Takes a mark back; a movie goes to previous ('watchlist', 'watching' or null: out of the library). done(error, title). */
    unwatched: function (item, previous, done) { mark('/tv/unwatched', item, previous, done); }
  };
})();
