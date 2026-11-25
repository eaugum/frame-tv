/*
 * What the home screen shows: weather, sunrise and sunset (Open-Meteo, every 30 min, kept in localStorage so it opens
 * with numbers), and which streaming service is which app on this TV.
 * Settings, Place and Modules come first: what's set on the TV or in config.properties, whichever changed last.
 * Without a city, the TV's time zone gives the city (zones.js); a city in config.properties gets its place when the
 * app is built.
 */
var CONFIG = window.CONFIG || {};

/**
 * Every setting in config.properties, by its name in config.js: what was set on the TV, else the file, else the
 * default. Whatever was changed last applies: a value set on the TV remembers what the file said then, and when a new
 * build brings something else, the file wins once. Removing a value on the TV saves it empty, which wins the same way.
 */
var Settings = (function () {
  'use strict';
  var KEY = 'fmtv.settings';
  var DEFAULTS = {
    latitude: '', longitude: '', city: '', name: '', language: 'auto', temperature: 'auto', hideApps: [], apps: [],
    stasera: false, staseraUrl: 'https://www.stasera.app', staseraName: '',
    youtube: false, youtubeClientId: '', youtubeClientSecret: '',
    github: false, githubToken: '', githubHide: [], vercel: false, vercelToken: '', vercelTeam: '',
    homeAssistant: false, homeAssistantUrl: '', homeAssistantToken: '', homeAssistantScenes: [],
    homeAssistantLights: [], homeAssistantPower: [], homeAssistantLaundry: [], homeAssistantGuestWifi: [],
    spotify: false, spotifyClientId: '', spotifyRefreshToken: '',
    art: false, artUrl: '', artKey: '',
    youtubeRefreshToken: '', staseraToken: '', shelf: null, youtubeShelf: null, youtubePlaylist: '', saverMinutes: 15, saverEvery: 5
  };
  var saved = {};   // key: {v: the TV's value, file: what config.js said then (JSON)}
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} }
  function empty(v) { return v === undefined || v === null || v === '' || (v instanceof Array && !v.length); }
  function file(key) { return JSON.stringify(CONFIG[key] === undefined ? null : CONFIG[key]); }
  // An empty value in the file is the same as none, so a build that adds a key empty keeps what the TV set.
  function same(a, b) {
    function plain(json) { try { return empty(JSON.parse(json)) ? 'null' : json; } catch (e) { return json; } }
    return plain(a) === plain(b);
  }

  // Kept in fmtv.prefs before (AUG-1478, AUG-1521): they move here, counted as set now.
  try {
    var old = JSON.parse(localStorage.getItem('fmtv.prefs')) || {}, moved = false;
    ['language', 'temperature', 'shelf', 'youtubePlaylist', 'saverMinutes', 'saverEvery'].forEach(function (k) {
      if (old[k] === undefined) return;
      if (!saved[k]) saved[k] = {v: old[k], file: file(k)};
      delete old[k];
      moved = true;
    });
    if (moved) { save(); localStorage.setItem('fmtv.prefs', JSON.stringify(old)); }
  } catch (e) {}

  // Minutes between the screensaver's pictures: whole, 1 to 1440 (as webapp.py): 0 would loop without a pause, a huge one overflows setTimeout.
  function usable(key, v) {
    if (key !== 'saverEvery') return v;
    var n = Math.floor(Number(v));
    return n >= 1 && n <= 1440 ? n : DEFAULTS[key];
  }

  return {
    get: function (key) {
      var s = saved[key];
      if (s && same(s.file, file(key))) return usable(key, s.v);
      if (s) { delete saved[key]; save(); }   // the file changed since: it wins
      return usable(key, empty(CONFIG[key]) ? DEFAULTS[key] : CONFIG[key]);
    },
    set: function (key, value) { saved[key] = {v: value, file: file(key)}; save(); },
    /** Back to what the file says. */
    reset: function (key) { delete saved[key]; save(); },
    /** Every setting's name. */
    keys: function () { return Object.keys(DEFAULTS); },
    /** Whether the TV's value applies rather than the file's. */
    changed: function (key) { return !!saved[key] && same(saved[key].file, file(key)); }
  };
})();

