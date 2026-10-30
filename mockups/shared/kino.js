/* Shared helpers for the Kino mockups (AUG-1452). ES5, like web/. */
var K = (function () {
  var stage = document.getElementById('stage');

  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = 'scale(' + s + ')';
  }

  // Remote and keyboard. Back is 10009 on Tizen; Escape and Backspace stand in on a Mac.
  var KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter', 10009: 'back', 27: 'back', 8: 'back' };
  function onKey(handler) {
    if (window.tizen && tizen.tvinputdevice) {
      ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow',
        'ColorF3Blue'].forEach(function (k) {
        try { tizen.tvinputdevice.registerKey(k); } catch (e) {}
      });
    }
    document.addEventListener('keydown', function (e) {
      var k = KEYS[e.keyCode];
      if (!k && e.keyCode >= 48 && e.keyCode <= 57) k = String(e.keyCode - 48);
      if (!k && e.keyCode >= 96 && e.keyCode <= 105) k = String(e.keyCode - 96);
      if (!k && e.key && e.key.length === 1) k = e.key.toLowerCase();
      // Tizen colour keys.
      if (e.keyCode === 403) k = 'red';
      if (e.keyCode === 404) k = 'green';
      if (e.keyCode === 405) k = 'yellow';
      if (e.keyCode === 406) k = 'blue';
      if (!k) return;
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      handler(k);
    });
  }

  function params() {
    var out = {};
    location.search.replace(/^\?/, '').split('&').forEach(function (p) {
      if (!p) return;
      var kv = p.split('=');
      out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return out;
  }
  function query(obj) {
    var parts = [];
    for (var k in obj) if (obj[k] !== undefined && obj[k] !== '') parts.push(k + '=' + encodeURIComponent(obj[k]));
    return parts.length ? '?' + parts.join('&') : '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Norwegian text ──────────────────────────────────────────
  var GENRES = {
    'Action & Adventure': 'Action og eventyr', 'Sci-Fi & Fantasy': 'Sci-fi og fantasy', 'Comedy': 'Komedie',
    'Crime': 'Krim', 'Mystery': 'Mysterium', 'Documentary': 'Dokumentar', 'Family': 'Familie',
    'Animation': 'Animasjon', 'Talk': 'Talkshow', 'War & Politics': 'Krig og politikk', 'Horror': 'Skrekk',
    'Science Fiction': 'Science fiction', 'Adventure': 'Eventyr', 'History': 'Historie', 'Music': 'Musikk',
    'Romance': 'Romantikk', 'Kids': 'Barn', 'Komedie': 'Komedie', 'Dokumentar': 'Dokumentar'
  };
  function genre(g) { return GENRES[g] || g; }
  var MONTHS = ['jan.', 'feb.', 'mars', 'apr.', 'mai', 'juni', 'juli', 'aug.', 'sep.', 'okt.', 'nov.', 'des.'];
  var MONTHS_LONG = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober',
    'november', 'desember'];
  var DAYS = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];

  function dayDiff(a, b) {
    return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) -
      new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
  }
  function parseDate(s) {
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  // "i dag", "i går", "torsdag", "15. okt."
  function day(date, now) {
    var d = typeof date === 'string' ? parseDate(date) : new Date(date);
    now = new Date(now);
    var n = dayDiff(d, now);
    if (n === 0) return 'i dag';
    if (n === 1) return 'i går';
    if (n === -1) return 'i morgen';
    if (n < 0 && n > -7) return DAYS[d.getDay()];
    return d.getDate() + '. ' + MONTHS[d.getMonth()];
  }
  function ago(ms, now) {
    var m = Math.round((now - ms) / 60000);
    if (m < 60) return 'for ' + Math.max(1, m) + ' min siden';
    var h = Math.round(m / 60);
    if (h < 24) return 'for ' + h + ' t siden';
    var d = Math.round(h / 24);
    if (d === 1) return 'i går';
    if (d < 7) return 'for ' + d + ' dager siden';
    return day(ms, now);
  }
  function longDate(d) { return DAYS[d.getDay()] + ' ' + d.getDate() + '. ' + MONTHS_LONG[d.getMonth()]; }
  function minutes(m) {
    if (!m) return '';
    var h = Math.floor(m / 60);
    return h ? h + ' t ' + (m % 60 ? (m % 60) + ' min' : '') : m + ' min';
  }
  function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function views(n) {
    if (n >= 1e6) return String(Math.round(n / 1e5) / 10).replace('.', ',') + ' mill. visninger';
    if (n >= 1e3) return Math.round(n / 1e3) + ' k visninger';
    return n + ' visninger';
  }
  function plural(n, one, other) { return n + ' ' + (n === 1 ? one : other); }
  function ep(c) { return 'S' + c.season + ' E' + c.episode; }

  // ── Apps ────────────────────────────────────────────────────
  // Brand tiles; the four logos we have come from web/icons, the rest are wordmarks.
  var APPS = {
    'Apple TV': { bg: 'linear-gradient(135deg,#2a2a2e,#0c0c0e)', fg: '#fff', word: 'Apple TV' },
    'TV 2 Play': { bg: 'linear-gradient(135deg,#1d2a6b,#0e1433)', fg: '#fff', word: 'TV 2 Play' },
    'Viaplay': { bg: 'linear-gradient(135deg,#3b0a5c,#1a0630)', fg: '#ff4d6d', word: 'viaplay' },
    'Netflix': { bg: '#000', img: 'shared/netflix.svg', w: 52, h: 92 },
    'YouTube': { bg: '#0f0f0f', img: 'shared/youtube.png', w: 190, h: 58 },
    'Max': { bg: 'linear-gradient(135deg,#0026d1,#000e5c)', img: 'shared/max.svg', w: 150, h: 45 },
    'Disney+': { bg: 'linear-gradient(135deg,#0f2b6b,#060f2a)', fg: '#fff', word: 'Disney+' },
    'NRK TV': { bg: 'linear-gradient(135deg,#2b2f36,#16181c)', fg: '#fff', word: 'NRK TV' },
    'Prime Video': { bg: '#0f171e', img: 'shared/prime.png', w: 180, h: 76 },
    'VG TV': { bg: '#d0021b', fg: '#fff', word: 'VG TV' }
  };
  function appTile(name, cls) {
    var a = APPS[name] || { bg: '#222', fg: '#fff', word: name };
    var inner;
    if (a.img) {
      inner = '<img class="app-img" src="' + a.img + '" style="width:' + a.w + 'px;height:' + a.h + 'px;margin:-' +
        a.h / 2 + 'px 0 0 -' + a.w / 2 + 'px">';
    } else {
      inner = '<div class="app-word" style="color:' + a.fg + '">' + (a.html || esc(a.word)) + '</div>';
    }
    return '<div class="card card--app ' + (cls || '') + '"><div class="card-img" style="background:' + a.bg +
      '"></div>' + inner + '<div class="card-ring"></div></div>';
  }

  // ── Feedback ────────────────────────────────────────────────
  var toastEl, toastTimer, hudEl, hudTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      stage.appendChild(toastEl);
    }
    toastEl.innerHTML = '<span>' + msg + '</span>';
    toastEl.className = 'toast is-on';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 2200);
  }
  function hud(html, ms) {
    if (!hudEl) {
      hudEl = document.createElement('div');
      hudEl.className = 'hud';
      stage.appendChild(hudEl);
    }
    hudEl.innerHTML = html;
    hudEl.className = 'hud is-on';
    clearTimeout(hudTimer);
    hudTimer = setTimeout(function () { hudEl.className = 'hud'; }, ms || 2600);
  }

  function clock(el, extra) {
    function tick() {
      var d = new Date();
      el.innerHTML = (extra ? '<small>' + extra + '</small>' : '') + d.getHours() + ':' +
        ('0' + d.getMinutes()).slice(-2);
    }
    tick();
    setInterval(tick, 10000);
  }

  // Keep the focused item at the row's left edge, but never scroll past the end.
  function scrollTrack(track, items, i, view) {
    if (!items.length) return;
    var last = items[items.length - 1];
    var first = items[0].offsetLeft;
    var max = Math.max(0, last.offsetLeft + last.offsetWidth - first - (view || 1696));
    var x = Math.min(items[i].offsetLeft - first, max);
    track.style.transform = 'translateX(' + (-x) + 'px)';
  }

  window.addEventListener('resize', fit);
  fit();
  setTimeout(function () { stage.className += ' is-ready'; }, 30);

  return {
    stage: stage, onKey: onKey, params: params, query: query, esc: esc, genre: genre, day: day, ago: ago,
    longDate: longDate, minutes: minutes, num: num, views: views, plural: plural, ep: ep, APPS: APPS,
    appTile: appTile, toast: toast, hud: hud, clock: clock, scrollTrack: scrollTrack, parseDate: parseDate,
    MONTHS: MONTHS, DAYS: DAYS
  };
})();