var Place = (function () {
  'use strict';
  /** A time zone's main city: {country, lat, lon, name}, or null. */
  function zone(name) {
    var all = window.ZONES || {}, v = all[name], hops = 0;
    while (v && v.charAt(0) === '=' && hops++ < 3) { name = v.slice(1); v = all[name]; }
    if (!v) return null;
    var p = v.split(',');
    return {country: p[0], lat: p[1], lon: p[2], name: p[3] || name.slice(name.lastIndexOf('/') + 1).replace(/_/g, ' ')};
  }

  var tz = zone(TV.zone()), lat = Settings.get('latitude'), lon = Settings.get('longitude'), set = lat !== '' && lon !== '';
  return {
    lat: set ? lat : tz ? tz.lat : '40.7128',
    lon: set ? lon : tz ? tz.lon : '-74.0060',
    city: Settings.get('city') || (!set && tz ? tz.name : ''),
    /** Fahrenheit for TVs in the US (by their time zone, or their language when it doesn't tell). */
    fahrenheit: tz ? tz.country === 'US' : /-US$/i.test(navigator.language || '')
  };
})();

/**
 * The modules (stasera, youtube, github, vercel, homeAssistant, spotify, art): on when switched on and it has what it
 * needs; an empty switch is off. A desktop browser previews a module switched on without it, with sample data.
 */
var Modules = (function () {
  'use strict';
  var get = Settings.get, preview = TV.name === 'browser';
  var READY = {
    stasera: function () { return !!get('staseraUrl'); },
    youtube: function () { return !!(get('youtubeClientId') && get('youtubeClientSecret')); },
    github: function () { return !!get('githubToken'); },
    vercel: function () { return !!get('vercelToken'); },
    homeAssistant: function () { return !!(get('homeAssistantUrl') && get('homeAssistantToken')); },
    spotify: function () { return !!(get('spotifyClientId') && get('spotifyRefreshToken')); },
    art: function () { return !!get('artUrl'); }
  };
  return {
    on: function (name) {
      return get(name) === true && (preview || READY[name]());
    },
    /** Whether the module has what it needs (the switch aside). */
    ready: function (name) { return READY[name](); }
  };
})();

var Prefs = (function () {
  'use strict';
  var KEY = 'fmtv.prefs';
  var v = {};
  try { v = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function pick(name, fallback) { return v[name] === undefined ? fallback : v[name]; }
  // These are in config.properties too, so they're kept in Settings.
  var SETTINGS = ['language', 'temperature', 'shelf', 'youtubeShelf', 'youtubePlaylist', 'saverMinutes', 'saverEvery'];
  return {
    version: 0,
    language: function () { return Settings.get('language'); },
    temperature: function () { return Settings.get('temperature'); },
    theme: function () { return pick('theme', 'auto'); },
    weather: function () { return pick('weather', true); },
    shelf: function () { return Settings.get('shelf'); },
    /** The apps on the YouTube tab (ids, in order), or null for the YouTube app alone. */
    youtubeShelf: function () { return Settings.get('youtubeShelf'); },
    /** The apps list of the build that last set the shelf, so a new one wins once over the TV's choice. */
    shelfConfig: function () { return pick('shelfConfig', ''); },
    /** The YouTube playlist picked in Home Settings (its id), or '' for the one called Frame TV. */
    youtubePlaylist: function () { return Settings.get('youtubePlaylist'); },
    /** Idle minutes before the screensaver, or 0 for never. */
    saverMinutes: function () { return Settings.get('saverMinutes'); },
    /** Minutes between the screensaver's pictures, ours and Frame Art's. */
    saverEvery: function () { return Settings.get('saverEvery'); },
    set: function (name, value) {
      if (SETTINGS.indexOf(name) >= 0) Settings.set(name, value);
      else { v[name] = value; save(); }
      this.version++;
    }
  };
})();

var Data = (function () {
  'use strict';

  function store(key, value) { try { localStorage.setItem('fmtv.' + key, JSON.stringify(value)); } catch (e) {} }
  function stored(key) { try { return JSON.parse(localStorage.getItem('fmtv.' + key)); } catch (e) { return null; } }

  /** GET a JSON document; done(error, json). */
  function get(url, headers, done) {
    var x = new XMLHttpRequest();
    var over = false;
    try {
      x.open('GET', url, true);
      x.timeout = 10000;
      for (var h in headers) if (headers.hasOwnProperty(h)) x.setRequestHeader(h, headers[h]);
    } catch (e) {
      setTimeout(function () { done(e); }, 0);
      return;
    }
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status !== 200) { done(new Error('HTTP ' + x.status)); return; }
      var json;
      try { json = JSON.parse(x.responseText); } catch (e) { done(e); return; }
      done(null, json);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(new Error('no connection')); } };
    try { x.send(); } catch (e) { over = true; setTimeout(function () { done(e); }, 0); }
  }

  var listeners = [];
  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  // MARK: - Weather

  var PLACE = Place.lat + ',' + Place.lon;
  var weather = null, weatherAt = 0, fetchingWeather = false;
  (function () {
    var w = stored('weather');
    if (!w || w.place !== PLACE) return;
    weather = parseWeather(w.body);
    if (weather) weatherAt = number(w.at) || 0;
    else { try { localStorage.removeItem('fmtv.weather'); } catch (e) {} }   // broken: drop it, ask again
  })();

  // Open-Meteo's answer, also the one kept from an earlier start, is read with these: a value of another type is
  // missing, and a list is a real one, cut short.
  function number(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function list(v) { return Object.prototype.toString.call(v) === '[object Array]' ? v.slice(0, 96) : []; }
  function object(v) { return v && typeof v === 'object' ? v : {}; }

  /** "2026-10-20T18:31" at the location (Open-Meteo's local time) → epoch ms. */
  function localTime(iso, offsetSeconds) {
    var m = typeof iso === 'string' && /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(iso);
    if (!m) return 0;
    return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) - offsetSeconds * 1000;
  }

  /** The weather from Open-Meteo's answer, or null when it isn't one. */
  function parseWeather(o) {
    if (!o || typeof o !== 'object' || !o.current || typeof o.current !== 'object') return null;
    var off = number(o.utc_offset_seconds) || 0, now = Date.now(), cur = o.current, daily = object(o.daily);
    var w = {
      temp: number(cur.temperature_2m), code: number(cur.weather_code), isDay: cur.is_day !== 0,
      max: number(list(daily.temperature_2m_max)[0]), min: number(list(daily.temperature_2m_min)[0]),
      sunrise: localTime(list(daily.sunrise)[0], off), sunset: localTime(list(daily.sunset)[0], off), hours: []
    };
    var hr = object(o.hourly), times = list(hr.time), temps = list(hr.temperature_2m), codes = list(hr.weather_code);
    var isDay = list(hr.is_day);
    for (var i = 0; i < times.length && w.hours.length < 6; i++) {
      var at = localTime(times[i], off);
      if (at <= now) continue;
      w.hours.push({at: at, temp: number(temps[i]), code: number(codes[i]), day: isDay[i] !== 0});
    }
    return w;
  }

  function refreshWeather() {
    var now = Date.now();
    if (fetchingWeather || (now - weatherAt < 30 * 60000 && now >= weatherAt)) return;
    fetchingWeather = true;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + Place.lat + '&longitude=' + Place.lon
        + '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset'
        + '&hourly=temperature_2m,weather_code,is_day&timezone=auto&forecast_days=2';
    get(url, {}, function (err, body) {
      fetchingWeather = false;
      var w = err ? null : parseWeather(body);
      if (!w) return;   // keep the last good one
      weather = w;
      weatherAt = Date.now();
      store('weather', {place: PLACE, body: body, at: weatherAt});
      changed();
    });
  }

  // MARK: - Streaming services and their apps

  /** Service name in Stasera (part of it, lowercase) → our key, how to find its app on the TV (id, name), its name. */
  var SERVICES = [
    ['netflix', 'netflix', /^netflix$/, /netflix/i, 'Netflix'],
    ['prime video', 'prime', /^amazon$/, /prime video|amazon/i, 'Prime Video'],
    ['disney', 'disney', /disney/, /disney/i, 'Disney+'],
    ['hulu', 'hulu', /^hulu/, /hulu/i, 'Hulu'],
    ['paramount', 'paramount', /paramount|cbs/, /paramount/i, 'Paramount+'],
    ['peacock', 'peacock', /peacock/, /peacock/i, 'Peacock'],
    ['globoplay', 'globoplay', /globoplay/, /globoplay/i, 'Globoplay'],
    ['max', 'max', /hbo|wbd|\.max|BeamCTV/, /^(hbo )?max$|hbo max/i, 'Max'],
    ['apple tv', 'appletv', /appletv|apple\.tv|aria-video/, /apple tv/i, 'Apple TV'],
    ['hotstar', 'hotstar', /hotstar/, /hotstar/i, 'JioHotstar'],
    ['crunchyroll', 'crunchyroll', /crunchyroll/, /crunchyroll/i, 'Crunchyroll'],
    // Norway's own (Stasera's picks name them).
    ['nrk', 'nrk', /nrk/i, /^nrk/i, 'NRK TV'],
    ['tv 2', 'tv2', /tv2/i, /^tv ?2/i, 'TV 2 Play'],
    ['viaplay', 'viaplay', /viaplay/i, /viaplay/i, 'Viaplay'],
    ['skyshowtime', 'skyshowtime', /skyshowtime/i, /skyshowtime/i, 'SkyShowtime'],
    ['vg tv', 'vgtv', /vgtv/i, /^vg ?tv/i, 'VG TV']
  ];

  var installed = [];   // the TV's apps, from TV.apps()

  /** The installed app for a service key, or null. */
  function appFor(key) {
    for (var s = 0; s < SERVICES.length; s++) {
      if (SERVICES[s][1] !== key) continue;
      for (var i = 0; i < installed.length; i++) {
        if (SERVICES[s][2].test(installed[i].id) || SERVICES[s][3].test(installed[i].title)) return installed[i];
      }
    }
    return null;
  }

  /**
   * "… Amazon Channel" is sold inside another app; Apple TV is only the streaming service (350; 2 is the store).
   * Without an id (Stasera's names are subscription services only), the name alone decides.
   */
  function service(providerName, providerId) {
    var n = (providerName || '').toLowerCase();
    if (n.indexOf(' channel') >= 0) return null;
    for (var i = 0; i < SERVICES.length; i++) {
      var s = SERVICES[i];
      if (s[1] === 'appletv' && providerId !== undefined && providerId !== 350) continue;
      if (s[0] === 'max' ? /\bmax\b/.test(n) : n.indexOf(s[0]) >= 0) return s;
    }
    return null;
  }

  return {
    city: Place.city,
    onChange: function (fn) { listeners.push(fn); },
    setApps: function (apps) { installed = apps; },
    appFor: appFor,
    /** The first of these services (Stasera's names) with its app on this TV: {key, name}, or null. */
    serviceFor: function (names) {
      for (var i = 0; i < names.length; i++) {
        var s = service(names[i]);
        if (s && appFor(s[1])) return {key: s[1], name: s[4]};
      }
      return null;
    },
    refresh: function () { refreshWeather(); },
    get weather() { return weather; },
    get weatherAt() { return weatherAt; },
    /** A picture from a path in Stasera's answers. */
    image: function (path, size) {
      return path ? Settings.get('staseraUrl').replace(/\/+$/, '') + '/tv/img/' + (size || 'w1280') + path : '';
    },

    /** Night at the location: from sunset to sunrise (the last forecast; without one, 6:00 and 18:00). */
    isNight: function (at) {
      var theme = Prefs.theme();
      if (theme === 'dark') return true;
      if (theme === 'light') return false;
      var d = new Date(at), mins = d.getHours() * 60 + d.getMinutes();
      function hm(t, fallback) { if (!t) return fallback; var x = new Date(t); return x.getHours() * 60 + x.getMinutes(); }
      var rise = hm(weather && weather.sunrise, 360), set = hm(weather && weather.sunset, 1080);
      return mins < rise || mins >= set;
    },

    degrees: function (v) {
      if (typeof v !== 'number' || !isFinite(v)) return '—';
      var unit = Prefs.temperature();
      var f = unit === 'F' || (unit === 'auto' && Place.fahrenheit);
      return Math.round(f ? v * 9 / 5 + 32 : v) + '°';
    },
    /** "3 PM", "15:00", "15 Uhr": the hourly forecast. */
    hour: function (at) { return formatDate('format|h a', at); },
    /** "5:21 AM", "05:21": the clock, sunrise and sunset. */
    time: function (at) { return formatDate('format|h:mm a', at); },
    /** "12 min ago" when the data is old (no internet), or empty. */
    staleness: function (at, every) {
      if (!at) return '';
      var age = Date.now() - at;
      if (age < every * 2) return '';
      var m = Math.floor(age / 60000), h = Math.floor(m / 60);
      return m < 60 ? trf('{n} min ago', {n: m}) : trf('{n} h ago', {n: h});
    },
    condition: function (code, day) {
      if (typeof code !== 'number' || code < 0) return '';
      if (code === 0) return day ? tr('Clear') : tr('night|Clear');
      if (code === 1) return day ? tr('Mostly Sunny') : tr('Mostly Clear');
      if (code === 2) return tr('Partly Cloudy');
      if (code === 3) return tr('Cloudy');
      if (code === 45 || code === 48) return tr('Fog');
      if (code >= 51 && code <= 57) return tr('Drizzle');
      if (code === 65 || code === 67 || code === 82) return tr('Heavy Rain');
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return tr('Snow');
      if (code >= 95) return tr('Thunderstorms');
      return tr('Rain');
    },
    symbol: function (code, day) {
      if (code <= 1) return day ? 'sunny' : 'clear_night';
      if (code === 2) return day ? 'partly_cloudy_day' : 'partly_cloudy_night';
      if (code === 3) return 'cloud';
      if (code === 45 || code === 48) return 'foggy';
      if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowflake';
      if (code >= 95) return 'thunderstorm';
      return 'rainy';
    }
  };
})();
