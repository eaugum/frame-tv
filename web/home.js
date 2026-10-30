/*
 * Frame TV's home screen on Samsung (Tizen), the Kino look (AUG-1446, AUG-1448):
 *  - the tab bar at the top (Search, Hjem, TV, YouTube, Statistikk, GitHub, Home Assistant, then a button for All Apps and a gear
 *    for Home Settings), with the day, the weather and the clock at the right. A tab whose module is off or not set
 *    up isn't there. ↑ only reaches the bar; ← → there change tab; ↓ or OK goes into the tab; Back goes to the bar,
 *    then to Hjem;
 *  - Hjem: a greeting (Stasera's when linked, see greeting()), and tiles: what we're watching, new episodes, then the
 *    first four of Stasera, YouTube, GitHub, Home Assistant, friends and Kunstmodus that are on, and apps after them.
 *    YouTube's tile is one video (the last added to our playlist, or the newest from the subscriptions), and without
 *    Stasera it takes the big tile. The arrows move the focus the way they point;
 *  - TV: the cinema screen (2.39:1, lit around) rotating through what to watch, then rows of big cards: Watching, Want
 *    to Start, Movies (the watchlist's that stream here), Friends and Apps. Without Stasera, a calm room with the clock
 *    and the apps;
 *  - YouTube: the same cinema screen and rows, for our playlist (Frame TV) and what's new from the subscriptions;
 *  - Statistikk (Stasera's stats from /tv/home), GitHub (github.js) and Home Assistant (ha.js): one screen
 *    of tiles each, focus moving as on Hjem;
 *  - Search (only while the TV is linked to Stasera): its own QWERTY keys at the left, Stasera's titles at the right;
 *  - a title's page, from OK on a title anywhere (AUG-1485): the backdrop, what it is, the next episode of a show we
 *    watch, where to watch it, Watch on, Trailer and Want to Start, then the seasons and the cast. OK on someone in
 *    the cast opens their page (photo, biography and what they're known for), and a title there opens its page;
 *  - sheets over it: Home Settings (Stasera's link with a QR code, YouTube's sign-in and playlist, the language, the
 *    apps' order), All Apps;
 *  - a screensaver after a few idle minutes; holding OK on an episode or a movie marks it watched, and holding OK again
 *    in the next 10 seconds takes it back (on Kunstmodus: a new picture).
 * The remote's arrows, OK and Back move the focus; a pointer focuses what it points at.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function sym(name, parent, size) {
    var s = el('span', 'sym', parent);
    s.style.webkitMaskImage = 'url(symbols/' + name + '.png)';
    s.style.maskImage = 'url(symbols/' + name + '.png)';
    if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; }
    return s;
  }

  function hasClass(e, c) { return (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0; }
  function setClass(e, c, on) {
    if (!e) return;
    if (on && !hasClass(e, c)) e.className = (e.className + ' ' + c).replace(/^\s+/, '');
    else if (!on && hasClass(e, c)) e.className = (' ' + e.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, '');
  }

  function transform(e, value) { e.style.webkitTransform = e.style.transform = value; }

  var stage = $('stage');

  /** The 1920 × 1080 stage fills the window (on the TV it already is 1920 × 1080). */
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    transform(stage, s === 1 ? '' : 'scale(' + s + ')');
  }

  // MARK: - Apps: the Apps row ("the shelf" in Home Settings and config.properties)

  /**
   * Apps with a brand of their own: key, app id, name on the TV, brand gradient, and for the services in the app
   * library the names config.properties may give them (lowercase, without spaces or signs: "TV 2 Play" is "tv2play").
   */
  var SHELF = [
    ['netflix', /^netflix$/, /netflix/i, ['#0A0A0A', '#000000'], /^netflix$/],
    ['youtube', /youtube/, /^youtube$/i, ['#1C1C1E', '#09090A'], /^youtube$/],
    ['prime', /^amazon$|primevideo$|AmazonIgnition/, /prime video|amazon/i, ['#2AA8FF', '#0A68D4'], /^(amazon)?prime(video)?$|^amazon$/],
    ['disney', /disney/i, /disney/i, ['#173584', '#08143F'], /^disney(plus)?$/],
    ['max', /hbo|wbd|BeamCTV/, /^(hbo )?max$|hbo max/i, ['#5C30E8', '#221684'], /^(hbo)?max$|^hbo$/],
    ['appletv', /appletv|apple\.tv|aria-video/, /apple tv/i, ['#1C1C1E', '#000000'], /^apple(tv)?(plus)?$/],
    ['nrk', /nrk/i, /^nrk/i, ['#13253F', '#07101E'], /^nrk(tv)?$/],
    ['tv2', /tv2/i, /^tv ?2/i, ['#2440E6', '#0B1A8C'], /^tv2(play)?$/],
    ['viaplay', /viaplay/i, /viaplay/i, ['#E8175D', '#7A0B4E'], /^viaplay$/],
    ['vgtv', /vgtv/i, /^vg ?tv/i, ['#E11F26', '#8E0F13'], /^vg(tv)?$/],
    ['hulu', /^hulu/, /hulu/i, ['#1CE783', '#0B8F4E']],
    ['paramount', /paramount|cbs/, /paramount/i, ['#0064FF', '#002A86']],
    ['peacock', /peacock/, /peacock/i, ['#1C1C1E', '#000000']],
    ['nfl', /nfl/, /^nfl/i, ['#013369', '#00163D']],
    ['globoplay', /globoplay/, /globoplay/i, ['#FF8A1F', '#FF2D5A']],
    ['jellyfin', /jellyfin/i, /jellyfin/i, ['#AA5CC3', '#00A4DC']],
    ['spotify', /spotify/, /spotify/i, ['#1DB954', '#0F7A36']]
  ];
  // The app library without apps in config.properties or a choice on the TV, those of them that are installed.
  var LIBRARY = ['appletv', 'tv2', 'viaplay', 'netflix', 'youtube', 'max', 'disney', 'nrk', 'prime', 'vgtv'];
  // Apps in the Apps row when none of those is installed; All Apps has the rest.
  var FEW_APPS = 8;

  function shelfKey(app) {
    for (var i = 0; i < SHELF.length; i++) if (SHELF[i][1].test(app.id) || SHELF[i][2].test(app.title)) return SHELF[i];
    return null;
  }

  /** The installed app for a SHELF key ('youtube'), or null. */
  function appByKey(key) {
    for (var i = 0; i < apps.length; i++) {
      var k = shelfKey(apps[i]);
      if (k && k[0] === key) return apps[i];
    }
    return null;
  }

  function darken(hex, f) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#161618';
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgb(' + Math.round(r * f) + ',' + Math.round(g * f) + ',' + Math.round(b * f) + ')';
  }

  /** A name that fits the tile on one line (the font shrinks for long names). */
  function wordFit(title, width, max) {
    return Math.max(18, Math.min(max, Math.floor(width * 0.8 / (Math.max(4, title.length) * 0.56))));
  }

  // MARK: - Logos

  // The TV's icons are small squares with their own background (white behind Netflix, black behind Max). The logo
  // is lifted off it once: the background goes transparent and the rest is
  // cropped to the logo, which then fills the tile on the brand's color.
  var lifted = {};   // icon url -> {src, bg: [r, g, b], ink: luminance histogram} or false (keep the icon as it is)
  var LIFT_SIZE = 240;

  // sRGB (0-255) to linear light, computed once: lift() needs it for every pixel, and old TVs are slow at Math.pow.
  var LINEAR = [];
  for (var li = 0; li < 256; li++) LINEAR[li] = li <= 10 ? li / 255 / 12.92 : Math.pow((li / 255 + 0.055) / 1.055, 2.4);

  /** Relative luminance (0-1) of an sRGB color (whole numbers, as read from the canvas). */
  function luminance(r, g, b) {
    return 0.2126 * LINEAR[r] + 0.7152 * LINEAR[g] + 0.0722 * LINEAR[b];
  }

  function rgbOf(color) {
    var m = /^#?([0-9a-f]{6})$/i.exec(color || '');
    if (m) { var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color || '');
    return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
  }

  function lift(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return false;
    var f = Math.min(1, LIFT_SIZE / Math.max(w, h));
    w = Math.max(1, Math.round(w * f));
    h = Math.max(1, Math.round(h * f));
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var g = canvas.getContext('2d');
    var data;
    try {
      g.drawImage(img, 0, 0, w, h);
      data = g.getImageData(0, 0, w, h);
    } catch (e) {
      return false;   // a TV that doesn't let the page read its icons
    }
    var px = data.data;
    // The background: the most common color a little inside the edges (rounded icons have transparent corners).
    var votes = {}, best = null, bestN = 0, inset = Math.round(Math.min(w, h) * 0.08);
    for (var s = 0; s < 64; s++) {
      var t = s % 16 / 16, side = s >> 4;
      var x = side < 2 ? Math.round(inset + t * (w - 2 * inset)) : side === 2 ? inset : w - 1 - inset;
      var y = side < 2 ? (side === 0 ? inset : h - 1 - inset) : Math.round(inset + t * (h - 2 * inset));
      var i = (y * w + x) * 4;
      var key = px[i + 3] < 128 ? 'clear' : (px[i] >> 4) + ',' + (px[i + 1] >> 4) + ',' + (px[i + 2] >> 4);
      votes[key] = (votes[key] || 0) + 1;
      if (votes[key] > bestN) { bestN = votes[key]; best = key === 'clear' ? null : [px[i], px[i + 1], px[i + 2]]; }
    }
    var minX = w, minY = h, maxX = -1, maxY = -1, ink = [0, 0, 0, 0, 0, 0, 0, 0], inkSum = 0;
    for (var p = 0; p < w * h; p++) {
      var j = p * 4, a = px[j + 3] / 255;
      if (best) {
        // color to alpha: how far each channel is from the background, as a share of how far it could go, so the
        // anti-aliased edges come out as the logo's color, partly clear, without a fringe of the background
        var k = 0, c;
        for (c = 0; c < 3; c++) {
          var v = px[j + c], o = best[c];
          k = Math.max(k, v > o ? (v - o) / Math.max(1, 255 - o) : (o - v) / Math.max(1, o));
        }
        k = Math.max(0, Math.min(1, (k - 0.1) / 0.9));   // compression noise stays clear
        if (k > 0 && k < 1) {
          for (c = 0; c < 3; c++) px[j + c] = Math.max(0, Math.min(255, best[c] + (px[j + c] - best[c]) / k));
        }
        a *= k;
      }
      px[j + 3] = Math.round(a * 255);
      if (a > 0.3) {
        var px0 = p % w, py0 = (p / w) | 0;
        if (px0 < minX) minX = px0;
        if (px0 > maxX) maxX = px0;
        if (py0 < minY) minY = py0;
        if (py0 > maxY) maxY = py0;
        ink[Math.min(7, Math.floor(Math.sqrt(luminance(px[j], px[j + 1], px[j + 2])) * 8))] += a;
        inkSum += a;
      }
    }
    // Nothing left, or nothing taken away (a picture rather than a logo on a background): keep the icon.
    if (maxX < 0 || (maxX - minX > w * 0.96 && maxY - minY > h * 0.96)) return false;
    var crop = document.createElement('canvas');
    crop.width = maxX - minX + 1;
    crop.height = maxY - minY + 1;
    g.putImageData(data, 0, 0);
    crop.getContext('2d').drawImage(canvas, minX, minY, crop.width, crop.height, 0, 0, crop.width, crop.height);
    for (var b = 0; b < 8; b++) ink[b] /= inkSum;
    try {
      return {src: crop.toDataURL('image/png'), bg: best, ink: ink};
    } catch (e2) {
      return false;
    }
  }

  /**
   * Share of the logo that hardly shows on a tile of this luminance (YouTube's black type on a dark tile). Each bin
   * of the histogram holds the ink whose square-root luminance falls in it.
   */
  function unseen(ink, tileLum) {
    var share = 0;
    for (var b = 0; b < 8; b++) {
      var l = Math.pow((b + 0.5) / 8, 2);
      if ((Math.max(l, tileLum) + 0.05) / (Math.min(l, tileLum) + 0.05) < 1.8) share += ink[b];
    }
    return share;
  }

  function paint(box, top, bottom) {
    box.style.background = '-webkit-linear-gradient(top, ' + top + ', ' + bottom + ')';
    box.style.background = 'linear-gradient(' + top + ', ' + bottom + ')';
  }

  /** A color that is clearly a hue (Crunchyroll's orange), not black, white or a gray. */
  function colorful(rgb) {
    return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]) >= 96;
  }

  /** own: the tile has the TV's color for the app, not one of SHELF's. */
  function showLogo(img, box, top, bottom, logo, own) {
    img.className = 'logo';
    img.src = logo.src;
    var a = rgbOf(top), z = rgbOf(bottom);
    var tileLum = (luminance(a[0], a[1], a[2]) + luminance(z[0], z[1], z[2])) / 2;
    // The tile takes the icon's background when the logo only reads on it, and when that background is the brand's
    // color: a launcher's color isn't always the icon's.
    if (logo.bg && ((own && colorful(logo.bg)) || unseen(logo.ink, tileLum) > 0.35)) {
      var bg = 'rgb(' + logo.bg.join(',') + ')';
      var hex = '#' + ((1 << 24) | (logo.bg[0] << 16) | (logo.bg[1] << 8) | logo.bg[2]).toString(16).slice(1);
      paint(box, bg, darken(hex, 0.93));
    }
  }

  /** An app's face: its logo on its brand color (or its name, when the icon can't be read). */
  function face(app, box, wordSize) {
    var k = shelfKey(app);
    var top = k ? k[3][0] : app.color ? darken(app.color, 0.92) : '#2A2A2E';
    var bottom = k ? k[3][1] : app.color ? darken(app.color, 0.62) : '#161618';
    paint(box, top, bottom);
    var word = el('div', 'word', box, app.title);
    if (wordSize) word.style.fontSize = wordSize + 'px';
    if (app.icon) {
      var img = el('img', '', box), url = app.icon;
      word.style.visibility = 'hidden';
      img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); word.style.visibility = ''; };
      if (lifted[url]) { showLogo(img, box, top, bottom, lifted[url], !k); return; }
      if (lifted[url] !== false) {
        img.onload = function () {
          img.onload = null;
          if (lifted[url] === undefined) lifted[url] = lift(img);
          if (lifted[url]) showLogo(img, box, top, bottom, lifted[url], !k);
        };
      }
      img.src = url;
    }
  }

  var apps = [], shelf = [], others = [];

  /** apps in config.properties: the shelf in that order, by id or name (part of it). */
  var WANTED = Settings.get('apps').map(function (s) { return s.toLowerCase(); });

  /** An app in config.properties' list: a service by its name, else an app by its name (part of it) or its whole id. */
  function wantedApp(name, taken) {
    var plain = name.replace(/[^a-z0-9]/g, ''), i;
    for (i = 0; plain && i < SHELF.length; i++) {
      if (SHELF[i][4] && SHELF[i][4].test(plain)) {
        var a = appByKey(SHELF[i][0]);
        return a && taken.indexOf(a) < 0 ? a : null;
      }
    }
    for (i = 0; i < apps.length; i++) {
      var id = apps[i].id.toLowerCase(), title = apps[i].title.toLowerCase();
      if ((id === name || title.indexOf(name) >= 0) && taken.indexOf(apps[i]) < 0) return apps[i];
    }
    return null;
  }

  function pickShelf() {
    // A new list in config.properties wins once over the choice made on the TV.
    if (WANTED.length && Prefs.shelfConfig() !== WANTED.join(',')) {
      Prefs.set('shelf', null);
      Prefs.set('shelfConfig', WANTED.join(','));
    }
    var chosen = Prefs.shelf(), out = [], i, a;
    if (chosen) {
      for (i = 0; i < chosen.length; i++) {
        for (var j = 0; j < apps.length; j++) if (apps[j].id === chosen[i]) out.push(apps[j]);
      }
    } else {
      var names = WANTED.length ? WANTED : LIBRARY;
      for (i = 0; i < names.length; i++) {
        a = WANTED.length ? wantedApp(names[i], out) : appByKey(names[i]);
        if (a && out.indexOf(a) < 0) out.push(a);
      }
      if (!out.length) out = apps.slice(0, FEW_APPS);
    }
    shelf = out;
    others = apps.filter(function (x) { return shelf.indexOf(x) < 0; });
  }


  // MARK: - Titles from Stasera

  function image(path, size) { return Data.image(path, size); }

  /** The app on this TV for a title ({id, title}), or null. */
  function appOf(item) {
    var s = Stasera.service(item);
    return s ? Data.appFor(s.key) : null;
  }

  function serviceName(item) {
    var s = Stasera.service(item);
    return s ? s.name : '';
  }

  /** The picture behind a title's logo has no text in it; without a logo, the plain one. */
  function wide(item, withLogo) {
    return withLogo ? item.textlessBackdropPath || item.backdropPath : item.backdropPath || item.textlessBackdropPath;
  }

  function ep(item) { return trf('S{s} E{e}', {s: item.seasonNumber, e: item.episodeNumber}); }

  /** Smart Hub's placeholder names ("Episode 4") say nothing. */
  function episodeName(item) {
    return item.episodeName && !/^(Episode|Episodio|Folge|Afsnit|Avsnitt|Jakso) \d+$/i.test(item.episodeName) ? item.episodeName : '';
  }

  function runtime(m) {
    if (!(m > 0)) return '';
    var h = Math.floor(m / 60);
    return h ? trf('{h}h {m}m', {h: h, m: m % 60}) : trf('{m}m', {m: m});
  }

  /** Days from a yyyy-mm-dd to today (1: yesterday). */
  function daysAgo(date) {
    var p = /^(\d+)-(\d+)-(\d+)/.exec(date || '');
    if (!p) return null;
    var now = new Date();
    return Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(+p[1], p[2] - 1, +p[3])) / 86400000);
  }

  /** "Today", "Yesterday", a weekday this week, else the date. */
  function dayLabel(date) {
    var n = daysAgo(date);
    if (n === null) return '';
    if (n === 0) return tr('Today');
    if (n === 1) return tr('Yesterday');
    if (n === -1) return tr('Tomorrow');
    var p = /^(\d+)-(\d+)-(\d+)/.exec(date), at = new Date(+p[1], p[2] - 1, +p[3]).getTime();
    return n > 1 && n < 7 ? formatDate('format|EEEE', at) : formatDate('format|MMM d', at);
  }

  function ago(at) {
    var m = Math.max(1, Math.round((Date.now() - at) / 60000));
    if (m < 60) return trf('{n} min ago', {n: m});
    var h = Math.round(m / 60);
    if (h < 24) return trf('{n} h ago', {n: h});
    var d = Math.round(h / 24);
    if (d === 1) return tr('Yesterday');
    return d < 7 ? plural('plural|one:{n} day ago|other:{n} days ago', d) : formatDate('format|MMM d', at);
  }

  /** An episode out in the last two weeks, of a show we've started. */
  function isNew(item) {
    var n = daysAgo(item.airDate);
    return item.kind === 'show' && item.watched > 0 && n !== null && n >= 0 && n <= 14;
  }

  function left(item) { return plural('plural|one:{n} episode left|other:{n} episodes left', item.remaining); }

  /** Year, runtime and app; for a show we're in, the episode. */
  function metaOf(item) {
    var m = [];
    if (item.kind === 'show' && item.watched > 0) {
      m.push(ep(item) + (episodeName(item) ? ' ' + trf('quote|“{text}”', {text: episodeName(item)}) : ''));
    } else {
      if (item.year) m.push(String(item.year));
      if (item.kind === 'movie' && item.runtime) m.push(runtime(item.runtime));
    }
    if (serviceName(item)) m.push(serviceName(item));
    return m;
  }

  /** What OK says on the cinema screen. */
  function buttonOf(item) {
    if (item.kind === 'movie') return tr('Play');
    if (item.watched > 0) return isNew(item) ? trf('Watch · {episode}', {episode: ep(item)}) : trf('Continue · {episode}', {episode: ep(item)});
    return trf('Start · {episode}', {episode: ep(item)});
  }

  function heroOf(item, kicker, dim) {
    var logo = item.logoPath || null;
    return {
      kicker: kicker, dim: dim || '', title: item.title, logo: logo, img: wide(item, !!logo), ambient: item.backdropPath || item.textlessBackdropPath,
      meta: metaOf(item), overview: item.watched > 0 && item.episodeOverview ? item.episodeOverview : item.overview,
      progress: item.watched > 0 && item.total ? item.watched / item.total : null, progressText: item.watched > 0 ? left(item) : '',
      button: buttonOf(item), app: serviceName(item), item: item
    };
  }

  /** Opens a title in its app, or the app where the TV can't open the title (AUG-1433). */
  function launchItem(item) {
    var s = Stasera.service(item), app = s ? Data.appFor(s.key) : null;
    if (!app) { toast(trf("{title} isn't on any app on this TV.", {title: item.title})); return; }
    HA.opening(app, item);
    TV.deepLink(app.id, s.key, item, function (ok) {
      if (!ok) toast(trf("Couldn't open {app}.", {app: app.title}));
    });
  }

  function friendText(f) {
    var who = f.friendName || '';
    switch (f.kind) {
      case 'episode-watch':
        return f.count > 1 ? trf('{name} watched {n} episodes', {name: who, n: f.count}) : trf('{name} watched an episode', {name: who});
      case 'show-finished': return trf('{name} finished it', {name: who});
      case 'rating-set': return trf('{name} rated it', {name: who});
      case 'watched-together':
        return f.together === 'you' ? trf('{name} watched it with you', {name: who}) : trf('{name} watched it', {name: who});
      default: return trf('{name} watched it', {name: who});
    }
  }

  function initials(name) {
    var p = (name || '?').split(' ');
    return (p[0].charAt(0) + (p[1] ? p[1].charAt(0) : '')).toUpperCase();
  }

  /** The friends feed, one card per title and kind (the feed repeats a solo watch after a joint one). */
  function friendsFeed() {
    var all = Stasera.home().friends, out = [];
    for (var i = 0; i < all.length; i++) {
      var f = all[i], e = f.entity, dup = false;
      if (!e || !(e.backdropPath || e.posterPath)) continue;
      for (var j = 0; j < out.length; j++) {
        if (out[j].entity.tmdbId === e.tmdbId && (out[j].kind === f.kind || out[j].together)) dup = true;
      }
      if (!dup) out.push(f);
    }
    return out;
  }

  /** A friend's title, when it's one of ours: we know its app then. */
  function ownTitle(entity) {
    var h = Stasera.home(), all = h.watching.concat(h.wantToStart, h.movies);
    for (var i = 0; i < all.length; i++) if (all[i].tmdbId === entity.tmdbId && (all[i].kind === 'movie') === (entity.kind === 'movie')) return all[i];
    return null;
  }

  // MARK: - YouTube (youtube.js: the subscriptions' new videos, or samples until the TV is signed in)

  /** A video's picture (big: the largest YouTube has); the sample videos are drawn in their channel's color. */
  function videoArt(v, big) {
    if (!v.color) return 'url(' + (big ? v.picture || v.thumb : v.thumb) + ')';
    return 'linear-gradient(135deg, ' + v.color + ', ' + darken(v.color, 0.3) + ')';
  }

  function duration(s) {
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  /** Opens a video in YouTube; the samples have no real id and open the app. */
  function launchVideo(v) {
    var app = appByKey('youtube');
    if (!app) { toast(trf("{title} isn't on any app on this TV.", {title: v.title})); return; }
    HA.opening(app, {title: v.title, kind: 'video'});
    TV.deepLink(app.id, 'youtube', {videoId: v.id}, function (ok) {
      if (!ok) toast(trf("Couldn't open {app}.", {app: app.title}));
    });
  }

  function videoHero(v, kicker) {
    var meta = [ago(v.at)];
    if (v.duration) meta.push(duration(v.duration));
    if (YouTube.sample()) meta.push(tr('Sample data'));
    return {kicker: kicker, dim: v.channel, title: v.title, bg: videoArt(v, true), meta: meta, button: tr('Play'), app: 'YouTube',
      run: function () { launchVideo(v); }};
  }

  // MARK: - Clock and weather

  function weatherLine(long) {
    var w = Data.weather, parts = [];
    if (Data.city) parts.push(Data.city);
    if (w) parts.push(Data.degrees(w.temp) + (long ? ', ' + Data.condition(w.code, w.isDay).toLowerCase() : ''));
    return parts.join('  ');
  }

  function today() {
    var s = formatDate('format|EEEE, MMMM d', Date.now());
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /**
   * Hjem's greeting: Stasera's for this hour, as on its home page, finished in the TV's language ("Ada Lovelace,
   * oppe sent?"). Without it, our own, with name in config.properties as written.
   */
  function greeting() {
    var s = Stasera.greeting();
    if (s) return s;
    var h = new Date().getHours(), n = Settings.get('name'), v = {name: n};
    if (!n) return h < 5 ? tr('Good night') : h < 10 ? tr('Good morning') : h < 18 ? tr('Good afternoon') : tr('Good evening');
    return h < 5 ? trf('Good night, {name}', v) : h < 10 ? trf('Good morning, {name}', v) :
        h < 18 ? trf('Good afternoon, {name}', v) : trf('Good evening, {name}', v);
  }

  function renderClock() {
    var now = Date.now(), c = $('clock');
    c.innerHTML = '';
    var w = weatherLine(false);
    el('small', '', c, today());
    if (w) el('small', '', c, w);
    c.appendChild(document.createTextNode(formatDate('format|h:mm', now)));
    var calm = $('calm');
    calm.children[0].textContent = formatDate('format|h:mm', now);
    calm.children[1].textContent = today();
    calm.children[2].textContent = weatherLine(true);
    var g = document.querySelector('#pane-home .greet');
    if (g) g.firstChild.textContent = greeting();
  }

  /** On the minute, so the clock never runs late. */
  function tickClock() {
    renderClock();
    setTimeout(tickClock, 60000 - Date.now() % 60000 + 50);
  }

  // MARK: - Navigation: the tab bar, and which tab is in front

  var TABS = ['home', 'tv'], PANES = ['home', 'tv', 'stasera', 'github', 'ha', 'spotify', 'search'];
  var Z = {MAIN: 'main', APPS: 'apps', SETTINGS: 'settings', EDIT: 'edit', LANG: 'lang', DEVICE: 'device', LINK: 'link', TITLE: 'title', TYPE: 'type'};
  var st = {zone: Z.MAIN, grid: 0, row: 0, edit: 0, lang: 0, device: 0};
  var nav = {tab: 'home', area: 'content', bar: 0};   // bar: an index in BAR

  /** The tab bar from the left: a tab's name, or a button with its symbol and what OK does. */
  var BAR = [];

  /** The settings first, Art Mode while its module is on, then the tabs. */
  function barItems() {
    var out = TABS.slice();
    if (Art.enabled()) out.unshift({sym: 'art', run: function () { artDo(Art.artMode, tr('Art Mode…')); }});
    out.unshift({sym: 'settings', run: function () { openSettings(); }});
    return out;
  }

  function sheetOpen() { return st.zone !== Z.MAIN; }

  function tabName(t) {
    return {home: tr('Home'), tv: tr('TV'), youtube: 'YouTube', stasera: tr('Stats'), github: 'GitHub', ha: 'Home Assistant',
      spotify: 'Spotify'}[t];
  }

  /**
   * The tabs whose module is on: Search first and Stasera once the TV is linked, YouTube, GitHub with a token, Home
   * Assistant, Spotify.
   */
  function availableTabs() {
    var out = ['home', 'tv'];
    if (YouTube.enabled()) out.push('youtube');
    if (Stasera.linked()) { out.unshift('search'); out.push('stasera'); }
    if (GitHub.enabled()) out.push('github');
    if (HA.enabled()) out.push('ha');
    if (Spotify.enabled()) out.push('spotify');
    return out;
  }

  function renderTabs() {
    var was = BAR[nav.bar], button = was && was.sym;
    TABS = availableTabs();
    BAR = barItems();
    if (TABS.indexOf(nav.tab) < 0) nav.tab = 'home';
    // Items came or went: the focus stays on the same tab, or the same button.
    nav.bar = BAR.indexOf(nav.tab);
    var bar = $('tabs');
    bar.innerHTML = '';
    for (var i = 0; i < BAR.length; i++) {
      var item = BAR[i];
      if (item.sym) sym(item.sym, el('span', 'tab button', bar));
      else if (item === 'search') sym('search', el('span', 'tab icon', bar));
      else el('span', 'tab', bar, tabName(item));
      hoverBar(bar.lastChild, i);
      if (button && item.sym === button) nav.bar = i;
    }
  }

  /** As on Apple TV: focusing a tab shows it; the buttons only take the focus. */
  function focusBar(i) {
    nav.bar = i;
    if (!BAR[i].sym && BAR[i] !== nav.tab) showTab(BAR[i]);
    else update();
  }

  function updateBar() {
    var items = $('tabs').children;
    for (var i = 0; i < items.length; i++) {
      setClass(items[i], 'current', BAR[i] === nav.tab);
      setClass(items[i], 'focus', st.zone === Z.MAIN && nav.area === 'tabs' && nav.bar === i);
    }
  }

  function calmMode() { return !HERO.length; }

  /** TV and YouTube share the cinema screen and its rows: built says which of them HERO and LANES are now. */
  var built = 'tv';
  function cinema() { return nav.tab === 'tv' || nav.tab === 'youtube'; }

  /** The stage's classes say which tab is in front and how the TV tab is laid out. */
  function updateStage() {
    var tv = cinema(), content = nav.area === 'content';
    stage.className = 'tab-' + nav.tab + (tv && calmMode() ? ' calm' : '') +
        (tv && !calmMode() && content && tvf.area === 'rows' ? ' in-rows paused' : '') +
        (tv && !calmMode() && content && tvf.area === 'hero' ? ' hero-focus' : '');
    for (var i = 0; i < PANES.length; i++) setClass($('pane-' + PANES[i]), 'on', nav.tab === PANES[i] || (tv && PANES[i] === 'tv'));
  }

  function update() {
    updateBar();
    updateStage();
    updateGrids();
    updateTV();
    updateSearch();
  }

  function showTab(name) {
    nav.tab = name;
    Spotify.watch(name === 'spotify');
    if (cinema() && built !== name) {
      built = name;
      tvf.hero = 0;
      tvf.idx = {};
      renderTV();
      resetTV();
    }
    if (cinema()) {
      if (!calmMode()) showHero(tvf.hero, true);
    } else {
      clearTimeout(heroTimer);
      if (name === 'home') homeLight();
      else if (name === 'spotify' && Spotify.now()) ambient('', spotifyArt(Spotify.now(), true));
      else ambient('');
    }
    update();
  }

  /** From a tile on Hjem into another tab. */
  function goTab(name) {
    if (TABS.indexOf(name) < 0) return;
    nav.area = 'content';
    showTab(name);
  }

  function focusTabs() {
    nav.area = 'tabs';
    nav.bar = BAR.indexOf(nav.tab);
    resetTV();
    update();
  }

  function enterTab() {
    nav.area = 'content';
    if (nav.tab === 'search') srch.area = 'keys';
    resetTV();
    update();
  }

  /** From a tile on Hjem to a row of the TV tab (or YouTube's). */
  function goTo(lane, tab) {
    tab = tab || 'tv';
    if (TABS.indexOf(tab) < 0) return;
    nav.area = 'content';
    showTab(tab);
    resetTV();
    for (var i = 0; i < LANES.length; i++) if (LANES[i].id === lane) { tvf.area = 'rows'; tvf.row = i; }
    showTab(tab);
  }

  // MARK: - The room's light and the cinema screen's picture

  var ambOn = 0, ambUrl = null, shotOn = 0, shotUrl = null;

  /**
   * The light around: TMDB's smallest backdrop, stretched; soft by itself and cheap to draw (no filter: blur). bg: a
   * drawn picture (a CSS gradient) instead.
   */
  function ambient(path, bg) {
    var url = bg || (path ? 'url(' + image(path, 'w300') + ')' : '');
    setClass($('ambient'), 'on', !!url && !(cinema() && calmMode()));
    if (url === ambUrl) return;
    ambUrl = url;
    var next = $('amb' + (1 - ambOn)), cur = $('amb' + ambOn);
    if (!url) { setClass(cur, 'on', false); return; }
    next.style.backgroundImage = url;
    setClass(next, 'on', true);
    setClass(cur, 'on', false);
    ambOn = 1 - ambOn;
  }

  function shot(path, bg) {
    var url = bg || (path ? 'url(' + image(path, 'w1280') + ')' : '');
    if (url === shotUrl) return;
    shotUrl = url;
    var next = $('shot' + (1 - shotOn)), cur = $('shot' + shotOn);
    if (!url) { setClass(cur, 'on', false); return; }
    next.style.backgroundImage = url;
    setClass(next, 'on', true);
    setClass(cur, 'on', false);
    shotOn = 1 - shotOn;
  }

  // MARK: - TV: the rotation on the cinema screen

  var HERO = [], heroTimer = 0, swapTimer = 0, bgTimer = 0;
  var tvf = {area: 'hero', hero: 0, row: 0, idx: {}};

  /** Shows we want to start and movies we can stream, newest first, only titles in our apps with a wide picture. */
  function toStart(h) {
    var all = h.wantToStart.concat(h.movies), out = [];
    for (var i = 0; i < all.length; i++) if (appOf(all[i]) && wide(all[i], true)) out.push(all[i]);
    out.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
    return out;
  }

  /** What we're watching, new episodes and something we want to start, two of each, only titles in our apps. */
  function titleHeroes() {
    if (!Stasera.linked()) return [];
    var h = Stasera.home(), cont = [], fresh = [], want = toStart(h), out = [], i;
    for (i = 0; i < h.watching.length; i++) {
      var w = h.watching[i];
      if (!appOf(w) || !wide(w, true)) continue;
      (isNew(w) ? fresh : cont).push(w);
    }
    fresh.sort(function (a, b) { return a.airDate < b.airDate ? 1 : a.airDate > b.airDate ? -1 : 0; });
    for (i = 0; i < 2; i++) {
      if (cont[i]) out.push(heroOf(cont[i], tr('Continue Watching')));
      if (fresh[i]) out.push(heroOf(fresh[i], tr('New episode'), dayLabel(fresh[i].airDate)));
      if (want[i]) out.push(heroOf(want[i], tr('Start this one?')));
    }
    return out;
  }

  /** YouTube's cinema screen: the last three added to our playlist, then the newest video of three channels. */
  function videoHeroes() {
    var saved = YouTube.saved(), videos = YouTube.videos(), list = YouTube.playlist(), out = [], seen = {}, i;
    for (i = 0; i < saved.length && i < 3; i++) out.push(videoHero(saved[i], list.title));
    for (i = 0; i < videos.length && out.length < 6; i++) {
      if (seen[videos[i].channel]) continue;
      seen[videos[i].channel] = true;
      out.push(videoHero(videos[i], tr('New video')));
    }
    return out;
  }

  function heroContent(h, inRows) {
    var hc = $('hc');
    hc.innerHTML = '';
    var k = el('div', 'kicker', hc, h.kicker);
    if (h.dim) { el('span', 'sep', k, '·'); el('span', 'dim', k, h.dim); }
    if (h.logo) {
      var img = el('img', 'logo', hc);
      img.onerror = function () { hc.replaceChild(titleText(h.title), img); };
      img.src = image(h.logo, 'w500');
    } else {
      hc.appendChild(titleText(h.title));
    }
    var meta = el('div', 'meta', hc);
    for (var i = 0; h.meta && i < h.meta.length; i++) {
      if (i) el('span', 'sep', meta, '·');
      meta.appendChild(document.createTextNode(h.meta[i]));
    }
    if (h.progress !== null && h.progress !== undefined) {
      var line = el('div', 'prog-line', hc), bar = el('div', 'progress', line);
      transform(el('i', '', bar), 'scaleX(' + h.progress.toFixed(3) + ')');
      el('span', '', line, h.progressText);
    }
    if (h.overview) el('div', 'overview', hc, h.overview);
    if (h.button && !inRows) {
      var b = el('span', 'btn', el('div', 'actions', hc));
      el('span', 'play', b);
      b.appendChild(document.createTextNode(h.button));
      if (h.app) el('span', 'chip', b, h.app);
    }
  }

  function titleText(title) {
    return el('div', 'title-text' + (title.length > 18 ? ' long' : ''), null, title);
  }

  function showContent(h, inRows, instant) {
    clearTimeout(swapTimer);
    var hc = $('hc');
    if (instant) { heroContent(h, inRows); hc.className = 'hc'; return; }
    hc.className = 'hc swapping';
    swapTimer = setTimeout(function () { heroContent(h, inRows); hc.className = 'hc'; }, 200);
  }

  function showHero(i, instant) {
    if (!HERO.length) return;
    tvf.hero = (i + HERO.length) % HERO.length;
    var h = HERO[tvf.hero];
    showContent(h, false, instant);
    shot(h.img, h.bg);
    ambient(h.ambient, h.bg);
    var dots = $('dots');
    for (var d = 0; d < dots.children.length; d++) {
      dots.children[d].className = d < tvf.hero ? 'done' : d === tvf.hero ? 'on' : '';
    }
    // A new node starts the dot's fill over.
    var cur = dots.children[tvf.hero];
    if (cur) dots.replaceChild(cur.cloneNode(true), cur);
    clearTimeout(heroTimer);
    heroTimer = setTimeout(function () {
      if (cinema() && tvf.area === 'hero' && !sheetOpen() && !saverOn) showHero(tvf.hero + 1);
    }, 8000);
  }

  // MARK: - TV: the rows

  var LANES = [];

  function card(cls, parent) {
    var c = el('div', 'card ' + cls, parent);
    return c;
  }

  function cardImage(c, url) {
    var i = el('div', 'img', c);
    if (url) i.style.backgroundImage = 'url(' + url + ')';
    return i;
  }

  function caption(item, title, sub) {
    var cap = el('div', 'cap', item);
    el('b', '', cap, title);
    el('span', '', cap, sub);
  }

  function logoOrTitle(c, item, size) {
    if (item.logoPath) {
      var img = el('img', 'clogo', c);
      img.onerror = function () { c.removeChild(img); el('div', 'ctitle', c, item.title); };
      img.src = image(item.logoPath, size || 'w300');
    } else {
      el('div', 'ctitle', c, item.title);
    }
  }

  function watchingItem(item, node) {
    var c = card('big', node), still = item.stillPath;
    cardImage(c, image(still || wide(item, !!item.logoPath), 'w780'));
    el('div', 'shade', c);
    if (item.logoPath) logoOrTitle(c, item);
    var t = el('div', 'btext', c);
    el('b', '', t, item.logoPath ? '' : item.title);
    el('span', '', t, ep(item) + (episodeName(item) ? ' · ' + episodeName(item) : ''));
    if (item.total) transform(el('i', '', el('div', 'progress', c)), 'scaleX(' + (item.watched / item.total).toFixed(3) + ')');
    if (isNew(item)) el('div', 'badge', c, tr('badge|New'));
    el('div', 'ring', c);
    var sub = [left(item)];
    if (serviceName(item)) sub.push(serviceName(item));
    var cap = el('div', 'cap', node);
    el('span', '', cap, sub.join(' · '));
  }

  function posterItem(item, node) {
    var c = card('poster', node);
    cardImage(c, image(item.posterPath, 'w342'));
    el('div', 'shade', c);
    el('div', 'ring', c);
    caption(node, item.title, metaOf(item).join(' · '));
  }

  function friendItem(f, node) {
    var c = card('land', node), e = f.entity;
    cardImage(c, image(e.backdropPath || e.posterPath, 'w780'));
    el('div', 'shade', c);
    el('span', 'avatar', c, initials(f.friendName));
    if (f.together === 'you') el('span', 'avatar you', c, tr('You').charAt(0));
    el('div', 'ctitle', c, e.title);
    el('div', 'ring', c);
    caption(node, friendText(f), ago(f.at));
  }

  function videoItem(v, node) {
    var c = card('land video', node);
    cardImage(c, '').style.backgroundImage = videoArt(v);
    if (v.color) el('div', 'mark', c, v.channel.charAt(0));
    el('span', 'chan', c, v.channel);
    if (v.duration) el('span', 'dur', c, duration(v.duration));
    el('div', 'ring', c);
    caption(node, v.title, v.channel + ' · ' + ago(v.at));
  }

  function appItem(app, node) {
    var c = card('app', node), box = el('div', 'face', c);
    face(app, box, wordFit(app.title, calmMode() ? 304 : 256, 34));
    el('div', 'ring', c);
  }

  function buildLanes() {
    var out = [], h = Stasera.home();
    if (!calmMode()) {
      if (h.watching.length) {
        out.push({id: 'watching', title: tr('Watching'), count: h.watchingCount, items: h.watching.map(function (w) {
          return {draw: function (n) { watchingItem(w, n); }, hero: heroOf(w, tr('Watching')), run: function () { openTitle(w); }, hold: w};
        })});
      }
      if (h.wantToStart.length) {
        out.push({id: 'want', title: tr('Want to Start'), items: h.wantToStart.map(function (w) {
          return {draw: function (n) { posterItem(w, n); }, hero: heroOf(w, tr('Want to Start')), run: function () { openTitle(w); },
            hold: kindOf(w) === 'movie' ? w : null};
        })});
      }
      if (h.movies.length) {
        out.push({id: 'movies', title: tr('Movies'), items: h.movies.map(function (m) {
          return {draw: function (n) { posterItem(m, n); }, hero: heroOf(m, tr('Movies')), run: function () { openTitle(m); }, hold: m};
        })});
      }
      var feed = friendsFeed();
      if (feed.length) {
        out.push({id: 'friends', title: tr('Friends'), items: feed.map(function (f) {
          var e = f.entity;
          return {draw: function (n) { friendItem(f, n); },
            hero: {kicker: tr('Friends'), title: e.title, img: e.backdropPath, ambient: e.backdropPath || e.posterPath, meta: [friendText(f), ago(f.at)]},
            run: function () { openTitle(ownTitle(e) || e); }};
        })});
      }
    }
    // Only the app library: the rest is in All Apps, from the tab bar.
    var appItems = shelf.map(function (a) {
      return {draw: function (n) { appItem(a, n); }, hero: {kicker: tr('Apps'), title: a.title, meta: [tr('Open the app')]},
        run: launcher(a.id, a.title)};
    });
    if (appItems.length) out.push({id: 'apps', title: tr('Apps'), items: appItems});
    return out;
  }

  /** YouTube's rows: our playlist, and what's new from the subscriptions. */
  function videoLanes() {
    var out = [], saved = YouTube.saved(), videos = YouTube.videos(), list = YouTube.playlist();
    function items(vs, kicker) {
      return vs.map(function (v) {
        return {draw: function (n) { videoItem(v, n); }, hero: videoHero(v, kicker), run: function () { launchVideo(v); }};
      });
    }
    if (saved.length) out.push({id: 'saved', title: list.title, items: items(saved, list.title)});
    if (videos.length) {
      var note = YouTube.sample() ? tr('Sample data: sign in to YouTube in Home Settings') : '';
      out.push({id: 'subs', title: tr('New from your subscriptions'), note: note, items: items(videos, tr('New video'))});
    }
    return out;
  }

  function renderTV() {
    var laneId = LANES[tvf.row] ? LANES[tvf.row].id : null;
    HERO = built === 'youtube' ? videoHeroes() : titleHeroes();
    LANES = built === 'youtube' ? videoLanes() : buildLanes();
    tvf.hero = Math.min(tvf.hero, Math.max(0, HERO.length - 1));
    tvf.row = 0;
    for (var r = 0; r < LANES.length; r++) if (LANES[r].id === laneId) tvf.row = r;
    if (calmMode() || !LANES.length) tvf.area = calmMode() ? 'rows' : 'hero';
    var dots = $('dots');
    dots.innerHTML = '';
    for (var d = 0; d < HERO.length; d++) el('i', '', el('span', '', dots));
    var rows = $('rows');
    rows.innerHTML = '';
    for (var i = 0; i < LANES.length; i++) {
      var lane = LANES[i], sec = el('div', 'lane', rows), h2 = el('h2', '', sec, lane.title);
      if (lane.count) el('span', 'count', h2, String(lane.count));
      if (lane.note) el('span', 'note', h2, lane.note);
      var track = el('div', 'track', sec);
      lane.node = sec;
      lane.track = track;
      tvf.idx[lane.id] = Math.min(tvf.idx[lane.id] || 0, lane.items.length - 1);
      for (var j = 0; j < lane.items.length; j++) {
        var node = el('div', 'item', track);
        lane.items[j].draw(node);
        lane.items[j].node = node;
        hoverItem(node, i, j);
      }
    }
    if (nav.tab === built && !calmMode() && tvf.area === 'hero') showHero(tvf.hero, true);
  }

  function resetTV() {
    tvf.area = calmMode() ? 'rows' : 'hero';
    tvf.row = 0;
    if (nav.tab === built && !calmMode()) showHero(tvf.hero, true);
  }

  /** Keeps the focused card at the row's left edge, but never scrolls past the end. */
  function scrollTrack(track, items, i, view) {
    if (!items.length) return;
    var last = items[items.length - 1], first = items[0].offsetLeft;
    var max = Math.max(0, last.offsetLeft + last.offsetWidth - first - view);
    transform(track, 'translateX(' + (-Math.min(items[i].offsetLeft - first, max)) + 'px)');
  }

  function updateTV() {
    var inRows = nav.area === 'content' && tvf.area === 'rows' && cinema();
    for (var r = 0; r < LANES.length; r++) {
      var lane = LANES[r], k = tvf.idx[lane.id] || 0;
      for (var i = 0; i < lane.items.length; i++) setClass(lane.items[i].node, 'focus', inRows && st.zone === Z.MAIN && r === tvf.row && i === k);
      scrollTrack(lane.track, lane.track.children, k, 1696);
      setClass(lane.node, 'gone', inRows && !calmMode() && r < tvf.row);
    }
    var y = 0;
    if (inRows && !calmMode() && LANES[tvf.row]) y = 590 - LANES[tvf.row].node.offsetTop;
    transform($('rows'), 'translateY(' + y + 'px)');
    if (inRows && !calmMode() && LANES[tvf.row]) {
      var it = LANES[tvf.row].items[tvf.idx[LANES[tvf.row].id] || 0];
      clearTimeout(bgTimer);
      clearTimeout(heroTimer);
      showContent(it.hero, true, true);
      // The big picture waits for the focus to settle.
      bgTimer = setTimeout(function () {
        shot(it.hero.img, it.hero.bg);
        ambient(it.hero.ambient || it.hero.img, it.hero.bg);
      }, 260);
    }
  }

  function tvMove(dx, dy) {
    if (tvf.area === 'hero') {
      if (dx) showHero(tvf.hero + dx);
      else if (dy > 0 && LANES.length) { tvf.area = 'rows'; tvf.row = 0; }
      else if (dy < 0) { focusTabs(); return; }
      update();
      return;
    }
    var lane = LANES[tvf.row];
    if (!lane) { if (dy < 0) focusTabs(); return; }
    if (dx) tvf.idx[lane.id] = Math.max(0, Math.min(lane.items.length - 1, (tvf.idx[lane.id] || 0) + dx));
    else if (dy > 0 && tvf.row < LANES.length - 1) tvf.row++;
    else if (dy < 0) {
      if (tvf.row > 0) tvf.row--;
      else if (calmMode()) { focusTabs(); return; }
      else { tvf.area = 'hero'; update(); showHero(tvf.hero, true); return; }
    }
    update();
  }

  /** The thing under the focus in the TV tab: {run, hold, node}. */
  function tvFocused() {
    if (tvf.area === 'hero') {
      var h = HERO[tvf.hero];
      return h ? {run: h.run || function () { openTitle(h.item); }, hold: h.item, node: $('hero')} : null;
    }
    var lane = LANES[tvf.row], it = lane && lane.items[tvf.idx[lane.id] || 0];
    return it ? {run: it.run, hold: it.hold, node: it.node.firstChild} : null;
  }

  // MARK: - The tabs of tiles (Hjem, Statistikk, GitHub, Home Assistant)

  var grids = {}, drawing = 'home', featured = null, video = null;   // the title or the video in Hjem's big tile

  /** A tab's tiles and which has the focus. */
  function grid(name) { return grids[name] || (grids[name] = {tiles: [], focus: 0}); }

  /** Empties a tab before its tiles are drawn again; tile() adds to it. */
  function startPane(name) {
    drawing = name;
    grid(name).tiles = [];
    var pane = $('pane-' + name);
    pane.innerHTML = '';
    return pane;
  }

  function endPane(name) {
    var g = grid(name);
    g.focus = Math.max(0, Math.min(g.focus, g.tiles.length - 1));
  }

  function tile(x, y, w, h, cls, run, hold) {
    var g = grid(drawing), t = el('div', 'tile' + (cls ? ' ' + cls : ''), $('pane-' + drawing));
    t.style.left = x + 'px';
    t.style.top = y + 'px';
    t.style.width = w + 'px';
    t.style.height = h + 'px';
    g.tiles.push({node: t, run: run, hold: hold});
    hoverTile(t, drawing, g.tiles.length - 1);
    return t;
  }

  // MARK: - Hjem: the tiles

  function ring(t) { el('div', 'ring', t); }

  function featureTile(item, kicker) {
    var t = tile(112, 300, 1040, 440, 'feature', function () { openTitle(item); }, item);
    var img = el('div', 'feat-img', t);
    img.style.backgroundImage = 'url(' + image(wide(item, !!item.logoPath), 'w1280') + ')';
    el('div', 'feat-shade', t);
    var text = el('div', 'feat-text', t);
    el('div', 'kicker', text, kicker);
    if (item.logoPath) {
      var logo = el('img', 'feat-logo', text);
      logo.onerror = function () { text.replaceChild(el('div', 'feat-title', null, item.title), logo); };
      logo.src = image(item.logoPath, 'w500');
    } else {
      el('div', 'feat-title', text, item.title);
    }
    var meta = el('div', 'meta', text), m = metaOf(item);
    for (var i = 0; i < m.length; i++) {
      if (i) el('span', 'sep', meta, '·');
      meta.appendChild(document.createTextNode(m[i]));
    }
    if (item.watched > 0 && item.total) {
      var line = el('div', 'prog-line', text);
      transform(el('i', '', el('div', 'progress', line)), 'scaleX(' + (item.watched / item.total).toFixed(3) + ')');
      el('span', '', line, left(item));
    }
    ring(t);
  }

  /** Hjem's video: the last one added to our playlist, or the newest from the subscriptions; {video, kicker} or null. */
  function homeVideo() {
    if (!YouTube.enabled()) return null;
    var saved = YouTube.saved(), videos = YouTube.videos();
    if (saved.length) return {video: saved[0], kicker: YouTube.playlist().title};
    return videos.length ? {video: videos[0], kicker: tr('New video')} : null;
  }

  function videoFeatureTile(hv) {
    var v = hv.video, t = tile(112, 300, 1040, 440, 'feature', function () { launchVideo(v); });
    el('div', 'feat-img', t).style.backgroundImage = videoArt(v, true);
    if (v.color) el('div', 'mark', t, v.channel.charAt(0));
    el('div', 'feat-shade', t);
    var text = el('div', 'feat-text', t), k = el('div', 'kicker', text, hv.kicker);
    if (YouTube.sample()) el('span', 'tag', k, tr('tag|sample'));
    el('div', 'feat-title video', text, v.title);
    var meta = el('div', 'meta', text), m = [v.channel, ago(v.at)];
    if (v.duration) m.push(duration(v.duration));
    for (var i = 0; i < m.length; i++) {
      if (i) el('span', 'sep', meta, '·');
      meta.appendChild(document.createTextNode(m[i]));
    }
    ring(t);
  }

  function linkTile() {
    var t = tile(112, 300, 1040, 440, 'quiet link', openLink);
    el('div', 'label', t, 'Stasera');
    el('div', 'big', t, tr('Link this TV to Stasera'));
    el('div', 'sub', t, tr("Then Home and TV show what you're watching, new episodes and what your friends watch."));
    el('span', 'btn', t, tr('Show the code'));
    ring(t);
  }

  function weatherTile(x, y, w, h) {
    var t = tile(x, y, w, h, '', null), wx = Data.weather;
    el('div', 'label', t, Data.city || tr('Weather'));
    if (!wx) { el('div', 'sub', t, tr('No weather data right now.')); ring(t); return; }
    var now = el('div', 'wx-now', t);
    sym(Data.symbol(wx.code, wx.isDay), now);
    el('span', 'temp', now, Data.degrees(wx.temp));
    el('span', 'cond', now, Data.condition(wx.code, wx.isDay));
    if (h >= 400) {
      var hours = el('div', 'wx-hours', t), hw = (w - 64) / 6;
      for (var i = 0; i < wx.hours.length && i < 6; i++) {
        var hr = el('div', 'wx-hour', hours), x0 = wx.hours[i];
        hr.style.left = (hw * i) + 'px';
        hr.style.width = hw + 'px';
        el('div', 't', hr, Data.hour(x0.at));
        sym(Data.symbol(x0.code, x0.day), hr);
        el('div', 'd', hr, Data.degrees(x0.temp));
      }
      var sun = el('div', 'wx-sun', t);
      if (wx.sunrise) { var a = el('span', '', sun); sym('sunrise', a); a.appendChild(document.createTextNode(trf('Sunrise {time}', {time: Data.time(wx.sunrise)}))); }
      if (wx.sunset) { var b = el('span', '', sun); sym('sunset', b); b.appendChild(document.createTextNode(trf('Sunset {time}', {time: Data.time(wx.sunset)}))); }
    } else {
      el('div', 'sub', t, trf('H:{max}', {max: Data.degrees(wx.max)}) + '   ' + trf('L:{min}', {min: Data.degrees(wx.min)}) +
          (wx.sunset ? '   ·   ' + trf('Sunset {time}', {time: Data.time(wx.sunset)}) : ''));
    }
    ring(t);
  }

  function newEpisodesTile(x, y) {
    var t = tile(x, y, 632, 208, '', function () { goTo('watching'); });
    el('div', 'label', t, tr('New Episodes'));
    var fresh = Stasera.home().watching.filter(isNew).sort(function (a, b) { return a.airDate < b.airDate ? 1 : a.airDate > b.airDate ? -1 : 0; });
    if (!fresh.length) {
      el('div', 'sub', t, tr('Nothing new in the last two weeks.'));
    } else {
      var lines = el('div', 'lines', t);
      for (var i = 0; i < fresh.length && i < 3; i++) {
        var li = el('div', 'li', lines);
        el('span', 'r', li, dayLabel(fresh[i].airDate));
        li.appendChild(document.createTextNode(fresh[i].title + ' '));
        el('span', 'dim', li, ep(fresh[i]));
      }
    }
    ring(t);
  }

  function besideTile(x, y, item, kicker) {
    var t = tile(x, y, 632, 208, '', function () { openTitle(item); });
    var th = el('div', 'thumb', t);
    th.style.backgroundImage = 'url(' + image(item.backdropPath || item.textlessBackdropPath, 'w780') + ')';
    var b = el('div', 'beside', t);
    el('div', 'label', b, kicker);
    el('div', 't', b, item.title);
    el('div', 'sub', b, metaOf(item).join(' · '));
    ring(t);
  }

  function statsTile(x, y) {
    var t = tile(x, y, 406, 210, '', function () { goTab('stasera'); });
    var h = Stasera.home(), s = h.stats, month = '', minutes = 0, d = new Date();
    month = d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1);
    for (var i = 0; s && s.byMonth && i < s.byMonth.length; i++) if (s.byMonth[i].month === month) minutes = s.byMonth[i].minutes || 0;
    el('div', 'label', t, tr('Stats'));
    var n = el('div', 'mini', t, String(Math.round(minutes / 60)));
    el('small', '', n, trf('h in {month}', {month: formatDate('format|MMMM', Date.now())}));
    el('div', 'sub', t, plural('plural|one:{n} show in progress|other:{n} shows in progress', h.watchingCount));
    ring(t);
  }

  /** Commits the last 30 days, and whether the deploys built (with Vercel) or the streak (without). */
  function githubTile(x, y) {
    var t = tile(x, y, 406, 210, '', function () { goTab('github'); }), s = GitHub.summary();
    el('div', 'label', t, 'GitHub');
    if (!GitHub.github()) {
      // Vercel alone: the newest deploy, and whether they all built.
      var d = s.deploys && s.deploys[0];
      el('div', 'who', t, d ? d.project + ' · ' + ago(d.at) : '–');
      var vs = el('div', 'sub one', t);
      if (s.vercelProblem) vs.textContent = tr("The token isn't valid.");
      else if (!s.loaded) vs.textContent = tr('Fetching from Vercel…');
      else if (s.failed) el('span', 'st-err', vs, '✕ ' + plural('plural|one:{n} deploy failed|other:{n} deploys failed', s.failed));
      else if (d) el('span', 'st-ok', vs, '✓ ' + tr('All deploys ready'));
      else vs.textContent = tr('No deploys yet.');
      ring(t);
      return;
    }
    var n = el('div', 'mini', t, s.loaded || s.sample ? num(s.last30) : '–');
    el('small', '', n, tr('commits, 30 days'));
    var sub = el('div', 'sub one', t);
    if (s.problem) sub.textContent = tr("The token isn't valid.");
    else if (!s.loaded && !s.sample) sub.textContent = tr('Fetching from GitHub…');
    else if (s.deploys && s.failed) el('span', 'st-err', sub, '✕ ' + plural('plural|one:{n} deploy failed|other:{n} deploys failed', s.failed));
    else if (s.deploys && s.deploys.length) el('span', 'st-ok', sub, '✓ ' + tr('All deploys ready'));
    else sub.textContent = plural('plural|one:{n} day in a row|other:{n} days in a row', s.streak);
    ring(t);
  }

  /** Hjem's video, small: its picture under the title, and OK plays it. */
  function youtubeTile(x, y, hv) {
    var v = hv.video, t = tile(x, y, 406, 210, 'vid', function () { launchVideo(v); });
    el('div', 'feat-img', t).style.backgroundImage = videoArt(v, true);   // 16:9: the small one is 4:3, with bars
    el('div', 'vid-shade', t);
    var l = el('div', 'label', t, YouTube.saved().length ? 'YouTube · ' + hv.kicker : 'YouTube');
    if (YouTube.sample()) el('span', 'tag', l, tr('tag|sample'));
    var text = el('div', 'vid-text', t);
    el('div', 'who', text, v.title);
    el('div', 'sub one', text, v.channel + ' · ' + ago(v.at));
    ring(t);
  }

  /** Kunstmodus (AUG-1438): what the Frame Art add-on shows. OK puts the TV in Art Mode; holding OK, a new picture. */
  function artTile(x, y) {
    var t = tile(x, y, 406, 210, '', function () { artDo(Art.artMode, tr('Art Mode…')); },
      function () { artDo(Art.next, tr('A new picture…')); });
    var l = el('div', 'label', t, tr('Art Mode'));
    if (Art.sample()) el('span', 'tag', l, tr('tag|sample'));
    el('div', 'who', t, Art.showing() || tr('Random rotation'));
    var sub = tr('Hold OK for a new picture');
    if (Art.mode() === 'fixed') sub = tr('Fixed picture until the morning · hold OK for a new one');
    else if (Art.mode() === 'category' && Art.minutes()) {
      sub = trf('{category} · every {n} min · hold OK for a new one', {category: Art.category(), n: Art.minutes()});
    } else if (Art.minutes()) sub = trf('New picture every {n} min · hold OK for one now', {n: Art.minutes()});
    el('div', 'sub one', t, sub);
    ring(t);
  }

  function artDo(call, doing) {
    if (Art.busy()) { toast(tr('Art Mode is busy with the TV.')); return; }
    toast(doing, 180000);
    call(function (ok) { toast(ok ? tr('Done.') : tr("Couldn't reach Art Mode on the Pi.")); });
  }

  function friendsTile(x, y, f) {
    var t = tile(x, y, 406, 210, '', function () { goTo('friends'); });
    el('div', 'label', t, tr('Friends'));
    el('div', 'who', t, friendText(f));
    el('div', 'sub one', t, f.entity.title + ' · ' + ago(f.at));
    ring(t);
  }

  function appTile(x, y, app, w, h) {
    var t = tile(x, y, w, h, 'app', launcher(app.id, app.title));
    face(app, el('div', 'face', t), wordFit(app.title, w, 44));
    ring(t);
  }

  /** The Hjem tile of a shelf app, to draw at x, y. */
  function appAt(app, w, h) {
    return function (x, y) { appTile(x, y, app, w, h); };
  }

  /** The room's light on Hjem: the big tile's picture. */
  function homeLight() {
    if (featured) ambient(featured.backdropPath || featured.textlessBackdropPath);
    else ambient('', video ? videoArt(video) : '');
  }

  function renderHome() {
    var pane = startPane('home');
    var g = el('div', 'greet', pane);
    el('h1', '', g, greeting());
    var h = Stasera.home(), linked = Stasera.linked(), hv = homeVideo(), i;
    var cont = null, want = toStart(h)[0] || null;
    for (i = 0; i < h.watching.length && !cont; i++) if (appOf(h.watching[i]) && wide(h.watching[i], true)) cont = h.watching[i];
    featured = cont || want;
    video = null;
    var linkBig = !featured && Stasera.enabled() && !linked;
    if (cont) featureTile(cont, tr('Continue Watching'));
    else if (want) featureTile(want, tr('Start this one?'));
    else if (linkBig) linkTile();
    else if (hv) { video = hv.video; videoFeatureTile(hv); }
    else weatherTile(112, 300, 1040, 440);
    var weatherBig = !featured && !linkBig && !video;
    var used = 0;   // shelf apps that have a tile
    if (linked) {
      newEpisodesTile(1176, 300);
      if (cont && want) besideTile(1176, 532, want, tr('Start this one?'));
      else if (!weatherBig) weatherTile(1176, 532, 632, 208);
      else if (shelf.length) appAt(shelf[used++], 632, 208)(1176, 532);
    } else {
      // The weather (when the big tile isn't it), and apps in the room left.
      var side = [];
      if (!weatherBig) side.push(function (x, y) { weatherTile(x, y, 632, 208); });
      while (side.length < 2 && used < shelf.length) side.push(appAt(shelf[used++], 632, 208));
      for (i = 0; i < side.length; i++) side[i](1176, 300 + i * 232);
    }
    // The first four of these that are on (a module that's off makes room for the next), and apps after them when
    // there are fewer. YouTube's tile only when its video isn't the big one; Spotify's first while something plays.
    var feed = friendsFeed(), small = [], playing = Spotify.enabled() && !!Spotify.now();
    if (playing) small.push(spotifyTile);
    if (linked) small.push(statsTile);
    if (hv && !video) small.push(function (x, y) { youtubeTile(x, y, hv); });
    if (GitHub.enabled()) small.push(githubTile);
    if (HA.enabled()) small.push(haTile);
    if (feed.length) small.push(function (x, y) { friendsTile(x, y, feed[0]); });
    if (Spotify.enabled() && !playing) small.push(spotifyTile);
    if (Art.enabled()) small.push(artTile);
    small = small.slice(0, 4);
    while (small.length < 4 && used < shelf.length) small.push(appAt(shelf[used++], 406, 210));
    for (i = 0; i < small.length; i++) small[i](112 + i * 430, 772);
    endPane('home');
    renderClock();
    if (nav.tab === 'home') homeLight();
  }

  function updateGrids() {
    for (var name in grids) {
      if (!grids.hasOwnProperty(name)) continue;
      var g = grids[name], on = st.zone === Z.MAIN && nav.tab === name && nav.area === 'content';
      for (var i = 0; i < g.tiles.length; i++) setClass(g.tiles[i].node, 'focus', on && i === g.focus);
    }
  }

  /** The nearest tile the way the arrow points, weighing straight lines over diagonals. */
  function spatialMove(nodes, cur, dir) {
    if (cur < 0) return 0;
    var a = nodes[cur].getBoundingClientRect(), best = -1, bestScore = 1e9;
    for (var i = 0; i < nodes.length; i++) {
      if (i === cur) continue;
      var b = nodes[i].getBoundingClientRect(), main = 0, side = 0;
      if (dir === 'right') { if (b.left < a.right - 4) continue; main = b.left - a.right; side = Math.abs((b.top + b.bottom) - (a.top + a.bottom)) / 2; }
      if (dir === 'left') { if (b.right > a.left + 4) continue; main = a.left - b.right; side = Math.abs((b.top + b.bottom) - (a.top + a.bottom)) / 2; }
      if (dir === 'down') { if (b.top < a.bottom - 4) continue; main = b.top - a.bottom; side = Math.abs((b.left + b.right) - (a.left + a.right)) / 2; }
      if (dir === 'up') { if (b.bottom > a.top + 4) continue; main = a.top - b.bottom; side = Math.abs((b.left + b.right) - (a.left + a.right)) / 2; }
      var score = main + side * 2;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  function gridMove(dx, dy) {
    var dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up', g = grid(nav.tab);
    var n = g.tiles.length ? spatialMove(g.tiles.map(function (t) { return t.node; }), g.focus, dir) : -1;
    if (n >= 0) g.focus = n;
    else if (dir === 'up') { focusTabs(); return; }
    update();
  }

  /** What's under the focus: {run, hold, node}, or null. */
  function focused() {
    if (st.zone !== Z.MAIN || nav.area !== 'content') return null;
    if (nav.tab === 'search') return searchFocused();
    if (!cinema()) {
      var g = grid(nav.tab), t = g.tiles[g.focus];
      return t ? {run: t.run, hold: t.hold, node: t.node} : null;
    }
    return tvFocused();
  }

  // MARK: - Pieces of the tabs of tiles

  function num(n) {
    try { return Number(n).toLocaleString(I18N.locale()); } catch (e) { return String(n); }
  }

  function hoursOf(minutes) { return Math.round((minutes || 0) / 60); }

  function isoDay(at) {
    var d = new Date(at);
    return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
  }

  /**
   * Lays a row of tiles out across the 1696 px between the margins: each {w, draw(x, y, w, h)} keeps its share of the
   * width, so a row with a tile left out (no data for it) still fills the screen.
   */
  function tileRow(specs, y, h) {
    var total = 0, i;
    for (i = 0; i < specs.length; i++) total += specs[i].w;
    var room = 1696 - 24 * (specs.length - 1), x = 112;
    for (i = 0; i < specs.length; i++) {
      var w = i === specs.length - 1 ? 1808 - x : Math.round(specs[i].w * room / total);
      specs[i].draw(x, y, w, h);
      x += w + 24;
    }
  }

  function note(pane, text) { el('div', 'pane-note', pane, text); }

  /** Label, value and a bar for each row, the bars to scale with max. */
  function bars(parent, rows, max, fmt, accentFirst) {
    var box = el('div', 'bars', parent);
    for (var i = 0; i < rows.length; i++) {
      var b = el('div', 'b', box);
      el('em', '', b, rows[i].label);
      el('strong', '', b, fmt(rows[i].value));
      el('u', '', b);
      transform(el('i', accentFirst && i === 0 ? 'accent' : '', b), 'scaleX(' + (max > 0 ? rows[i].value / max : 0).toFixed(3) + ')');
    }
  }

  function stat(row, big, small) {
    var s = el('div', 'stat', row);
    el('b', '', s, big);
    el('span', '', s, small);
  }

  /** Columns from the bottom, one per value; `now` carries the accent. label(i) under some of them. */
  function columns(parent, values, width, height, now, label, top) {
    var box = el('div', 'cols', parent), max = 0, i;
    box.style.height = height + 'px';
    el('div', 'base', box);
    for (i = 0; i < values.length; i++) max = Math.max(max, values[i]);
    for (i = 0; i < values.length; i++) {
      var col = el('div', 'col' + (i === now ? ' now' : ''), box), h = max ? Math.round(values[i] / max * (height - 46)) : 0;
      col.style.width = width + 'px';
      el('i', '', col).style.height = h + 'px';
      if (i === now && top) el('b', '', col, top).style.bottom = (h + 28) + 'px';
      var l = label(i);
      if (l) el('span', '', col, l);
    }
  }

  // MARK: - Stasera: the stats from /tv/home (null until Stats has been opened in the Stasera app once)

  function renderStasera() {
    var pane = startPane('stasera'), h = Stasera.home(), s = h.stats;
    var progress = h.watching.filter(function (w) { return w.total > 0; }).slice(0, 4);
    var progressTile = {w: 620, draw: function (x, y, w, ht) {
      var t = tile(x, y, w, ht, '', null), box;
      el('div', 'label', t, tr('Progress'));
      box = el('div', 'prog', t);
      for (var i = 0; i < progress.length; i++) {
        var p = el('div', 'p', box);
        el('span', '', p, trf('{watched} of {total}', {watched: num(progress[i].watched), total: num(progress[i].total)}));
        el('em', '', p, progress[i].title);
        transform(el('i', '', el('div', 'progress', p)), 'scaleX(' + (progress[i].watched / progress[i].total).toFixed(3) + ')');
      }
      ring(t);
    }};
    if (!s) {
      tileRow([{w: 1, draw: function (x, y, w, ht) {
        var t = tile(x, y, w, ht, 'quiet link', null);
        el('div', 'label', t, tr('Stats'));
        el('div', 'big', t, tr('No stats yet'));
        el('div', 'sub', t, tr('Open Stats in the Stasera app once, and the numbers come here.'));
        ring(t);
      }}], 150, 372);
      if (progress.length) tileRow([progressTile], 554, 372);
      endPane('stasera');
      return;
    }
    if (s.computedAt) note(pane, trf('Stats from {date}', {date: formatDate('format|MMM d', s.computedAt)}));

    var now = new Date(), months = [], byMonth = {}, i;
    for (i = 0; s.byMonth && i < s.byMonth.length; i++) byMonth[s.byMonth[i].month] = s.byMonth[i].minutes || 0;
    for (i = 11; i >= 0; i--) {
      var md = new Date(now.getFullYear(), now.getMonth() - i, 1), key = isoDay(md.getTime()).slice(0, 7);
      months.push({at: md.getTime(), minutes: byMonth[key] || 0});
    }
    var year = 0;
    for (i = 0; s.byYear && i < s.byYear.length; i++) if (+s.byYear[i].year === now.getFullYear()) year = s.byYear[i].minutes || 0;

    var row1 = [{w: 620, draw: function (x, y, w, ht) {
      var t = tile(x, y, w, ht, '', null);
      el('div', 'label', t, tr('Time Watched'));
      var n = el('div', 'hero-num', t, String(hoursOf(months[11].minutes)));
      el('small', '', n, trf('h in {month}', {month: formatDate('format|MMMM', now.getTime())}));
      el('div', 'sub one', t, trf('{n} h this year', {n: num(hoursOf(year))}) + ' · ' +
          trf('{h} h in all, {episodes} episodes and {movies} movies',
              {h: num(hoursOf(s.totalRuntimeMinutes)), episodes: num(s.totalEpisodes || 0), movies: num(s.totalMovies || 0)}));
      columns(t, months.map(function (m) { return m.minutes; }), Math.floor((w - 64) / 12), 120, 11, function (k) {
        return formatDate('format|MMM', months[k].at).replace('.', '').slice(0, 3);
      }, trf('{n} h', {n: hoursOf(months[11].minutes)}));
      ring(t);
    }}];
    // The last 30 days; a Stasera from before AUG-1473 has only all time.
    var recent = s.topShowsLast30Days && s.topShowsLast30Days.length !== undefined;
    var top = (recent ? s.topShowsLast30Days : s.topShowsByTime) || [];
    if (top.length) {
      row1.push({w: 520, draw: function (x, y, w, ht) {
        var t = tile(x, y, w, ht, '', null);
        el('div', 'label', t, recent ? tr('Most Watched, Last 30 Days') : tr('Most Watched'));
        bars(t, top.slice(0, 5).map(function (x0) { return {label: x0.title, value: x0.minutes || 0}; }), top[0].minutes || 0,
            function (v) { return trf('{n} h', {n: num(hoursOf(v))}); }, true);
        el('div', 'foot', t, recent ? tr('By time') : tr("By time, all you've watched"));
        ring(t);
      }});
    }
    var done = s.completions;
    if (done) {
      row1.push({w: 508, draw: function (x, y, w, ht) {
        var t = tile(x, y, w, ht, '', null), row;
        el('div', 'label', t, tr('Finished This Year'));
        row = el('div', 'stat-row', t);
        stat(row, num(done.count || 0), tr('count|shows'));
        if (s.backlog) stat(row, num(s.backlog.episodes || 0), plural('plural|one:episodes left in {n} show|other:episodes left in {n} shows', s.backlog.shows || 0));
        var list = el('div', 'lines', t), latest = done.latest || [];
        for (var k = 0; k < latest.length && k < 3; k++) {
          var li = el('div', 'li', list);
          el('span', 'r', li, dayLabel(isoDay(latest[k].at)));
          li.appendChild(document.createTextNode(latest[k].title));
        }
        ring(t);
      }});
    }

    var row2 = [];
    if (progress.length) row2.push(progressTile);
    var hc = s.hourCounts || [], logged = 0, peak = 0;
    for (i = 0; i < hc.length; i++) { logged += hc[i]; if (hc[i] > hc[peak]) peak = i; }
    if (s.longestStreakDays || logged) {
      row2.push({w: 520, draw: function (x, y, w, ht) {
        var t = tile(x, y, w, ht, '', null), row;
        el('div', 'label', t, tr('Habits'));
        row = el('div', 'stat-row', t);
        if (s.longestStreakDays) stat(row, plural('plural|one:{n} day|other:{n} days', s.longestStreakDays), tr('longest streak'));
        if (logged) {
          stat(row, trf('peak|{hour}:00', {hour: peak}), tr('when you watch the most'));
          columns(t, hc, Math.floor((w - 64) / 24), 110, peak, function (k) { return k % 6 ? '' : (k < 10 ? '0' : '') + k; });
          el('div', 'foot', t, plural('plural|one:Time of day from {n} watch with a time|other:Time of day from {n} watches with a time', logged));
        }
        ring(t);
      }});
    }
    var nets = (s.topNetworks || []).slice(0, 5);
    if (nets.length) {
      row2.push({w: 508, draw: function (x, y, w, ht) {
        var t = tile(x, y, w, ht, '', null);
        el('div', 'label', t, tr('By Channel'));
        bars(t, nets.map(function (n) { return {label: n.network, value: n.episodes || 0}; }), nets[0].episodes || 0, num, false);
        el('div', 'foot', t, tr('Episodes'));
        ring(t);
      }});
    }
    tileRow(row1, 150, 372);
    if (row2.length) tileRow(row2, 554, 372);
    endPane('stasera');
  }

  // MARK: - GitHub: the half year's commits, the languages, the projects and the deploys (github.js)

  /** A deploy's state as [class, sign and word]; BUILDING, QUEUED and INITIALIZING are all still building. */
  function deployState(state) {
    if (state === 'READY') return ['st-ok', '✓ ' + tr('deploy|Ready')];
    if (state === 'ERROR') return ['st-err', '✕ ' + tr('deploy|Failed')];
    if (state === 'CANCELED') return ['st-off', '– ' + tr('deploy|Canceled')];
    return ['st-off', '… ' + tr('deploy|Building')];
  }

  /** The deploys as lines in `parent`, newest first; GitHub Actions last when GitHub is set up. */
  function deployLines(parent, s, from, to, actions) {
    var list = el('div', 'lines deploys', parent);
    for (var i = from; s.deploys && i < s.deploys.length && i < to; i++) {
      var d = s.deploys[i], look = deployState(d.state);
      var li = el('div', 'li', list);
      el('span', 'r', li, ago(d.at));
      el('span', 'st ' + look[0], li, look[1]);
      li.appendChild(document.createTextNode(d.project + ' '));
      el('span', 'dim', li, '· ' + (d.production ? tr('Production') : tr('Preview')));
    }
    if (!actions) return;
    // GitHub Actions don't run in the cloud for these repos (AUG-1439).
    var gha = el('div', 'li', list);
    el('span', 'st st-off', gha, '– ' + tr('deploy|Local'));
    gha.appendChild(document.createTextNode('GitHub Actions '));
    el('span', 'dim', gha, '· ' + tr('runs locally'));
  }

  function deploysTile(x, y, w, h, s, wide) {
    var t = tile(x, y, w, h, '', null);
    el('div', 'label', t, tr('Deploys'));
    if (s.vercelProblem) el('div', 'sub', t, tr("Vercel didn't accept the token (vercel_token)."));
    if (wide) {
      // Vercel alone: the whole row, in two columns.
      var two = el('div', 'two', t);
      deployLines(two, s, 0, 5);
      deployLines(two, s, 5, 10);
    } else deployLines(t, s, 0, 5, true);
    if (s.deploys && !s.deploys.length && s.loaded) el('div', 'sub', t, tr('No deploys yet.'));
    ring(t);
  }

  /**
   * The languages across the repos (AUG-1474): one stacked line, the biggest first, and a legend with the share of
   * each. The colors go by place, the gray is the rest.
   */
  function languagesTile(x, y, w, h, s) {
    var t = tile(x, y, w, h, '', null), langs = s.languages || [], room = w - 64, i;
    el('div', 'label', t, tr('Languages'));
    if (!langs.length) {
      el('div', 'sub', t, s.loaded ? tr('No code in the repos yet.') : tr('Fetching from GitHub…'));
      ring(t);
      return;
    }
    var line = el('div', 'lang-line', t), used = 0;
    for (i = 0; i < langs.length; i++) {
      // A 2px gap between the parts; the last one takes what's left.
      var last = i === langs.length - 1, px = last ? room - used : Math.round(langs[i].share * room);
      if (px < 4) continue;
      el('i', langs[i].other ? 'other' : 'c' + i, line).style.width = (last ? px : px - 2) + 'px';
      used += px;
    }
    var legend = el('div', 'lang-legend', t), cols = [el('div', 'col', legend), el('div', 'col', legend)];
    for (i = 0; i < langs.length; i++) {
      var row = el('div', 'lg', cols[i < Math.ceil(langs.length / 2) ? 0 : 1]);
      el('i', langs[i].other ? 'other' : 'c' + i, row);
      el('em', '', row, langs[i].other ? tr('languages|Other') : langs[i].name);
      el('strong', '', row, trf('{n}%', {n: langs[i].share < 0.01 ? '<1' : Math.round(langs[i].share * 100)}));
    }
    ring(t);
  }

  function renderGitHub() {
    var pane = startPane('github'), s = GitHub.summary(), hasGitHub = GitHub.github(), hasVercel = GitHub.vercel(), i;
    if (s.sample) note(pane, tr('Sample data: add github_token to config.properties'));
    else if (s.problem) note(pane, tr("GitHub didn't accept the token (github_token)."));
    else if (!s.loaded) note(pane, hasGitHub ? tr('Fetching from GitHub…') : tr('Fetching from Vercel…'));

    if (!hasGitHub) {
      deploysTile(112, 150, 1696, 372, s, true);
      endPane('github');
      return;
    }

    var t = tile(112, 150, 1100, 372, '', null), row;
    el('div', 'label', t, tr('Activity'));
    row = el('div', 'stat-row', t);
    stat(row, num(s.last30), tr('commits in the last 30 days'));
    stat(row, plural('plural|one:{n} day|other:{n} days', s.streak), tr('in a row with commits'));
    var marks = el('div', 'months', t), heat = el('div', 'heat', t), lastMark = -9, lastMonth = -1;
    for (var w = 0; w < s.heat.length; w++) {
      var wk = el('div', 'wk', heat), first = s.heat[w][0], m = +first.date.slice(5, 7);
      if (m !== lastMonth && w - lastMark >= 3) {
        var p = /^(\d+)-(\d+)-(\d+)/.exec(first.date);
        el('span', '', marks, formatDate('format|MMM', new Date(+p[1], p[2] - 1, +p[3]).getTime())).style.left = (w * 24) + 'px';
        lastMark = w;
        lastMonth = m;
      }
      for (var k = 0; k < 7; k++) {
        var c = s.heat[w][k];
        el('div', 'd' + (c.future ? ' future' : c.n === 0 ? '' : c.n < 10 ? ' l1' : c.n < 40 ? ' l2' : c.n < 100 ? ' l3' : ' l4'), wk);
      }
    }
    var repos = s.repos.filter(function (r) { return r.commits > 0; }).slice(0, 5);
    if (repos.length) {
      var per = el('div', 'per-repo', t);
      el('div', 'label', per, tr('Per Repo, Half a Year'));
      bars(per, repos.map(function (r) { return {label: r.name, value: r.commits}; }), repos[0].commits, num, true);
    }
    ring(t);

    // With Vercel the deploys sit beside the activity and the languages beside the projects; without, the
    // languages take the deploys' place and the projects the whole row.
    if (hasVercel) {
      deploysTile(1236, 150, 572, 372, s);
      languagesTile(1236, 554, 572, 300, s);
    } else languagesTile(1236, 150, 572, 372, s);

    t = tile(112, 554, hasVercel ? 1100 : 1696, 300, '', null);
    el('div', 'label', t, tr('Projects'));
    var two = el('div', 'two' + (hasVercel ? ' narrow' : ''), t), cols = [el('div', 'lines', two), el('div', 'lines', two)];
    for (i = 0; i < s.projects.length && i < 6; i++) {
      var pr = s.projects[i], pli = el('div', 'li', cols[i < 3 ? 0 : 1]);
      el('span', 'r', pli, dayLabel(isoDay(pr.at)));
      pli.appendChild(document.createTextNode(pr.name));
      el('small', '', pli, pr.message);
    }
    ring(t);
    endPane('github');
  }

  // MARK: - Home Assistant: scenes, lights, power, laundry and the guest network (ha.js)

  function decimal(v, digits) {
    var n = Number(v);
    try { return n.toLocaleString(I18N.locale(), {minimumFractionDigits: digits, maximumFractionDigits: digits}); }
    catch (e) { return n.toFixed(digits); }
  }

  /** A sensor's state with its unit ("1,36 kr/kWh"); NOK is kr. */
  function haValue(e) {
    var unit = String(e.attributes.unit_of_measurement || '').replace(/^NOK/, 'kr');
    var v = isNaN(parseFloat(e.state)) ? e.state : decimal(e.state, Math.abs(e.state) < 10 ? 2 : 0);
    return unit ? v + ' ' + unit : v;
  }

  function haUnit(e) { return String(e.attributes.unit_of_measurement || '').replace(/^NOK/, 'kr'); }

  /** The status line when HA isn't answering, or '' when it is. */
  function haProblem() {
    var s = HA.status();
    if (s === 'auth') return tr("Home Assistant didn't accept the token (home_assistant_token).");
    if (s === 'offline') return tr("Can't reach Home Assistant.");
    if (s === 'connecting') return tr('Connecting to Home Assistant…');
    return '';
  }

  /** Runs a scene or turns a light on or off; says so when HA doesn't. */
  function haRun(e, said) {
    HA.run(e.id, function (ok) {
      if (!ok) toast(tr("Home Assistant didn't answer."));
      else if (said) toast(said);
    });
  }

  function sceneTile(x, y, w, h, e) {
    var t = tile(x, y, w, h, '', function () { haRun(e, e.name); });
    el('div', 'label', t, tr('Light Scene'));
    el('div', 'ha-name', t, e.name);
    var last = Date.parse(e.attributes.last_triggered || '');
    el('div', 'sub one', t, e.state === 'on' ? tr('Running…') : last ? trf('Last run {when}', {when: ago(last)}) : '');
    ring(t);
  }

  // A light being dimmed: {id, pct, timer}. OK on a light that dims starts it; ← → change it by 10 %, OK turns the
  // light on or off, and Back, ↑ or ↓ (or a while without a press) end it.
  var dimming = null, DIM_IDLE = 10000;

  function pctOf(e) { return e.state === 'on' ? Math.max(1, Math.round((e.attributes.brightness || 255) / 2.55)) : 0; }

  function lightTile(x, y, w, h, e) {
    var dims = HA.dims(e), active = dimming && dimming.id === e.id;
    var pct = active ? dimming.pct : pctOf(e), on = pct > 0;
    var t = tile(x, y, w, h, (on ? 'ha-on' : '') + (active ? ' ha-dim' : ''), function () {
      if (dims) startDim(e);
      else haRun(e);
    });
    el('div', 'label', t, tr('Light'));
    el('div', 'ha-name', t, e.name);
    var sub = el('div', 'sub one', t);
    el('span', on ? 'st st-on' : 'st st-off', sub, on ? '● ' + tr('light|On') : '○ ' + tr('light|Off'));
    if (on && dims) sub.appendChild(document.createTextNode(trf('{n}%', {n: pct})));
    if (dims) {
      var bar = el('div', 'ha-bar', t);
      transform(el('i', '', bar), 'scaleX(' + (pct / 100).toFixed(3) + ')');
    }
    if (active) el('div', 'ha-hint', t, tr('← → brightness · OK on/off'));
    ring(t);
  }

  function startDim(e) {
    dimming = {id: e.id, pct: pctOf(e), timer: 0, send: 0};
    dimIdle();
    renderHA();
    update();
  }

  function endDim() {
    if (!dimming) return;
    clearTimeout(dimming.timer);
    dimming = null;
    renderHA();
    update();
  }

  function dimIdle() {
    clearTimeout(dimming.timer);
    dimming.timer = setTimeout(endDim, DIM_IDLE);
  }

  /** The light being dimmed has the focus (not another tab, sheet or tile). */
  function dimFocused() {
    if (!dimming || st.zone !== Z.MAIN || nav.tab !== 'ha' || nav.area !== 'content') return false;
    var t = grid('ha').tiles[grid('ha').focus];
    return !!(t && hasClass(t.node, 'ha-dim'));
  }

  /** The new brightness at once on the screen, to HA once the presses stop. */
  function setDim(pct) {
    var d = dimming;
    d.pct = pct;
    dimIdle();
    renderHA();
    update();
    clearTimeout(d.send);
    d.send = setTimeout(function () {
      HA.brightness(d.id, d.pct, function (ok) { if (!ok) toast(tr("Home Assistant didn't answer.")); });
    }, 300);
  }

  function dimStep(dx) { setDim(Math.max(0, Math.min(100, Math.round(dimming.pct / 10) * 10 + dx * 10))); }

  function dimToggle() { setDim(dimming.pct > 0 ? 0 : 100); }

  function powerTile(x, y, w, h, list) {
    var t = tile(x, y, w, h, '', null), first = list[0], a = first.attributes, i;
    el('div', 'label', t, tr('Power'));
    var n = el('div', 'hero-num', t, isNaN(parseFloat(first.state)) ? first.state : decimal(first.state, 2));
    el('small', '', n, haUnit(first));
    el('div', 'sub one', t, first.name);
    var lines = el('div', 'lines', t);
    if (a.min_price !== undefined && a.max_price !== undefined) {
      var li = el('div', 'li', lines);
      el('span', 'r', li, decimal(a.min_price, 2) + ' – ' + decimal(a.max_price, 2) +
        (a.avg_price !== undefined ? ' · ' + trf('avg {n}', {n: decimal(a.avg_price, 2)}) : ''));
      li.appendChild(document.createTextNode(tr('Today')));
    }
    for (i = 1; i < list.length && i < 4; i++) {
      var o = el('div', 'li', lines);
      el('span', 'r', o, haValue(list[i]));
      o.appendChild(document.createTextNode(list[i].name));
    }
    ring(t);
  }

  function laundryTile(x, y, w, h, list) {
    var t = tile(x, y, w, h, '', null);
    el('div', 'label', t, tr('Laundry'));
    var lines = el('div', 'lines ha-lines', t);
    for (var i = 0; i < list.length && i < 4; i++) {
      var e = list[i], on = e.state === 'on', li = el('div', 'li', lines);
      el('span', 'r', li, e.changed ? (on ? trf('started {when}', {when: ago(e.changed)}) : ago(e.changed)) : '');
      el('span', on ? 'st st-on' : 'st st-off', li, on ? '● ' + tr('laundry|Running') : '○ ' + tr('laundry|Off'));
      li.appendChild(document.createTextNode(e.name));
    }
    ring(t);
  }

  /** The guest network's QR code (an image entity), when its switch (if there is one) says it's on. */
  function guestTile(x, y, w, h, list) {
    var img = null, sw = null;
    for (var i = 0; i < list.length; i++) {
      if (/^image\./.test(list[i].id)) img = img || list[i];
      else sw = sw || list[i];
    }
    var t = tile(x, y, w, h, 'ha-guest', null), on = !sw || sw.state === 'on', src = img && HA.picture(img.attributes);
    el('div', 'label', t, tr('Guest Wi-Fi'));
    if (on && src) {
      el('img', 'ha-qr', t).src = src;
      el('div', 'sub ha-qr-text', t, tr('Scan with the camera to join'));
    } else el('div', 'sub', t, on ? tr('No QR code from Home Assistant yet.') : tr('The guest network is off.'));
    ring(t);
  }

  /** Rows of up to four tiles of one kind, from y; the next free y. */
  function haRows(list, y, h, draw) {
    for (var i = 0; i < list.length; i += 4) {
      tileRow(list.slice(i, i + 4).map(function (e) {
        return {w: 1, draw: function (x, ty, w, th) { draw(x, ty, w, th, e); }};
      }), y, h);
      y += h + 24;
    }
    return y;
  }

  function renderHA() {
    var pane = startPane('ha'), problem = haProblem();
    if (HA.sample()) note(pane, tr('Sample data: add home_assistant_url and home_assistant_token to config.properties'));
    else if (problem) note(pane, problem);
    var scenes = HA.group('scenes'), lights = HA.group('lights'), power = HA.group('power');
    var laundry = HA.group('laundry'), guest = HA.group('guest'), y = 150;
    y = haRows(scenes, y, 180, sceneTile);
    y = haRows(lights, y, 180, lightTile);
    var row = [];
    if (power.length) row.push({w: 700, draw: function (x, ty, w, h) { powerTile(x, ty, w, h, power); }});
    if (laundry.length) row.push({w: 520, draw: function (x, ty, w, h) { laundryTile(x, ty, w, h, laundry); }});
    if (guest.length) row.push({w: 476, draw: function (x, ty, w, h) { guestTile(x, ty, w, h, guest); }});
    if (row.length) tileRow(row, y, Math.min(340, 1010 - y));
    if (!scenes.length && !lights.length && !row.length && !problem) {
      var t = tile(112, 150, 1696, 210, 'quiet', null);
      el('div', 'label', t, 'Home Assistant');
      el('div', 'sub', t, tr('Nothing to show yet: pick what to show in the gear → Home Assistant.'));
      ring(t);
    }
    endPane('ha');
  }

  /** Hjem's tile: the power price, and what's on (lights, laundry). */
  function haTile(x, y) {
    var t = tile(x, y, 406, 210, '', function () { goTab('ha'); }), power = HA.group('power')[0], problem = haProblem();
    var l = el('div', 'label', t, 'Home Assistant');
    if (HA.sample()) el('span', 'tag', l, tr('tag|sample'));
    if (power && !isNaN(parseFloat(power.state))) {
      var n = el('div', 'mini', t, decimal(power.state, 2));
      el('small', '', n, haUnit(power));
    } else el('div', 'who', t, tr('Lights, power and laundry'));
    var lit = 0, running = [], i, lights = HA.group('lights'), laundry = HA.group('laundry'), bits = [];
    for (i = 0; i < lights.length; i++) if (lights[i].state === 'on') lit++;
    for (i = 0; i < laundry.length; i++) if (laundry[i].state === 'on') running.push(laundry[i].name);
    if (lights.length) bits.push(plural('plural|one:{n} light on|other:{n} lights on', lit));
    if (running.length) bits.push(trf('{name} running', {name: running.join(', ')}));
    el('div', 'sub one', t, problem || bits.join(' · '));
    ring(t);
  }

  // MARK: - Spotify: what's playing, the controls, to the TV and Spotify's app (spotify.js)

  /** The status line when Spotify isn't answering, or '' when it is. */
  function spotifyProblem() {
    var s = Spotify.status();
    if (s === 'expired') return tr('The Spotify sign-in has run out: run tools/spotify_login.py and install again.');
    if (s === 'auth') return tr("Spotify didn't accept spotify_client_id.");
    if (s === 'offline') return tr("Can't reach Spotify.");
    if (s === 'busy') return tr('Spotify has had too many calls from this app: trying again in a while.');
    return '';
  }

  /** A control's answer, said when it didn't work. */
  function spotifyDone(ok, why) {
    if (ok) return;
    if (why === 'premium') toast(tr('Spotify only lets Premium accounts control the playing.'));
    else if (why === 'device') toast(tr('Nothing is playing on Spotify. Start something, or open Spotify.'));
    else if (why === 'app') toast(trf("Couldn't open {app}.", {app: 'Spotify'}));
    else toast(tr("Spotify didn't answer."));
  }

  function openSpotify() {
    HA.opening({id: Spotify.app, title: 'Spotify'}, null);
    Spotify.openApp(function (ok) { if (!ok) spotifyDone(false, 'app'); });
  }

  function spotifyToTV() {
    Spotify.toTV(function (ok, why) {
      if (ok && why !== 'opened') toast(tr('Playing on the TV.'));
      else spotifyDone(ok, why);
    });
  }

  // The device picker: this TV first (Spotify only lists it while its app is open), then Spotify's other devices.
  // rows: {name, symbol, device (null: this TV), restricted}
  var devRows = [];

  function deviceRows(list) {
    var rows = [{name: tr('This TV'), symbol: 'tv', device: null, restricted: false}];
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (d.tv) continue;
      rows.push({name: d.name, symbol: d.type === 'TV' ? 'tv' : d.type === 'Speaker' ? 'speaker' : 'cast', device: d,
        restricted: d.restricted});
    }
    return rows;
  }

  function renderDevices() {
    var box = $('devpick').firstChild, n = Spotify.now(), playing = n && n.device ? n.device.id : '';
    box.innerHTML = '';
    var title = el('div', 'title', box);
    sym('cast', title);
    title.appendChild(document.createTextNode(tr('Play on')));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    list.style.height = Math.min(devRows.length, 7) * 78 + 'px';
    for (var i = 0; i < devRows.length; i++) {
      var r = devRows[i], row = el('div', r.restricted ? 'row dim' : 'row', holder);
      sym(r.symbol, row);
      row.appendChild(document.createTextNode(r.name));
      if (r.device ? r.device.id === playing : Spotify.onTV()) sym('check', el('span', 'value', row));
      sheetHover(row, Z.DEVICE, i);
    }
    el('div', 'hint', box, devRows.length < 2 ? tr('Open Spotify on a phone or computer to see it here.') :
      tr('OK plays there, Back cancels.'));
    updateFocus();
  }

  function openDevices() {
    st.zone = Z.DEVICE;
    st.device = 0;
    devRows = deviceRows([]);
    renderDevices();
    setClass($('devpick'), 'open', true);
    Spotify.devices(function (list) {
      if (st.zone !== Z.DEVICE) return;
      devRows = deviceRows(list);
      st.device = Math.min(st.device, devRows.length - 1);
      renderDevices();
    });
  }

  /** OK on a device: the playing moves there; on this TV, by opening Spotify's app when it has to. */
  function pickDevice() {
    var r = devRows[st.device];
    if (!r || r.restricted) { if (r) toast(trf("Spotify doesn't let {device} be controlled from here.", {device: r.name})); return; }
    closeSheets();
    if (!r.device) { spotifyToTV(); return; }
    Spotify.playOn(r.device, function (ok, why) {
      if (ok) toast(trf('Playing on {device}.', {device: r.name}));
      else spotifyDone(ok, why);
    });
  }

  /** The cover, or Spotify's green where there's none (the sample). */
  function spotifyArt(n, small) {
    var url = n && (small ? n.thumb || n.picture : n.picture || n.thumb);
    return url ? 'url(' + url + ')' : 'linear-gradient(135deg, #1DB954, #0F7A36)';
  }

  function clock(ms) { return duration(Math.floor(ms / 1000)); }

  /** "On iPhone", or "On the TV". */
  function spotifyWhere(n) {
    if (!n || !n.device) return '';
    return Spotify.onTV() ? tr('On the TV') : trf('On {device}', {device: n.device.name});
  }

  // The volume being changed: {pct, timer}. OK on the volume tile starts it; ← → change it by 5 %, and OK, Back,
  // ↑ or ↓ (or a while without a press) end it.
  var vol = null, spotBar = null, spotTime = null;

  function volumeTile(x, y, w, h, n) {
    var active = !!vol, pct = active ? vol.pct : n.device.volume;
    var t = tile(x, y, w, h, 'sp-ctl' + (active ? ' ha-dim' : ''), startVolume);
    el('div', 'label', t, tr('Volume'));
    el('div', 'ha-name', t, trf('{n}%', {n: pct}));
    var bar = el('div', 'ha-bar', t);
    transform(el('i', '', bar), 'scaleX(' + (pct / 100).toFixed(3) + ')');
    if (active) el('div', 'ha-hint', t, tr('← → volume'));
    ring(t);
  }

  function startVolume() {
    var n = Spotify.now();
    if (!n || !n.device || n.device.volume === null) return;
    vol = {pct: n.device.volume, timer: 0};
    volumeIdle();
    renderSpotify();
    update();
  }

  function endVolume() {
    if (!vol) return;
    clearTimeout(vol.timer);
    vol = null;
    renderSpotify();
    update();
  }

  function volumeIdle() {
    clearTimeout(vol.timer);
    vol.timer = setTimeout(endVolume, DIM_IDLE);
  }

  /** The volume tile being changed has the focus. */
  function volumeFocused() {
    if (!vol || st.zone !== Z.MAIN || nav.tab !== 'spotify' || nav.area !== 'content') return false;
    var t = grid('spotify').tiles[grid('spotify').focus];
    return !!(t && hasClass(t.node, 'ha-dim'));
  }

  function volumeStep(dx) {
    vol.pct = Math.max(0, Math.min(100, Math.round(vol.pct / 5) * 5 + dx * 5));
    volumeIdle();
    Spotify.volume(vol.pct, spotifyDone);
    renderSpotify();
    update();
  }

  /** A button among the controls: its symbol (or Spotify's logo), a word, and what OK does. */
  function controlTile(x, y, w, h, symbol, word, run) {
    var t = tile(x, y, w, h, 'sp-ctl', run);
    if (symbol === 'spotify') el('img', 'sp-logo', el('div', 'sp-sym', t)).src = 'icons/spotify.svg';
    else if (symbol) sym(symbol, el('div', 'sp-sym', t));
    if (word) el('div', 'sp-word', t, word);
    ring(t);
  }

  function renderSpotify() {
    var pane = startPane('spotify'), n = Spotify.now(), problem = spotifyProblem(), g = grid('spotify');
    spotBar = spotTime = null;
    if (Spotify.sample()) note(pane, tr('Sample: add spotify_client_id and run tools/spotify_login.py'));
    else if (problem) note(pane, problem);
    var cover = el('div', 'sp-cover', pane);
    cover.style.backgroundImage = spotifyArt(n);
    var text = el('div', 'sp-text', pane);
    if (n) {
      el('div', 'label', text, spotifyWhere(n));
      el('div', 'sp-title', text, n.title);
      el('div', 'sp-artist', text, [n.artist, n.album].filter(function (x) { return x; }).join(' · '));
      var line = el('div', 'sp-line', text);
      spotBar = el('i', '', el('div', 'progress', line));
      spotTime = el('span', '', line);
      tickSpotify();
    } else {
      el('div', 'label', text, 'Spotify');
      el('div', 'sp-title', text, problem ? 'Spotify' : tr('Nothing playing'));
      el('div', 'sp-artist', text, problem || tr('Start something on your phone, or open Spotify.'));
    }
    var row = [];
    if (n) {
      row.push({w: 1, draw: function (x, y, w, h) { controlTile(x, y, w, h, 'skip_previous', '', function () { Spotify.previous(spotifyDone); }); }});
      row.push({w: 1, draw: function (x, y, w, h) {
        controlTile(x, y, w, h, n.playing ? 'pause' : 'play', '', function () { Spotify.toggle(spotifyDone); });
      }});
      row.push({w: 1, draw: function (x, y, w, h) { controlTile(x, y, w, h, 'skip_next', '', function () { Spotify.next(spotifyDone); }); }});
      if (n.device && n.device.volume !== null) row.push({w: 1.5, draw: function (x, y, w, h) { volumeTile(x, y, w, h, n); }});
    }
    row.push({w: 1.5, draw: function (x, y, w, h) { controlTile(x, y, w, h, 'cast', tr('Play on…'), openDevices); }});
    row.push({w: 1.5, draw: function (x, y, w, h) { controlTile(x, y, w, h, 'spotify', tr('Open Spotify'), openSpotify); }});
    tileRow(row, 760, 180);
    if (!g.seen) { g.seen = true; g.focus = n ? 1 : 0; }   // play or pause first
    endPane('spotify');
  }

  /** The song's place, every second while the tab is in front. */
  function tickSpotify() {
    var n = Spotify.now();
    if (!n || !spotBar) return;
    var p = Spotify.position(), d = n.duration || 1;
    transform(spotBar, 'scaleX(' + Math.min(1, p / d).toFixed(4) + ')');
    spotTime.textContent = clock(p) + ' / ' + clock(n.duration);
  }

  /** Hjem's tile: the cover and what's playing where; OK goes to the tab. */
  function spotifyTile(x, y) {
    var n = Spotify.now(), t = tile(x, y, 406, 210, 'sp-tile', function () { goTab('spotify'); });
    el('div', 'sp-thumb', t).style.backgroundImage = spotifyArt(n, true);
    var text = el('div', 'sp-side', t), l = el('div', 'label', text, 'Spotify');
    if (Spotify.sample()) el('span', 'tag', l, tr('tag|sample'));
    if (n) {
      el('div', 'who', text, n.title);
      el('div', 'sub one', text, n.artist);
      el('div', 'sub one', text, (n.playing ? '' : tr('Paused') + ' · ') + spotifyWhere(n));
    } else {
      el('div', 'who', text, tr('Nothing playing'));
      el('div', 'sub one', text, spotifyProblem());
    }
    ring(t);
  }

  // MARK: - Search: letter keys for the remote (no <input>: Samsung's keyboard covers the screen), Stasera's titles

  var KEY_SIZE = 58, KEY_GAP = 8, MAX_QUERY = 40, DEBOUNCE = 350, PER_ROW = 4;
  var KEYS = [];

  /**
   * QWERTY, eleven keys wide (the three extra letters only in Norwegian): delete fills the third row, the digits and a hyphen the
   * fourth. Built again on each render, since the language can change while the app runs.
   */
  function keyLayout() {
    var rows = I18N.lang === 'nb' ? ['qwertyuiopå', 'asdfghjkløæ', 'zxcvbnm', '1234567890-'] :
      ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890-'];
    var out = [], r, c;
    for (r = 0; r < rows.length; r++) {
      for (c = 0; c < rows[r].length; c++) out.push({ch: rows[r].charAt(c), row: r, col: c, span: 1});
    }
    out.push({sym: 'backspace', run: 'back', row: 2, col: 7, span: 4});
    out.push({sym: 'space_bar', ch: ' ', row: 4, col: 0, span: 7});
    out.push({clear: true, run: 'clear', row: 4, col: 7, span: 4});
    return out;
  }

  // area: the keys or the results; state: idle (query too short), loading, done, error
  var srch = {q: '', area: 'keys', key: 0, result: 0, results: [], state: 'idle', error: '', sample: false, asked: '', seq: 0, timer: 0};
  var srchNodes = {keys: [], results: []};

  function trim(s) { return s.replace(/^\s+|\s+$/g, ''); }

  /** Forgets the query and the results, and empties the pane (unlinked, or the app opened again). */
  function clearSearch() {
    clearTimeout(srch.timer);
    srch = {q: '', area: 'keys', key: 0, result: 0, results: [], state: 'idle', error: '', sample: false, asked: '', seq: srch.seq + 1, timer: 0};
    srchNodes = {keys: [], results: []};
    $('pane-search').innerHTML = '';
  }

  function renderSearch() {
    var pane = $('pane-search');
    pane.innerHTML = '';
    var field = el('div', 's-query', pane);
    el('span', 's-text', field);
    el('i', 's-caret', field);
    var keys = el('div', 's-keys', pane);
    KEYS = keyLayout();
    if (srch.key >= KEYS.length) srch.key = 0;
    srchNodes.keys = [];
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i], node = el('div', 's-key' + (k.span > 1 ? ' wide' : ''), keys);
      node.style.left = (k.col * (KEY_SIZE + KEY_GAP)) + 'px';
      node.style.top = (k.row * (KEY_SIZE + KEY_GAP)) + 'px';
      node.style.width = (k.span * (KEY_SIZE + KEY_GAP) - KEY_GAP) + 'px';
      if (k.sym) sym(k.sym, node);
      else node.textContent = k.clear ? tr('key|Clear') : k.ch;
      hoverSearch(node, 'keys', i);
      srchNodes.keys.push(node);
    }
    el('div', 's-status', pane);
    el('div', 's-track', el('div', 's-results', pane));
    renderResults();
  }

  function statusLabel(status) {
    if (status === 'watching') return tr('Watching');
    if (status === 'watchlist') return tr('Want to Start');
    if (status === 'watched') return tr('status|Watched');
    return '';
  }

  /** A poster, or the title on a plain card when there's none; the library status in a corner. */
  function resultItem(r, node) {
    var c = card('poster', node);
    if (r.posterPath) cardImage(c, image(r.posterPath, 'w342'));
    else el('div', 'ptitle', c, r.title);
    el('div', 'shade', c);
    if (statusLabel(r.status)) el('div', 'status', c, statusLabel(r.status));
    el('div', 'ring', c);
    var sub = [];
    if (r.year) sub.push(String(r.year));
    if (serviceName(r)) sub.push(serviceName(r));
    caption(node, r.title, sub.join(' · '));
  }

  function renderResults() {
    var pane = $('pane-search');
    if (!pane.firstChild) return;
    pane.querySelector('.s-text').textContent = srch.q;
    setClass(pane.querySelector('.s-query'), 'empty', !srch.q);
    if (!srch.q) pane.querySelector('.s-text').textContent = tr('Search shows and movies');
    var status = pane.querySelector('.s-status'), n = srch.results.length;
    if (srch.state === 'idle') status.textContent = plural('plural|one:Type at least {n} letter.|other:Type at least {n} letters.', Stasera.minQuery);
    else if (srch.state === 'loading') status.textContent = tr('Searching…');
    else if (srch.state === 'error') status.textContent = srch.error;
    else if (!n) status.textContent = trf('Nothing found for “{query}”.', {query: srch.asked});
    else status.textContent = plural('plural|one:{n} result|other:{n} results', n);
    if (srch.sample && n && srch.state === 'done') el('span', 'tag', status, tr('tag|sample'));
    var track = pane.querySelector('.s-track');
    track.innerHTML = '';
    srchNodes.results = [];
    for (var i = 0; i < n; i++) {
      var node = el('div', 'item', track);
      resultItem(srch.results[i], node);
      hoverSearch(node, 'results', i);
      srchNodes.results.push(node);
    }
    srch.result = Math.max(0, Math.min(srch.result, n - 1));
    if (!n) srch.area = 'keys';
    update();
  }

  function updateSearch() {
    var on = st.zone === Z.MAIN && nav.tab === 'search' && nav.area === 'content', i;
    for (i = 0; i < srchNodes.keys.length; i++) setClass(srchNodes.keys[i], 'focus', on && srch.area === 'keys' && i === srch.key);
    for (i = 0; i < srchNodes.results.length; i++) setClass(srchNodes.results[i], 'focus', on && srch.area === 'results' && i === srch.result);
    var field = $('pane-search').querySelector('.s-query');
    if (field) setClass(field, 'typing', on && srch.area === 'keys');
    // The focused row on top once it's past the first, so the row under it shows.
    var list = srchNodes.results, track = $('pane-search').querySelector('.s-track'), y = 0;
    if (list[srch.result] && srch.area === 'results') y = list[Math.max(0, Math.floor(srch.result / PER_ROW) - 1) * PER_ROW].offsetTop - list[0].offsetTop;
    if (track) transform(track, 'translateY(' + (-y) + 'px)');
  }

  /** The query changed: ask Stasera after a pause in the typing, and only the newest answer counts. */
  function queryChanged() {
    clearTimeout(srch.timer);
    var q = trim(srch.q);
    if (q.length < Stasera.minQuery) {
      srch.seq++;
      srch.results = [];
      srch.state = 'idle';
      srch.asked = '';
      renderResults();
      return;
    }
    if (q === srch.asked && srch.state === 'done') { renderResults(); return; }
    srch.seq++;
    srch.state = 'loading';
    renderResults();
    srch.timer = setTimeout(function () {
      var mine = ++srch.seq;
      Stasera.search(q, function (err, results, sample) {
        if (mine !== srch.seq) return;   // an older query's answer
        if (err && err.message === 'unlinked') return;   // Stasera.onChange takes the tab away
        srch.asked = q;
        srch.state = err ? 'error' : 'done';
        srch.error = err ? (err.message === 'busy' ? tr('Stasera is busy. Try again in a minute.') : tr("Couldn't reach Stasera.")) : '';
        srch.results = err ? [] : results;
        srch.sample = !!sample;
        srch.result = 0;
        renderResults();
      });
    }, DEBOUNCE);
  }

  function pressKey(k) {
    if (k.run === 'back') srch.q = srch.q.slice(0, -1);
    else if (k.run === 'clear') srch.q = '';
    else if (srch.q.length < MAX_QUERY && !(k.ch === ' ' && (!srch.q || srch.q.slice(-1) === ' '))) srch.q += k.ch;
    queryChanged();
  }

  function searchFocused() {
    if (srch.area === 'results') {
      var r = srch.results[srch.result];
      // Back on the title page comes here, on the same result; the card follows what was changed there.
      return r ? {run: function () { openTitle(r, function (t) { r.status = t.status; renderResults(); }); },
        node: srchNodes.results[srch.result].firstChild} : null;
    }
    var k = KEYS[srch.key];
    return k ? {run: function () { pressKey(k); }, node: srchNodes.keys[srch.key]} : null;
  }

  /** The way the arrow points among the keys or the results; → off the keys goes to the results, ← back. */
  function searchMove(dx, dy) {
    var dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
    var mine = srch.area === 'keys' ? srchNodes.keys : srchNodes.results, at = srch.area === 'keys' ? srch.key : srch.result;
    var n = mine.length ? spatialMove(mine, at, dir) : -1;
    if (n >= 0) {
      if (srch.area === 'keys') srch.key = n;
      else srch.result = n;
    } else if (dir === 'up') {
      focusTabs();
      return;
    } else if (dir === 'right' && srch.area === 'keys' && srchNodes.results.length) {
      // The result nearest to the key, in the rows on screen.
      n = spatialMove([mine[at]].concat(srchNodes.results), 0, 'right');
      if (n > 0) { srch.area = 'results'; srch.result = n - 1; }
    } else if (dir === 'left' && srch.area === 'results') {
      n = spatialMove([mine[at]].concat(srchNodes.keys), 0, 'left');
      srch.area = 'keys';
      if (n > 0) srch.key = n - 1;
    }
    update();
  }

  function hoverSearch(node, area, i) {
    node.onmouseover = function () {
      if (!pointerOk() || nav.tab !== 'search') return;
      nav.area = 'content';
      srch.area = area;
      if (area === 'keys') srch.key = i;
      else srch.result = i;
      update();
    };
    node.onclick = function () { node.onmouseover(); activate(); };
  }

  // MARK: - A title's page: its picture, what it is and where to watch it, the cast and the seasons; and a person's

  // A title's page: item is what it was opened with (a search result or a card), then Stasera's /tv/title over it.
  // changed(title): the library status changed here. A person's page: who, then /tv/person. Each page has rows of
  // things to focus (row 0 of a title is its buttons); OK on someone in the cast opens their page, OK on a title there
  // opens its page, and Back goes one page back, then to where the first was opened.
  var page = null, pages = [];

  function kindOf(item) { return item.kind || (item.type === 'movie' ? 'movie' : 'show'); }

  /** a with b's values over it (b's nulls don't hide what a knows). */
  function merged(a, b) {
    var out = {}, k;
    for (k in a) if (a.hasOwnProperty(k)) out[k] = a[k];
    for (k in b) if (b.hasOwnProperty(k) && b[k] !== null && b[k] !== undefined) out[k] = b[k];
    out.kind = kindOf(out);
    return out;
  }

  function titleError(err) {
    var m = err ? err.message : '';
    if (m === 'old') return tr('Update Stasera to see more about this title here.');
    if (m === 'notfound') return tr("Stasera doesn't know this title.");
    if (m === 'busy') return tr('Stasera is busy. Try again in a minute.');
    return tr("Couldn't reach Stasera.");
  }

  function newPage(kind, fields) {
    var p = {kind: kind, rows: [], row: 0, idx: [], loading: true, note: '', old: false, busy: false, changed: null};
    for (var k in fields) if (fields.hasOwnProperty(k)) p[k] = fields[k];
    return p;
  }

  /** Shows p over what's open (a page goes under it, for Back). */
  function showPage(p) {
    if (st.zone === Z.TITLE && page) pages.push(page);
    page = p;
    st.zone = Z.TITLE;
    renderPage();
    setClass($('title'), 'open', true);
  }

  /** Opens a title's page; what the item has is drawn at once, the rest when Stasera answers. */
  function openTitle(item, changed) {
    var p = newPage('title', {item: merged(item, {}), changed: changed || null});
    showPage(p);
    Stasera.title(p.item.kind, p.item.tmdbId, function (err, t) {
      p.loading = false;
      if (t) p.item = merged(p.item, t);
      else p.note = titleError(err);
      p.old = !!err && err.message === 'old';
      if (p === page) renderPage();
    });
  }

  function openPerson(who) {
    var p = newPage('person', {person: {personId: who.personId, name: who.name, profilePath: who.profilePath, credits: []}});
    showPage(p);
    Stasera.person(who.personId, function (err, found) {
      p.loading = false;
      if (found) p.person = found;
      else p.note = err && err.message === 'old' ? tr('Update Stasera to see more about this person here.') : titleError(err);
      if (p === page) renderPage();
    });
  }

  /** Back: the page under this one, else what it was opened from. */
  function closePage() {
    if (pages.length) {
      page = pages.pop();
      renderPage();
      return;
    }
    closeTitle();
  }

  /** Closes every page. */
  function closeTitle() {
    page = null;
    pages = [];
    setClass($('title'), 'open', false);
    if (st.zone === Z.TITLE) st.zone = Z.MAIN;
  }

  function addToWant() {
    var p = page;
    if (p.busy) return;
    p.busy = true;
    var it = p.item;
    Stasera.want(it.kind, it.tmdbId, function (err, t) {
      p.busy = false;
      if (!t) { toast(titleError(err)); return; }
      p.item = merged(p.item, t);
      p.idx[0] = 0;
      if (p.changed) p.changed(p.item);
      toast(trf('Added to Want to Start: {title}', {title: it.title}));
      if (p === page) renderPage();
    });
  }

  /** The page's button: a movie or the next episode, marked watched. */
  function markTitle() {
    var it = page.item, next = nextOf(it);
    if (kindOf(it) === 'movie') markItem(it, it.status || null);
    else if (next) markItem(merged(it, {episodeTmdbId: next.episodeTmdbId, seasonNumber: next.seasonNumber, episodeNumber: next.episodeNumber}), null);
  }

  /** "Watched ✓" only takes back what was marked while the page was open: an older mark would lose its date. */
  function pressWatched() {
    if (page.marked) unmark(page.item, page.marked.previous);
    else toast(tr('Change it on stasera.app'));
  }

  function playTrailer(it) {
    var app = appByKey('youtube');
    if (!app) { toast(tr("There's no YouTube app on this TV.")); return; }
    HA.opening(app, {title: it.title, kind: 'trailer'});
    TV.deepLink(app.id, 'youtube', {videoId: it.trailerKey}, function (ok) {
      if (!ok) toast(trf("Couldn't open {app}.", {app: app.title}));
    });
  }

  /** Year, seasons or runtime, and where it is in the library. */
  function titleMeta(it) {
    var m = [];
    if (it.year) m.push(String(it.year));
    if (it.kind === 'show' && it.seasons > 0) m.push(plural('plural|one:{n} season|other:{n} seasons', it.seasons));
    if (it.kind === 'movie' && it.runtime) m.push(runtime(it.runtime));
    if (statusLabel(it.status)) m.push(statusLabel(it.status));
    return m;
  }

  /** Who made it: the creators of a show, the directors of a movie. */
  function makersText(it) {
    var c = it.creators || [], d = it.directors || [];
    if (c.length) return trf('Created by {names}', {names: c.join(', ')});
    if (d.length) return trf('Directed by {names}', {names: d.join(', ')});
    return '';
  }

  /** The services it streams on (else the channels that air it), the one on this TV first. */
  function whereText(it, app) {
    var names = (it.providers && it.providers.length ? it.providers : it.networks) || [], own = serviceName(it);
    if (!names.length) return '';
    var out = own ? [own] : [];
    for (var i = 0; i < names.length && out.length < 4; i++) if (names[i] !== own) out.push(names[i]);
    return (app ? '' : trf("{title} isn't on any app on this TV.", {title: it.title}) + ' ') +
        trf('Streams on {services}', {services: out.join(', ')});
  }

  /** The next episode of a show we watch, shown first so OK, OK still starts it. */
  function nextOf(it) {
    var n = it.nextEpisode;
    return n && it.status === 'watching' ? n : null;
  }

  function renderPage() {
    var box = $('title');
    box.innerHTML = '';
    setClass(box, 'person', page.kind === 'person');
    setClass(box, 'down', false);
    page.rows = [];
    if (page.kind === 'person') renderPerson(box);
    else renderTitle(box);
    for (var r = 0; r < page.rows.length; r++) {
      page.idx[r] = Math.max(0, Math.min(page.idx[r] || 0, page.rows[r].items.length - 1));
    }
    // A row that went (Stasera answered without it) can't keep the focus.
    if (page.row >= page.rows.length || !page.rows[page.row].items.length) page.row = firstRow();
    updateFocus();
  }

  function firstRow() {
    for (var r = 0; r < page.rows.length; r++) if (page.rows[r].items.length) return r;
    return 0;
  }

  /** A row of cards under a title or a person: {node, items, track, step}. */
  function pageLane(parent, heading, step) {
    var lane = el('div', 'lane', parent);
    el('h2', '', lane, heading);
    var row = {node: lane, track: el('div', 'track', lane), items: [], step: step};
    page.rows.push(row);
    return row;
  }

  function laneItem(row, run) {
    var node = el('div', 'item', row.track), r = page.rows.length - 1, i = row.items.length;
    row.items.push({node: node, run: run});
    hoverPage(node, r, i);
    return node;
  }

  /** A poster, or the title on the card when there's none. */
  function posterCard(node, path, title) {
    var c = card('poster', node);
    cardImage(c, path ? image(path, 'w342') : '');
    if (!path) el('div', 'ptitle', c, title);
    el('div', 'shade', c);
    el('div', 'ring', c);
  }

  function renderTitle(box) {
    var it = page.item, app = appOf(it), next = nextOf(it), i;
    var path = wide(it, !!it.logoPath);
    if (path) el('div', 'art', box).style.backgroundImage = 'url(' + image(path, 'w1280') + ')';
    else if (it.posterPath) el('div', 'bigposter', box).style.backgroundImage = 'url(' + image(it.posterPath, 'w500') + ')';
    el('div', 'shade', box);
    el('div', 'dim', box);
    var scroll = el('div', 'scroll', box), top = el('div', 'top', scroll), c = el('div', 'content', top);
    var k = el('div', 'kicker', c, it.kind === 'movie' ? tr('Movie') : tr('Series'));
    if (it.genres && it.genres.length) { el('span', 'sep', k, '·'); el('span', 'dim', k, it.genres.join(', ')); }
    if (it.logoPath) {
      var img = el('img', 'logo', c);
      img.onerror = function () { c.replaceChild(titleText(it.title), img); };
      img.src = image(it.logoPath, 'w500');
    } else {
      c.appendChild(titleText(it.title));
    }
    var meta = el('div', 'meta', c), m = titleMeta(it);
    if (it.certification) el('span', 'rating', meta, it.certification);
    for (i = 0; i < m.length; i++) {
      if (i) el('span', 'sep', meta, '·');
      meta.appendChild(document.createTextNode(m[i]));
    }
    var makers = makersText(it);
    if (makers) el('div', 'makers', c, makers);
    if (next) {
      var e = el('div', 'episode', c, ep(next));
      if (next.name) { el('span', 'sep', e, '·'); e.appendChild(document.createTextNode(next.name)); }
    }
    var about = next && next.overview ? next.overview : it.overview;
    if (about) el('div', 'overview', c, about);
    var where = whereText(it, app);
    if (where) el('div', 'where', c, where);
    // An older Stasera gives search results without services for titles nobody has opened: unknown isn't missing.
    else if (!app && !page.loading && !page.old) {
      el('div', 'where', c, trf("{title} isn't on any app on this TV.", {title: it.title}));
    }

    var buttons = {items: [], node: el('div', 'actions', c)};
    page.rows.push(buttons);
    function button(label, run, play) {
      var b = el('span', 'btn', buttons.node);
      if (play) el('span', 'play', b);
      b.appendChild(document.createTextNode(label));
      buttons.items.push({node: b, run: run});
      hoverPage(b, 0, buttons.items.length - 1);
    }
    if (app) button(trf('Watch on {app}', {app: app.title}), function () { launchItem(it); }, true);
    if (!page.loading && !page.note) {
      if (kindOf(it) !== 'movie') {
        if (next && next.released !== false) button(trf('Mark {episode} as Watched', {episode: ep(next)}), markTitle);
      } else if (it.status === 'watched') {
        button(tr('status|Watched') + ' ✓', pressWatched);
      } else if (!it.releaseDate || it.releaseDate <= isoDay(Date.now())) {
        button(tr('Mark as Watched'), markTitle);
      }
    }
    if (it.trailerKey) button(tr('Trailer'), function () { playTrailer(it); });
    // Only what isn't in the library yet, and only once /tv/title has answered (a Stasera with /tv/want too).
    if (!it.status && !page.loading && !page.note) button(tr('Add to Want to Start'), addToWant);
    if (page.loading) el('div', 'note', c, tr('Asking Stasera…'));
    else if (page.note) el('div', 'note', c, page.note);

    var more = el('div', 'more', scroll), seasons = it.seasonList || [], cast = it.cast || [];
    if (seasons.length) {
      var srow = pageLane(more, tr('Seasons'), 240);
      for (i = 0; i < seasons.length; i++) {
        var s = seasons[i], sn = laneItem(srow, null);
        posterCard(sn, s.posterPath, s.name);
        var sub = plural('plural|one:{n} episode|other:{n} episodes', s.episodeCount);
        caption(sn, s.name, s.year ? sub + ' · ' + s.year : sub);
      }
    }
    if (cast.length) {
      var crow = pageLane(more, tr('Cast'), 224);
      for (i = 0; i < cast.length; i++) castItem(crow, cast[i]);
    }
  }

  function castItem(row, who) {
    var node = laneItem(row, function () { openPerson(who); }), c = card('face', node);
    if (who.profilePath) cardImage(c, image(who.profilePath, 'w185'));
    else el('div', 'initials', c, initials(who.name));
    el('div', 'ring', c);
    caption(node, who.name, who.character);
  }

  /** "Acting" and the rest of TMDB's departments, as the kicker over a name. */
  function departmentLabel(d) {
    if (d === 'Acting') return tr('Actor');
    if (d === 'Directing') return tr('Director');
    if (d === 'Writing') return tr('Writer');
    if (d === 'Production') return tr('Producer');
    return tr('Person');
  }

  /** A yyyy-mm-dd as the TV's date, or ''. */
  function dayText(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day || '');
    return m ? formatDate('format|MMMM d, yyyy', new Date(+m[1], m[2] - 1, +m[3]).getTime()) : '';
  }

  function renderPerson(box) {
    var p = page.person, i;
    var photo = el('div', 'photo', box);
    if (p.profilePath) photo.style.backgroundImage = 'url(' + image(p.profilePath, 'h632') + ')';
    else el('div', 'initials', photo, initials(p.name));
    var c = el('div', 'content', box);
    el('div', 'kicker', c, departmentLabel(p.knownForDepartment));
    c.appendChild(titleText(p.name));
    var facts = [], born = dayText(p.birthday), died = dayText(p.deathday);
    if (born) facts.push(p.placeOfBirth ? trf('Born {date} in {place}', {date: born, place: p.placeOfBirth}) : trf('Born {date}', {date: born}));
    if (died) facts.push(trf('Died {date}', {date: died}));
    if (facts.length) el('div', 'meta', c, facts.join(' · '));
    if (p.biography) el('div', 'overview', c, p.biography);
    if (page.loading) el('div', 'note', c, tr('Asking Stasera…'));
    else if (page.note) el('div', 'note', c, page.note);

    var credits = p.credits || [];
    if (!credits.length) return;
    var row = pageLane(el('div', 'more', box), tr('Known For'), 240);
    for (i = 0; i < credits.length; i++) creditItem(row, credits[i]);
  }

  function creditItem(row, t) {
    var node = laneItem(row, function () { openTitle(t); });
    posterCard(node, t.posterPath || t.backdropPath, t.title);
    var sub = t.character || (t.jobs && t.jobs.length ? t.jobs.join(', ') : '');
    caption(node, t.title, t.year ? (sub ? sub + ' · ' : '') + t.year : sub);
  }

  /** The focus on the page: a lit button or card, its row slid sideways, the page scrolled down to it. */
  function pageFocus() {
    if (!page) return;
    var on = st.zone === Z.TITLE, r, i;
    for (r = 0; r < page.rows.length; r++) {
      var row = page.rows[r];
      for (i = 0; i < row.items.length; i++) setClass(row.items[i].node, 'focus', on && page.row === r && page.idx[r] === i);
      if (row.track) {
        var fit = Math.floor((1920 - 224) / row.step), first = Math.max(0, Math.min(row.items.length - fit, page.idx[r] - 2));
        transform(row.track, 'translateX(' + (-first * row.step) + 'px)');
      }
    }
    var scroll = $('title').querySelector('.scroll');
    if (!scroll) return;
    var lane = page.row > 0 && page.rows[page.row] ? page.rows[page.row].node : null;
    setClass($('title'), 'down', !!lane);
    transform(scroll, 'translateY(' + (lane ? -Math.max(0, lane.offsetTop - 300) : 0) + 'px)');
  }

  function hoverPage(node, r, i) {
    node.onmouseover = function () {
      if (saverOn || st.zone !== Z.TITLE) return;
      page.row = r;
      page.idx[r] = i;
      updateFocus();
    };
    node.onclick = function () { node.onmouseover(); activate(); };
  }

  function pageMove(dx, dy) {
    if (dx) {
      var row = page.rows[page.row];
      if (row) page.idx[page.row] = Math.max(0, Math.min(row.items.length - 1, page.idx[page.row] + dx));
    } else if (dy) {
      for (var r = page.row + dy; r >= 0 && r < page.rows.length; r += dy) {
        if (page.rows[r].items.length) { page.row = r; break; }
      }
    }
    updateFocus();
  }

  function pageActivate() {
    var row = page.rows[page.row], it = row && row.items[page.idx[page.row]];
    if (it && it.run) it.run();
  }

  function renderPanes() {
    if (Stasera.linked()) { renderStasera(); renderSearch(); }
    if (GitHub.enabled()) renderGitHub();
    if (HA.enabled()) renderHA();
    if (Spotify.enabled()) renderSpotify();
  }

  // MARK: - Pointer: it focuses what it's over (the Magic Remote, or a mouse when previewing)

  function pointerOk() { return !saverOn && st.zone === Z.MAIN; }

  function hoverBar(node, i) {
    node.onmouseover = function () {
      if (!pointerOk()) return;
      nav.area = 'tabs';
      focusBar(i);
    };
    node.onclick = function () { node.onmouseover(); activate(); };
  }

  function hoverTile(node, name, i) {
    node.onmouseover = function () {
      if (!pointerOk() || nav.tab !== name) return;
      nav.area = 'content';
      grid(name).focus = i;
      update();
    };
    node.onclick = function () { node.onmouseover(); activate(); };
  }

  function hoverItem(node, lane, i) {
    node.onmouseover = function () {
      if (!pointerOk() || !cinema()) return;
      if (nav.area === 'content' && tvf.area === 'rows' && tvf.row === lane && tvf.idx[LANES[lane].id] === i) return;
      nav.area = 'content';
      tvf.area = 'rows';
      tvf.row = lane;
      tvf.idx[LANES[lane].id] = i;
      update();
    };
    node.onclick = function () { node.onmouseover(); activate(); };
  }


  // MARK: - All Apps

  /** All Apps: the app library first, then the rest. */
  var sheetApps = [];

  function renderApps() {
    var sheet = $('apps');
    sheet.firstChild.textContent = tr('All Apps');
    var grid = sheet.lastChild;
    grid.innerHTML = '';
    sheetApps = shelf.concat(others);
    for (var i = 0; i < sheetApps.length; i++) {
      var r = Math.floor(i / 5), c = i % 5, cell = el('div', 'cell', grid);
      cell.style.left = (130 + c * 340) + 'px';
      cell.style.top = (196 + r * 239) + 'px';
      face(sheetApps[i], el('div', 'face', cell), wordFit(sheetApps[i].title, 300, 34));
      el('div', 'label', cell, sheetApps[i].title);
      sheetHover(cell, Z.APPS, i);
    }
  }

  /** From Home Settings: Back comes back there, on the All Apps row. */
  function openApps() {
    setClass($('settings'), 'open', false);
    renderApps();
    st.zone = Z.APPS;
    st.grid = 0;
    setClass($('apps'), 'open', true);
    updateFocus();
  }

  function closeSheets() {
    setClass($('apps'), 'open', false);
    setClass($('settings'), 'open', false);
    setClass($('shelfedit'), 'open', false);
    setClass($('langpick'), 'open', false);
    setClass($('devpick'), 'open', false);
    setClass($('typer'), 'open', false);
    typ = null;
    if (hasClass($('link'), 'open')) { setClass($('link'), 'open', false); Stasera.cancel(); YouTube.cancel(); }
    closeTitle();
    langHint = null;
    st.zone = Z.MAIN;
    updateFocus();
    settingsClosed();
  }

  // MARK: - Home Settings: the main list and its pages, in one sheet (Back goes up a page)

  var spage = {name: 'main'}, pageStack = [], reloadOnClose = false;

  /** A change the modules only read when the app starts: the app reloads when Home Settings closes. */
  function needsReload() { reloadOnClose = true; }

  function openPage(name, arg) {
    pageStack.push({spage: spage, row: st.row});
    spage = {name: name, arg: arg};
    st.row = 0;
    renderSettings();
  }

  /** Back on a page: up one; on the main list: false (the sheet closes). */
  function pageBack() {
    if (!pageStack.length) return false;
    var p = pageStack.pop();
    spage = p.spage;
    st.row = p.row;
    renderSettings();
    return true;
  }

  /** On a sheet that closes: reload when something needs it. */
  function settingsClosed() {
    spage = {name: 'main'};
    pageStack = [];
    if (!reloadOnClose) return;
    reloadOnClose = false;
    toast(tr('Restarting with the new settings…'));
    setTimeout(function () { location.reload(); }, 400);
  }

  function settingRows() {
    var fn = PAGES[spage.name] || PAGES.main;
    return fn(spage.arg);
  }

  var PAGES = {};

  PAGES.main = function () {
    var unit = Prefs.temperature();
    var auto = tr('Automatic'), picked = pickedLanguage();
    return [
      {label: tr('Language'), value: picked === 'auto' ? auto : I18N.languageName(picked), opens: true, language: true,
        step: function (d) { if (d >= 0) openLanguages(); }},
      {label: tr('Temperature'), value: unit === 'C' ? '°C' : unit === 'F' ? '°F' : tr('unit|Automatic'),
        step: function (d) { cycle('temperature', ['auto', 'C', 'F'], unit, d); renderHome(); }},
      pageRow(tr('Place'), placeName(), 'place'),
      pageRow(tr('Screensaver and Art Mode'), saverValue(), 'saver'),
      pageRow(tr('Apps'), '', 'apps'),
      pageRow(tr('Connections'), '', 'connections'),
      {label: tr('TV Settings'), value: '›', step: function (d) { if (d >= 0) tvSettings(); }}
    ].concat(CONFIG.setupUrl && CONFIG.setupKey ?
      [{label: tr('Upload config'), value: '›', step: function (d) { if (d >= 0) uploadConfig(); }}] : []);
  };

  /**
   * What's set on the TV, and its sign-ins, to the setup page on the Mac that built the app (AUG-1521), which writes
   * it into config.properties when accepted there. Only what the TV changed: the rest is in the file already.
   */
  function uploadConfig() {
    var out = {};
    Settings.keys().forEach(function (k) { if (Settings.changed(k)) out[k] = Settings.get(k); });
    var tokens = {youtubeRefreshToken: YouTube.token(), staseraToken: Stasera.token(),
      spotifyRefreshToken: Spotify.token()};
    for (var k in tokens) if (tokens[k] && tokens[k] !== Settings.get(k)) out[k] = tokens[k];
    toast(tr('Uploading config…'), 30000);
    var x = new XMLHttpRequest(), over = false;
    function done(status) {
      if (over) return;
      over = true;
      toast(status === 200 ? tr('Sent. Accept it on the setup page.') :
        status === 403 ? tr("The setup page didn't accept this TV: install the app from it again.") :
        tr("Couldn't reach the setup page. Is it running?"));
    }
    x.open('POST', CONFIG.setupUrl + '/api/from-tv', true);
    x.timeout = 15000;
    x.setRequestHeader('Content-Type', 'text/plain');   // a simple request: no preflight
    x.onreadystatechange = function () { if (x.readyState === 4) done(x.status); };
    x.ontimeout = x.onerror = function () { done(0); };
    x.send(JSON.stringify({key: CONFIG.setupKey, settings: out}));
  }

  /** A row that opens a spage: OK or →. */
  function pageRow(label, value, name, arg) {
    return {label: label, value: value === '' ? '›' : String(value), opens: value !== '',
      step: function (d) { if (d >= 0) openPage(name, arg); }};
  }

  function placeName() {
    return Settings.get('latitude') === '' ? trf('Automatic ({c})', {c: Place.city || '—'}) : Place.city || '—';
  }


  PAGES.apps = function () {
    return [
      {label: tr('All Apps'), value: '›', allApps: true, step: function (d) { if (d >= 0) openApps(); }},
      {label: tr('Shelf'), value: '›', shelf: true, step: function (d) { if (d >= 0) openShelfEdit(); }},
      pageRow(tr('Hidden apps'), allApps.filter(hidden).length || tr('None'), 'hidden')
    ];
  };

  function saverValue() {
    var mins = Prefs.saverMinutes();
    return Art.enabled() && !Art.saverAllowed() ? tr('Off in Home Assistant') : mins ? trf('{m}m', {m: mins}) : tr('Off');
  }

  /** The screensaver works without Art Mode too (its own pictures), so it isn't under Connections. */
  PAGES.saver = function () {
    var mins = Prefs.saverMinutes(), every = Prefs.saverEvery();
    var rows = [
      {label: tr('Screensaver'), value: saverValue(), step: function (d) { cycle('saverMinutes', [0, 5, 10, 15, 30, 60], mins, d); }},
      {label: tr('New screensaver picture every'), value: trf('{m}m', {m: every}),
        step: function (d) { cycle('saverEvery', [1, 2, 5, 10, 15, 30, 60], every, d); }}
    ];
    if (Art.enabled()) {
      rows.push({label: tr('Art Mode now'), value: '›', step: function (d) { if (d >= 0) artDo(Art.artMode, tr('Art Mode…')); }});
      rows.push({label: tr('New picture in Art Mode'), value: '›',
        step: function (d) { if (d >= 0) artDo(Art.next, tr('A new picture…')); }});
    }
    rows.push(pageRow(tr('Connection'), '', 'service', 'art'));
    return rows;
  };

  PAGES.hidden = function () {
    var rows = [];
    var list = allApps.slice().sort(function (a, b) { return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1; });
    list.forEach(function (app) {
      var on = hidden(app);
      rows.push({label: app.title, toggle: on, step: function () {
        var keep = Settings.get('hideApps');
        if (on) {
          var drop = hiders(app);
          keep = keep.filter(function (s) { return drop.indexOf(s) < 0; });
        } else keep = keep.concat([app.id]);
        Settings.set('hideApps', keep);
        loadApps(function () { renderAll(); });
      }});
    });
    return rows;
  };

  PAGES.place = function () {
    var auto = Settings.get('latitude') === '';
    var rows = [{label: tr('Automatic'), value: trf('From the time zone: {c}', {c: zoneCity() || '—'}), check: auto,
      step: function () {
        ['latitude', 'longitude', 'city'].forEach(function (k) { Settings.set(k, ''); });
        needsReload();
      }}];
    if (CONFIG.latitude) {
      rows.push({label: CONFIG.city || CONFIG.latitude + ', ' + CONFIG.longitude, value: tr('From the config'),
        check: !auto && !Settings.changed('latitude'), step: function () {
          ['latitude', 'longitude', 'city'].forEach(function (k) { Settings.reset(k); });
          needsReload();
        }});
    }
    if (!auto && Settings.changed('latitude')) {
      rows.push({label: Settings.get('city') || Settings.get('latitude') + ', ' + Settings.get('longitude'), value: tr('Set on the TV'),
        check: true, step: function () {}});
    }
    rows.push({label: tr('Find a city…'), value: '›', step: function (d) {
      if (d < 0) return;
      openTyping(tr('Find a city'), '', tr('A city or a town, then Done.'), function (text, finish) {
        if (text.length < 2) { finish(plural('plural|one:Type at least {n} letter.|other:Type at least {n} letters.', 2)); return; }
        findCities(text, function (list) {
          if (!list) finish(tr("Couldn't reach Open-Meteo."));
          else if (!list.length) finish(trf('Nothing found for “{query}”.', {query: text}));
          else { finish(''); openPage('cities', list); }
        });
      });
    }});
    return rows;
  };

  /** The places Open-Meteo found; OK takes one, and goes back to Place. */
  PAGES.cities = function (list) {
    return list.map(function (c) {
      return {label: c.name, value: c.where, check: false, step: function () {
        Settings.set('latitude', c.lat);
        Settings.set('longitude', c.lon);
        Settings.set('city', c.name);
        needsReload();
        pageBack();
      }};
    });
  };

  function zoneCity() {
    var v = (window.ZONES || {})[TV.zone()], hops = 0, name = TV.zone();
    while (v && v.charAt(0) === '=' && hops++ < 3) { name = v.slice(1); v = window.ZONES[name]; }
    return v ? v.split(',')[3] || name.slice(name.lastIndexOf('/') + 1).replace(/_/g, ' ') : '';
  }

  /** The services under Connections: their switch (a key in Settings) and settings, the first `needs` of them required. */
  function services() {
    var address = tr('Address'), token = tr('Token'), id = tr('Client ID');
    return [
      {key: 'stasera', name: 'Stasera', needs: 1, settings: [['staseraUrl', address], ['staseraName', tr("The TV's name")]]},
      {key: 'youtube', name: 'YouTube', needs: 2, settings: [['youtubeClientId', id], ['youtubeClientSecret', tr('Client secret')]]},
      {key: 'github', name: 'GitHub', needs: 1, settings: [['githubToken', token], ['githubHide', tr('Hidden repos')]]},
      {key: 'vercel', name: 'Vercel', needs: 1, settings: [['vercelToken', token], ['vercelTeam', tr('Team')]]},
      {key: 'homeAssistant', name: 'Home Assistant', needs: 2, settings: [['homeAssistantUrl', address], ['homeAssistantToken', token]]},
      {key: 'spotify', name: 'Spotify', needs: 2, settings: [['spotifyClientId', id], ['spotifyRefreshToken', token]]},
      {key: 'art', name: tr('Art Mode'), needs: 1, settings: [['artUrl', address], ['artKey', tr('Key')]]}
    ];
  }

  function service(key) {
    var list = services();
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
  }

  /** What a service lacks before it can be turned on, as "Missing client ID". */
  function missing(s) {
    var lacks = [];
    for (var i = 0; i < s.needs; i++) if (!Settings.get(s.settings[i][0])) lacks.push(s.settings[i][1]);
    return trf('Missing {what}', {what: lacks.join(', ')});
  }

  /** On or off, and for Stasera and YouTube whether the TV is linked; until a reload that is what's running now. */
  function serviceValue(s) {
    if (Settings.get(s.key) !== true) return Modules.ready(s.key) ? tr('Off') : tr('Not set up');
    if (!Modules.ready(s.key)) return tr('On') + ' · ' + missing(s);
    if (s.key === 'stasera' && Stasera.enabled()) return tr('On') + ' · ' + (Stasera.linked() ? tr('Linked') : tr('Not linked'));
    if (s.key === 'youtube' && YouTube.ready()) return tr('On') + ' · ' + (YouTube.linked() ? tr('Signed in') : tr('Not signed in'));
    return tr('On');
  }

  PAGES.connections = function () {
    return services().map(function (s) { return pageRow(s.name, serviceValue(s), 'service', s.key); });
  };

  /** A service: its switch first (grey with what it lacks until it has it), then signing in and its settings. */
  PAGES.service = function (key) {
    var s = service(key), on = Settings.get(key) === true, rows = [];
    if (!on && !Modules.ready(key)) rows.push({label: s.name, value: missing(s), dim: true, step: function () {}});
    else {
      rows.push({label: s.name, toggle: on, step: function () {
        Settings.set(key, !on);
        needsReload();
      }});
    }
    if (key === 'stasera' && Stasera.enabled()) {
      rows.push({label: tr('Link'), value: Stasera.linked() ? tr('Linked') : tr('Link'), opens: true, link: true,
        step: function (d) { if (d >= 0) openLink('stasera'); }});
    }
    if (key === 'youtube' && YouTube.ready()) {
      rows.push({label: tr('Sign in'), value: YouTube.linked() ? tr('Signed in') : tr('Sign in'), opens: true, link: true,
        step: function (d) { if (d >= 0) openLink('youtube'); }});
      var lists = YouTube.playlists(), list = YouTube.playlist();
      if (lists.length) {
        rows.push({label: tr('Playlist'), value: list ? list.title : tr('None'), step: function (d) {
          var i = -1;
          for (var j = 0; j < lists.length; j++) if (list && lists[j].id === list.id) i = j;
          YouTube.choose(lists[(i + (d || 1) + lists.length) % lists.length].id);
          renderHome();
        }});
      }
    }
    s.settings.forEach(function (c) { rows.push(pageRow(c[1], shown(c[0]), 'value', [c[0], c[1], s.name])); });
    if (key === 'homeAssistant' && HA.enabled()) rows = rows.concat(haGroupRows());
    return rows;
  };

  function secret(key) { return /Token$|Secret$|Key$/.test(key); }

  /** A setting as the panel shows it: a secret as its last four, a list as a count, a long value cut. */
  function shown(key) {
    var v = Settings.get(key);
    if (v instanceof Array) return v.length ? v.join(', ') : tr('None');
    v = String(v || '');
    if (!v) return tr('None');
    if (secret(key)) return '••••' + v.slice(-4);
    return v.length > 28 ? v.slice(0, 27) + '…' : v;
  }

  /** One setting: what it is, where it comes from, and removing it. */
  PAGES.value = function (c) {
    var key = c[0], changed = Settings.changed(key), file = CONFIG[key];
    var fileHas = file instanceof Array ? file.length > 0 : !!file;
    var rows = [{label: c[1], value: shown(key), dim: true, step: function () {}}];
    rows.push({label: changed ? tr('Set on the TV') : fileHas ? tr('From the config') : tr('Not set'), value: '', dim: true,
      step: function () {}});
    rows.push({label: secret(key) ? tr('Type a new one') : tr('Change'), value: '›', step: function (d) {
      if (d < 0) return;
      var now = Settings.get(key), list = now instanceof Array;
      openTyping(c[1], secret(key) ? '' : list ? now.join(', ') : String(now || ''),
        secret(key) ? tr('Easier on the Mac: tools/setup.py.') : list ? tr('Separate them with commas.') : '',
        function (text, finish) {
          checkSetting(key, text, c[2], function (why, value) {
            if (why) { finish(why); return; }
            Settings.set(key, list ? value.split(/\s*,\s*/).filter(function (x) { return !!x; }) : value);
            needsReload();
            finish('');
          });
        });
    }});
    var has = shown(key) !== tr('None');
    if (has) {
      rows.push({label: tr('Remove'), value: '›', step: function (d) {
        if (d < 0) return;
        Settings.set(key, Settings.get(key) instanceof Array ? [] : '');
        needsReload();
        pageBack();
      }});
    }
    if (changed && fileHas) {
      rows.push({label: tr('Use the config\'s again'), value: '›', step: function (d) {
        if (d < 0) return;
        Settings.reset(key);
        needsReload();
        pageBack();
      }});
    }
    return rows;
  };

  /** What the Home Assistant tab shows, on its page under Connections. */
  function haGroupRows() {
    var groups = [
      ['homeAssistantScenes', tr('Light scenes'), ['script', 'scene']],
      ['homeAssistantLights', tr('Lights'), ['light', 'switch']],
      ['homeAssistantPower', tr('Electricity'), ['sensor']],
      ['homeAssistantLaundry', tr('Washer and dryer'), ['binary_sensor', 'switch', 'input_boolean', 'sensor']],
      ['homeAssistantGuestWifi', tr('Guest network'), ['image', 'switch']]
    ];
    return groups.map(function (g) {
      var n = Settings.get(g[0]).length;
      return pageRow(g[1], n ? plural('plural|one:{n} chosen|other:{n} chosen', n) : tr('None'), 'entities', g);
    });
  }

  var haStates = null, haAsked = false;

  /** The entities of a group's kinds, from HA; those chosen first, in their order. */
  PAGES.entities = function (g) {
    if (!haStates) {
      if (!haAsked) {
        haAsked = true;
        HA.states(function (list) { haStates = list || []; haAsked = false; if (st.zone === Z.SETTINGS) renderSettings(); });
      }
      return [{label: tr('Loading…'), value: '', dim: true, step: function () {}}];
    }
    var chosen = Settings.get(g[0]), ids = chosen.map(function (s) { return s.split(':')[0].replace(/^\s+|\s+$/g, ''); });
    var list = haStates.filter(function (e) { return g[2].indexOf(e.id.split('.')[0]) >= 0 || ids.indexOf(e.id) >= 0; });
    if (!list.length) return [{label: haStates.length ? tr('Nothing of this kind in Home Assistant.') : tr("Couldn't reach Home Assistant."),
      value: '', dim: true, step: function () {}}];
    list.sort(function (a, b) {
      var ia = ids.indexOf(a.id), ib = ids.indexOf(b.id);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      return 0;
    });
    return list.map(function (e) {
      var at = ids.indexOf(e.id);
      return {label: e.name, toggle: at >= 0, step: function () {
        var now = Settings.get(g[0]).slice();
        if (at >= 0) now.splice(at, 1);
        else now.push(e.id);
        Settings.set(g[0], now);
        needsReload();
      }};
    });
  };


  function cycle(name, values, current, d) {
    var i = values.indexOf(current);
    Prefs.set(name, values[(i + (d || 1) + values.length) % values.length]);
  }

  var rowsNow = [];

  function pageTitle() {
    switch (spage.name) {
      case 'hidden': return tr('Hidden apps');
      case 'place': return tr('Place');
      case 'apps': return tr('Apps');
      case 'saver': return tr('Screensaver and Art Mode');
      case 'connections': return tr('Connections');
      case 'service': return service(spage.arg).name;
      case 'cities': return tr('Find a city');
      case 'value': case 'entities': return spage.arg[1];
    }
    return tr('Home Settings');
  }

  function pageHint() {
    switch (spage.name) {
      case 'hidden': return tr('OK hides an app or brings it back.');
      case 'place': return tr('The weather, and the sunset that dims the home screen.');
      case 'apps': return tr('OK opens.');
      case 'connections': return tr('Easiest on the Mac (tools/setup.py); here they can be changed or removed.');
      case 'service': return tr('The switch can be turned on once it has what it needs.');
      case 'cities': return tr('OK picks the place.');
      case 'entities': return tr('OK adds or removes it.');
    }
    return tr('OK or the arrows change the value.');
  }

  function renderSettings() {
    var box = $('settings').firstChild;
    box.innerHTML = '';
    var title = el('div', 'title', box);
    sym('settings', title);
    title.appendChild(document.createTextNode(pageTitle()));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    rowsNow = settingRows();
    if (st.row >= rowsNow.length) st.row = Math.max(0, rowsNow.length - 1);
    list.style.height = Math.min(Math.max(rowsNow.length, 1), 7) * 78 + 'px';
    for (var i = 0; i < rowsNow.length; i++) {
      var r = rowsNow[i], row = el('div', 'row' + (r.dim ? ' dim' : ''), holder, r.label);
      if (r.toggle !== undefined) setClass(el('div', 'toggle', row), 'on', r.toggle);
      else if (r.check !== undefined) {
        var c = el('span', 'value', row, r.value);
        if (r.check) sym('check', c).style.marginLeft = '16px';
      } else if (r.dim) {
        if (r.value) el('span', 'value', row, r.value);
      } else if (r.value !== '') {
        var v = el('span', 'value', row);
        if (r.value === '›') v.textContent = '›';
        else if (r.opens) { v.appendChild(document.createTextNode(r.value)); el('span', 'chev', v, '›'); }
        else { el('span', 'chev', v, '‹'); v.appendChild(document.createTextNode(r.value)); el('span', 'chev', v, '›'); }
      }
      sheetHover(row, Z.SETTINGS, i);
    }
    el('div', 'hint', box, pageHint());
    updateFocus();
  }

  function openSettings() {
    st.zone = Z.SETTINGS;
    st.row = 0;
    renderSettings();
    setClass($('settings'), 'open', true);
    updateFocus();
  }

  // MARK: - Typing: a keyboard sheet for a setting's text (a name, a city, an address; a new token, though the Mac is
  // the easier way). Letters, digits and what addresses and tokens need; OK on Done hands the text to the page.

  var TYPE_MAX = 400;
  var typ = null;   // {title, text, start, hint, shift, key, busy, error, done(text, finish(error))}
  var typeKeys = [], typeNodes = [];

  /** Eleven keys wide, as Search's: shift and delete around the third row, the symbols, space and Done on the fifth. */
  function typeLayout(shift) {
    var rows = I18N.lang === 'nb' ? ['qwertyuiopå', 'asdfghjkløæ', '', '1234567890-'] :
      ['qwertyuiop', 'asdfghjkl', '', '1234567890-'];
    var out = [], r, c, ch;
    for (r = 0; r < rows.length; r++) {
      for (c = 0; c < rows[r].length; c++) {
        ch = rows[r].charAt(c);
        out.push({ch: shift ? ch.toUpperCase() : ch, row: r, col: c, span: 1});
      }
    }
    out.push({run: 'shift', row: 2, col: 0, span: 2});
    for (c = 0; c < 7; c++) {
      ch = 'zxcvbnm'.charAt(c);
      out.push({ch: shift ? ch.toUpperCase() : ch, row: 2, col: c + 2, span: 1});
    }
    out.push({sym: 'backspace', run: 'back', row: 2, col: 9, span: 2});
    for (c = 0; c < 5; c++) out.push({ch: '_.:/@'.charAt(c), row: 4, col: c, span: 1});
    out.push({sym: 'space_bar', ch: ' ', row: 4, col: 5, span: 3});
    out.push({run: 'done', row: 4, col: 8, span: 3});
    return out;
  }

  /** Opens the keyboard over Home Settings; done(text, finish) answers with finish('') to close or finish(why). */
  function openTyping(title, text, hint, done) {
    typ = {title: title, text: text, start: text, hint: hint, shift: false, key: 0, busy: false, error: '', done: done};
    setClass($('settings'), 'open', false);
    st.zone = Z.TYPE;
    renderTyping();
    setClass($('typer'), 'open', true);
  }

  /** Back to the page it was opened from. */
  function closeTyping() {
    setClass($('typer'), 'open', false);
    typ = null;
    st.zone = Z.SETTINGS;
    setClass($('settings'), 'open', true);
    renderSettings();
  }

  function renderTyping() {
    var box = $('typer').firstChild;
    box.innerHTML = '';
    el('div', 'title', box, typ.title);
    var field = el('div', 't-field', box);
    el('span', 's-text', field);
    el('i', 's-caret', field);
    var keys = el('div', 't-keys', box);
    typeKeys = typeLayout(typ.shift);
    typeNodes = [];
    for (var i = 0; i < typeKeys.length; i++) {
      var k = typeKeys[i], node = el('div', 's-key' + (k.run === 'done' ? ' wide' : ''), keys);
      node.style.left = (k.col * (KEY_SIZE + KEY_GAP)) + 'px';
      node.style.top = (k.row * (KEY_SIZE + KEY_GAP)) + 'px';
      node.style.width = (k.span * (KEY_SIZE + KEY_GAP) - KEY_GAP) + 'px';
      if (k.sym) sym(k.sym, node);
      else if (k.run === 'shift') { node.textContent = typ.shift ? 'abc' : 'ABC'; setClass(node, 'on', typ.shift); }
      else node.textContent = k.run === 'done' ? tr('key|Done') : k.ch;
      typeHover(node, i);
      typeNodes.push(node);
    }
    el('div', 'hint', box);
    updateTyping();
  }

  /** The text's end when it's longer than the field. */
  function updateTyping() {
    if (!typ) return;
    var box = $('typer').firstChild, t = typ.text;
    box.querySelector('.s-text').textContent = t.length > 34 ? '…' + t.slice(-33) : t;
    box.querySelector('.hint').textContent = typ.busy ? tr('Checking…') : typ.error || typ.hint;
    setClass(box.querySelector('.hint'), 'bad', !!typ.error && !typ.busy);
    for (var i = 0; i < typeNodes.length; i++) setClass(typeNodes[i], 'focus', st.zone === Z.TYPE && i === typ.key);
  }

  function typeHover(node, i) {
    node.onmouseover = function () {
      if (saverOn || st.zone !== Z.TYPE) return;
      typ.key = i;
      updateTyping();
    };
    node.onclick = function () { node.onmouseover(); activate(); };
  }

  function typeText(s) {
    if (!typ || typ.busy) return;
    typ.text = (typ.text + s).slice(0, TYPE_MAX);
    typ.error = '';
    updateTyping();
  }

  function typeKey(k) {
    if (!typ || typ.busy || !k) return;
    if (k.run === 'shift') { typ.shift = !typ.shift; renderTyping(); return; }
    if (k.run === 'back') { typ.text = typ.text.slice(0, -1); typ.error = ''; updateTyping(); return; }
    if (k.run !== 'done') { typeText(k.ch); return; }
    var text = trim(typ.text);
    if (text === trim(typ.start)) { closeTyping(); return; }   // nothing changed
    typ.busy = true;
    updateTyping();
    var mine = typ;
    typ.done(text, function (why) {
      if (typ !== mine) return;   // closed meanwhile
      typ.busy = false;
      if (why) { typ.error = why; updateTyping(); }
      else closeTyping();
    });
  }

  function typeMove(dx, dy) {
    var n = spatialMove(typeNodes, typ.key, dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up');
    if (n >= 0) typ.key = n;
    updateTyping();
  }

  // MARK: - Checking what was typed against its service, before it's saved

  /** A request to a service; done(status, json): 0 when it didn't answer. */
  function ask(method, url, headers, form, done) {
    var x = new XMLHttpRequest(), over = false, body = null;
    x.open(method, url, true);
    x.timeout = 12000;
    for (var h in headers) if (headers.hasOwnProperty(h)) x.setRequestHeader(h, headers[h]);
    if (form) {
      var parts = [];
      for (var f in form) if (form.hasOwnProperty(f)) parts.push(encodeURIComponent(f) + '=' + encodeURIComponent(form[f]));
      body = parts.join('&');
      x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    }
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      var json = null;
      try { json = JSON.parse(x.responseText); } catch (e) {}
      done(x.status, json);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(0, null); } };
    x.send(body);
  }

  /** Home Assistant's token, by signing in on its WebSocket (its REST API may not allow the TV's origin). */
  function askHA(url, token, done) {
    var ws, over = false;
    function end(status) {
      if (over) return;
      over = true;
      clearTimeout(timer);
      try { ws.close(); } catch (e) {}
      done(status);
    }
    var timer = setTimeout(function () { end(0); }, 12000);
    try { ws = new WebSocket(url.replace(/\/+$/, '').replace(/^http/, 'ws') + '/api/websocket'); } catch (e) { end(0); return; }
    ws.onmessage = function (e) {
      var m = null;
      try { m = JSON.parse(e.data); } catch (err) {}
      if (!m) return;
      if (m.type === 'auth_required') ws.send(JSON.stringify({type: 'auth', access_token: token}));
      else if (m.type === 'auth_ok') end(200);
      else if (m.type === 'auth_invalid') end(401);
    };
    ws.onerror = function () { end(0); };
  }

  var ADDRESSES = ['staseraUrl', 'homeAssistantUrl', 'artUrl'];

  /**
   * Is the value good? done(why, value): why is '' when it may be saved, value what to save (Spotify hands back a new
   * refresh token, and the old one may stop working). Tokens are tried on their service; a service that doesn't
   * answer saves nothing.
   */
  function checkSetting(key, value, service, done) {
    function answered(status, ok) {
      if (ok) done('', value);
      else if (!status) done(trf("Couldn't reach {service} to check it.", {service: service}), value);
      else done(trf('{service} turned it down.', {service: service}), value);
    }
    if (ADDRESSES.indexOf(key) >= 0) {
      value = value.replace(/\/+$/, '');
      done(/^https?:\/\/[^\s\/]+/.test(value) ? '' : tr('An address starts with http:// or https://.'), value);
      return;
    }
    if (key === 'githubToken') {
      ask('GET', 'https://api.github.com/user', {Authorization: 'Bearer ' + value, Accept: 'application/vnd.github+json'}, null,
        function (s) { answered(s, s === 200); });
    } else if (key === 'vercelToken') {
      ask('GET', 'https://api.vercel.com/v2/user', {Authorization: 'Bearer ' + value}, null, function (s) { answered(s, s === 200); });
    } else if (key === 'homeAssistantToken') {
      if (!Settings.get('homeAssistantUrl')) { done(tr('Set the address first.'), value); return; }
      askHA(Settings.get('homeAssistantUrl'), value, function (s) { answered(s, s === 200); });
    } else if (key === 'artKey') {
      if (!Settings.get('artUrl')) { done(tr('Set the address first.'), value); return; }
      ask('GET', String(Settings.get('artUrl')).replace(/\/+$/, '') + '/status', {Authorization: 'Bearer ' + value}, null,
        function (s) { answered(s, s >= 200 && s < 300); });
    } else if (key === 'spotifyRefreshToken') {
      if (!Settings.get('spotifyClientId')) { done(tr('Set the client id first.'), value); return; }
      ask('POST', 'https://accounts.spotify.com/api/token', {}, {grant_type: 'refresh_token', refresh_token: value,
        client_id: Settings.get('spotifyClientId')}, function (s, json) {
        if (s === 200 && json && json.refresh_token) value = json.refresh_token;
        answered(s, s === 200);
      });
    } else done('', value);
  }

  /** Open-Meteo's places for a name: [{name, where, lat, lon}]; null when it didn't answer. */
  function findCities(q, done) {
    ask('GET', 'https://geocoding-api.open-meteo.com/v1/search?count=10&format=json&language=' + I18N.lang + '&name=' +
      encodeURIComponent(q), {}, null, function (s, json) {
      if (s !== 200 || !json) { done(null); return; }
      done((json.results || []).map(function (r) {
        return {name: r.name, where: [r.admin1, r.country_code].filter(function (x) { return !!x; }).join(', '),
          lat: String(r.latitude), lon: String(r.longitude)};
      }));
    });
  }

  // MARK: - Stasera: linking the TV with a QR code (the phone opens Stasera's approval page)

  /** A QR code as an SVG of dark modules, `size` px square, with a white quiet zone. */
  function qrSvg(text, size) {
    var qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount(), q = 4, all = n + 2 * q, ns = 'http://www.w3.org/2000/svg', d = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
    }
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + all + ' ' + all);
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('shape-rendering', 'crispEdges');
    var bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', all);
    bg.setAttribute('height', all);
    bg.setAttribute('fill', '#FFF');
    svg.appendChild(bg);
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', '#000');
    svg.appendChild(path);
    return svg;
  }

  var linkError = '', linkFor = 'stasera';

  function renderLink() {
    var box = $('link').firstChild;
    box.innerHTML = '';
    if (linkFor === 'youtube') { renderYouTubeLink(box); return; }
    var title = el('div', 'title', box);
    sym('live_tv', title);
    title.appendChild(document.createTextNode('Stasera'));
    if (Stasera.linked()) {
      el('div', 'text', box, Stasera.name() ? trf('This TV is linked to Stasera as {name}.', {name: Stasera.name()})
          : tr('This TV is linked to Stasera.'));
      var row = el('div', 'row focus', box, tr('Unlink'));
      row.onclick = activate;
      el('div', 'hint', box, tr('OK unlinks, Back closes.'));
      return;
    }
    var pairing = Stasera.pairing();
    if (!pairing) {
      el('div', 'text', box, linkError || tr('Getting a code…'));
      if (linkError) {
        var again = el('div', 'row focus', box, tr('Try again'));
        again.onclick = activate;
      }
      return;
    }
    var qr = el('div', 'qr', box);
    qr.appendChild(qrSvg(pairing.url, 300));
    var side = el('div', 'side', box);
    el('div', 'text', side, tr('Scan the code with your phone and approve the TV in Stasera.'));
    el('div', 'or', side, trf('Or go to {site} and enter:', {site: pairing.url.replace(/^https?:\/\//, '').replace(/\?.*$/, '')}));
    el('div', 'code', side, pairing.code);
    el('div', 'hint', box, tr('Waiting for approval… Back cancels.'));
  }

  /** Signing in to YouTube: Google's code, entered at google.com/device on the phone. */
  function renderYouTubeLink(box) {
    var title = el('div', 'title', box);
    sym('play', title);
    title.appendChild(document.createTextNode('YouTube'));
    if (YouTube.linked()) {
      el('div', 'text', box, YouTube.name() ? trf('This TV is signed in to YouTube as {name}.', {name: YouTube.name()})
          : tr('This TV is signed in to YouTube.'));
      var row = el('div', 'row focus', box, tr('Sign out'));
      row.onclick = activate;
      el('div', 'hint', box, tr('OK signs out, Back closes.'));
      return;
    }
    var pairing = YouTube.pairing();
    if (!pairing) {
      el('div', 'text', box, linkError || tr('Getting a code…'));
      if (linkError) {
        var again = el('div', 'row focus', box, tr('Try again'));
        again.onclick = activate;
      }
      return;
    }
    var qr = el('div', 'qr', box);
    qr.appendChild(qrSvg(pairing.url, 300));
    var side = el('div', 'side', box);
    el('div', 'text', side, tr('Scan the code with your phone, sign in to Google and allow Frame TV to see your subscriptions.'));
    el('div', 'or', side, trf('Or go to {site} and enter:', {site: pairing.url.replace(/^https?:\/\/(www\.)?/, '')}));
    el('div', 'code', side, pairing.code);
    el('div', 'hint', box, tr('Waiting for Google… Back cancels.'));
  }

  function newCode() {
    linkError = '';
    if (linkFor === 'youtube') {
      YouTube.link(function (err) {
        if (err) linkError = err.message === 'offline' ? tr("Couldn't reach Google.") : tr('Google turned down the sign-in. Check the OAuth client in config.properties.');
        if (st.zone === Z.LINK) renderLink();
      });
      return;
    }
    Stasera.link(Settings.get('staseraName') || 'The Frame', function (err) {
      if (err) linkError = err.message === 'busy' ? tr('Stasera is busy. Try again in a minute.') : tr("Couldn't reach Stasera.");
      if (st.zone === Z.LINK) renderLink();
    });
  }

  function openLink(which) {
    setClass($('settings'), 'open', false);
    st.zone = Z.LINK;
    linkFor = which === 'youtube' ? 'youtube' : 'stasera';
    linkError = '';
    renderLink();
    setClass($('link'), 'open', true);
    var s = which === 'youtube' ? YouTube : Stasera;
    if (!s.linked() && !s.pairing()) newCode();
    updateFocus();
  }

  // MARK: - Language: a list of every catalogue in its own name (moving through it doesn't switch the app)

  var langHint = null;

  function languageChoices() {
    return ['auto'].concat(I18N.languages());
  }

  /** The language in use: "auto", or the catalogue the setting resolved to ("pt-BR" in config.properties is "pt"). */
  function pickedLanguage() {
    return Prefs.language() === 'auto' ? 'auto' : I18N.lang;
  }

  function renderLanguages() {
    var box = $('langpick').firstChild, choices = languageChoices(), current = choices.indexOf(pickedLanguage());
    box.innerHTML = '';
    el('div', 'title', box, tr('Language'));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    list.style.height = Math.min(choices.length, 7) * 78 + 'px';
    for (var i = 0; i < choices.length; i++) {
      var row = el('div', 'row', holder, choices[i] === 'auto' ? tr('Automatic') : I18N.languageName(choices[i]));
      if (i === current) sym('check', el('span', 'value', row));
      sheetHover(row, Z.LANG, i);
    }
    langHint = el('div', 'hint', box);
    updateFocus();
  }

  function openLanguages() {
    setClass($('settings'), 'open', false);
    st.zone = Z.LANG;
    st.lang = Math.max(0, languageChoices().indexOf(pickedLanguage()));
    renderLanguages();
    setClass($('langpick'), 'open', true);
    updateFocus();
  }

  /** OK: the language under the focus; Back: none. Either way, back to Home Settings, on the Language row. */
  function closeLanguages(pick) {
    setClass($('langpick'), 'open', false);
    langHint = null;
    var code = languageChoices()[st.lang];
    if (pick && code !== pickedLanguage()) {
      Prefs.set('language', code);
      I18N.set(Prefs.language());
      renderAll();
      Stasera.refresh(true);   // Hjem's greeting comes in the new language
    }
    openSettings();
    for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].language) st.row = i;
    updateFocus();
  }

  // MARK: - Shelf editor: which apps, in what order

  function editList() {
    var ids = shelf.map(function (a) { return a.id; });
    return {ids: ids, rows: apps.slice().sort(function (a, b) {
      var ia = ids.indexOf(a.id), ib = ids.indexOf(b.id);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1;
    })};
  }

  function renderShelfEdit() {
    var box = $('shelfedit').firstChild, e = editList();
    box.innerHTML = '';
    var title = el('div', 'title', box);
    sym('apps', title);
    title.appendChild(document.createTextNode(tr('Shelf')));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    list.style.height = Math.min(e.rows.length, 7) * 78 + 'px';
    for (var i = 0; i < e.rows.length; i++) {
      var a = e.rows[i], at = e.ids.indexOf(a.id), row = el('div', 'row', holder, a.title);
      var place = el('span', 'value', row, at >= 0 ? '#' + (at + 1) : tr('shelf|Off'));
      if (at >= 0) sym('check', place).style.marginLeft = '16px';   // on the shelf: a check, as in the pickers
      sheetHover(row, Z.EDIT, i);
    }
    el('div', 'hint', box, tr('OK adds or removes an app. ← → change the order.'));
    updateFocus();
  }

  function openShelfEdit() {
    setClass($('settings'), 'open', false);
    st.zone = Z.EDIT;
    st.edit = 0;
    renderShelfEdit();
    setClass($('shelfedit'), 'open', true);
    updateFocus();
  }

  function editShelf(dx) {
    var e = editList(), app = e.rows[st.edit];
    if (!app) return;
    var ids = e.ids.slice(), at = ids.indexOf(app.id);
    if (dx === 0) {
      if (at >= 0) ids.splice(at, 1);
      else ids.push(app.id);
    } else {
      if (at < 0) return;
      var to = Math.max(0, Math.min(ids.length - 1, at + dx));
      ids.splice(at, 1);
      ids.splice(to, 0, app.id);
    }
    Prefs.set('shelf', ids);
    pickShelf();
    renderTV();
    renderHome();
    var again = editList();
    for (var i = 0; i < again.rows.length; i++) if (again.rows[i].id === app.id) st.edit = i;
    renderShelfEdit();
  }


  // MARK: - Sheets: focus

  function updateFocus() {
    var i, list = document.querySelectorAll('#apps .cell');
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.APPS && st.grid === i);
    var rows = Math.max(1, Math.ceil(sheetApps.length / 5)), r = Math.floor(st.grid / 5), first = Math.max(0, Math.min(rows - 3, r - 1));
    transform($('apps').lastChild, 'translateY(' + (-first * 239) + 'px)');
    focusRows($('settings'), st.row, st.zone === Z.SETTINGS);
    focusRows($('shelfedit'), st.edit, st.zone === Z.EDIT);
    focusRows($('langpick'), st.lang, st.zone === Z.LANG);
    focusRows($('devpick'), st.device, st.zone === Z.DEVICE);
    pageFocus();
    if (langHint) langHint.textContent = (st.lang + 1) + ' / ' + languageChoices().length + '  ·  ' + tr('OK picks, Back cancels.');
    update();
  }

  function focusRows(sheet, index, on) {
    var rows = sheet.querySelectorAll('.row');
    for (var i = 0; i < rows.length; i++) setClass(rows[i], 'focus', on && i === index);
    var holder = sheet.querySelector('.rows');
    if (!holder) return;
    var visible = 7, first = Math.max(0, Math.min(rows.length - visible, index - 3));
    transform(holder, 'translateY(' + (-first * 78) + 'px)');
  }

  function sheetHover(node, zone, index) {
    node.onmouseover = function () {
      if (saverOn || st.zone !== zone) return;
      if (zone === Z.APPS) st.grid = index;
      else if (zone === Z.SETTINGS) st.row = index;
      else if (zone === Z.EDIT) st.edit = index;
      else if (zone === Z.LANG) st.lang = index;
      else if (zone === Z.DEVICE) st.device = index;
      updateFocus();
    };
    node.onclick = function () { node.onmouseover(); activate(); };
  }

  // MARK: - Opening things

  function launcher(id, name) {
    return function () {
      HA.opening({id: id, title: name}, null);
      TV.launch(id, null, function (ok) {
        if (!ok) toast(trf("Couldn't open {app}.", {app: name || id}));
      });
    };
  }

  function tvSettings() {
    TV.settings(function (ok) {
      if (!ok) toast(tr("Couldn't open TV Settings"));
    });
  }

  function activate() {
    switch (st.zone) {
      case Z.APPS:
        if (sheetApps[st.grid]) launcher(sheetApps[st.grid].id, sheetApps[st.grid].title)();
        return;
      case Z.SETTINGS:
        if (rowsNow[st.row]) { rowsNow[st.row].step(1); if (st.zone === Z.SETTINGS) renderSettings(); }
        return;
      case Z.EDIT:
        editShelf(0);
        return;
      case Z.LANG:
        closeLanguages(true);
        return;
      case Z.DEVICE:
        pickDevice();
        return;
      case Z.TITLE:
        pageActivate();
        return;
      case Z.TYPE:
        typeKey(typeKeys[typ.key]);
        return;
      case Z.LINK:
        if (linkFor === 'youtube') {
          if (YouTube.linked()) {
            YouTube.unlink();
            toast(tr('Signed out of YouTube.'));
            closeSheets();
          } else if (!YouTube.pairing()) {
            newCode();
          }
          return;
        }
        if (Stasera.linked()) {
          Stasera.unlink();
          toast(tr('Unlinked from Stasera.'));
          closeSheets();
        } else if (!Stasera.pairing()) {
          newCode();
        }
        return;
    }
    if (nav.area === 'tabs') {
      if (BAR[nav.bar].sym) BAR[nav.bar].run();
      else enterTab();
      return;
    }
    if (dimFocused()) { dimToggle(); return; }
    if (volumeFocused()) { endVolume(); return; }
    var f = focused();
    if (f && f.run) f.run();
  }

  function move(dx, dy) {
    switch (st.zone) {
      case Z.APPS:
        var g = st.grid + dx + dy * 5;
        if (g >= 0 && g < sheetApps.length && (dx === 0 || Math.floor(g / 5) === Math.floor(st.grid / 5))) st.grid = g;
        updateFocus();
        return;
      case Z.SETTINGS:
        if (dy) st.row = Math.max(0, Math.min(rowsNow.length - 1, st.row + dy));
        else if (dx && rowsNow[st.row]) {
          var r = rowsNow[st.row];
          if (r.value !== '›' && r.check === undefined && !r.dim) { r.step(dx); if (st.zone === Z.SETTINGS) renderSettings(); }
        }
        updateFocus();
        return;
      case Z.EDIT:
        if (dy) st.edit = Math.max(0, Math.min(apps.length - 1, st.edit + dy));
        else if (dx) editShelf(dx);
        updateFocus();
        return;
      case Z.LANG:
        if (dy) st.lang = Math.max(0, Math.min(languageChoices().length - 1, st.lang + dy));
        updateFocus();
        return;
      case Z.DEVICE:
        if (dy) st.device = Math.max(0, Math.min(devRows.length - 1, st.device + dy));
        updateFocus();
        return;
      case Z.LINK:
        return;
      case Z.TYPE:
        typeMove(dx, dy);
        return;
      case Z.TITLE:
        pageMove(dx, dy);
        return;
    }
    if (nav.area === 'tabs') {
      if (dx) {
        focusBar(Math.max(0, Math.min(BAR.length - 1, nav.bar + dx)));
      } else if (dy > 0) {
        enterTab();
      } else {
        update();
      }
      return;
    }
    if (dimFocused()) {
      if (dx) dimStep(dx);
      else endDim();
      return;
    }
    if (dimming) endDim();
    if (volumeFocused()) {
      if (dx) volumeStep(dx);
      else endVolume();
      return;
    }
    if (vol) endVolume();
    if (cinema()) tvMove(dx, dy);
    else if (nav.tab === 'search') searchMove(dx, dy);
    else gridMove(dx, dy);
  }

  function back() {
    if (st.zone === Z.EDIT) {
      setClass($('shelfedit'), 'open', false);
      openSettings();
      for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].shelf) st.row = i;
      updateFocus();
      return;
    }
    if (st.zone === Z.TYPE) { closeTyping(); return; }
    if (st.zone === Z.APPS) {
      setClass($('apps'), 'open', false);
      openSettings();
      for (var a = 0; a < rowsNow.length; a++) if (rowsNow[a].allApps) st.row = a;
      updateFocus();
      return;
    }
    if (st.zone === Z.LINK) {
      setClass($('link'), 'open', false);
      Stasera.cancel();
      YouTube.cancel();
      openSettings();
      for (var l = 0; l < rowsNow.length; l++) if (rowsNow[l].link) st.row = l;
      updateFocus();
      return;
    }
    if (st.zone === Z.SETTINGS && pageBack()) return;
    if (st.zone === Z.LANG) { closeLanguages(false); return; }
    if (st.zone === Z.TITLE) { closePage(); updateFocus(); return; }
    if (sheetOpen()) { closeSheets(); return; }
    if (dimFocused()) { endDim(); return; }
    if (volumeFocused()) { endVolume(); return; }
    if (nav.area === 'content') { focusTabs(); return; }
    if (nav.tab !== 'home') { showTab('home'); nav.bar = BAR.indexOf('home'); update(); return; }
    TV.back();
  }

  // MARK: - Toast

  var toastTimer = 0;
  function toast(text, ms) {
    var t = $('toast');
    t.textContent = text;
    setClass(t, 'on', true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { setClass(t, 'on', false); }, ms || 6000);
  }

  // MARK: - Screensaver

  var saverOn = false, idleAt = Date.now(), saverIndex = 0, saverTimer = 0;
  var artAsked = false;  // the add-on has been told; again only after someone uses the TV

  /** The screensaver's photos: our titles from Stasera (without it, only the clock). */
  function saverPhotos() {
    return Stasera.linked() ? Stasera.showcase() : [];
  }

  /** With Frame Art the TV goes to Art Mode (AUG-1496); ours only when the add-on doesn't answer. */
  function startSaver() {
    if (!Art.enabled() || Art.sample()) { showSaver(); return; }
    if (artAsked) return;
    artAsked = true;
    Art.event('saver_start', 'the screensaver: asking Frame Art for Art Mode');
    Art.saver(Prefs.saverEvery(), function (ok) {
      if (!ok) Art.event('saver_failed', "Frame Art didn't answer: Frame TV's own screensaver");
      if (!ok && artAsked && !saverOn) showSaver();
    });
  }

  /** Music is playing and the Spotify tab is in front: no screensaver then. */
  function listening() {
    var n = Spotify.now();
    return nav.tab === 'spotify' && !!(n && n.playing);
  }

  /** Ms of idling before the screensaver (Home Settings), or 0: never, also when Home Assistant has it off. */
  function saverAfter() {
    return Art.enabled() && !Art.saverAllowed() ? 0 : Prefs.saverMinutes() * 60000;
  }

  function showSaver() {
    var photos = saverPhotos();
    saverOn = true;
    Art.event('saver_own', "Frame TV's own screensaver started");
    clearTimeout(heroTimer);
    var s = $('saver');
    s.innerHTML = '';
    var a = el('div', 'photo', s), b = el('div', 'photo', s);
    el('div', 'shade', s);
    var clock = el('div', 'clock', s);
    el('div', 'time', clock);
    el('div', 'date', clock);
    el('div', 'title', clock);
    var front = a;
    function next() {
      if (!saverOn) return;
      var p = photos.length ? photos[saverIndex++ % photos.length] : null;
      var back = front === a ? b : a;
      if (p) {
        back.style.backgroundImage = 'url(' + Data.image(p.backdrop, 'original') + ')';
        transform(back, 'scale(1.0)');
        clock.lastChild.textContent = p.title;
        setTimeout(function () {
          setClass(back, 'on', true);
          setClass(front, 'on', false);
          transform(back, 'scale(1.08) translateX(-1.5%)');
          front = back;
        }, 60);
      }
      tickSaverClock(clock);
      saverTimer = setTimeout(next, Prefs.saverEvery() * 60000);
    }
    setClass(s, 'on', true);
    next();
  }

  function tickSaverClock(clock) {
    var d = new Date();
    clock.firstChild.textContent = formatDate('format|h:mm', d.getTime());
    clock.children[1].textContent = formatDate('format|EEEE, MMMM d', d.getTime());
  }

  function hideSaver() {
    if (!saverOn) return;
    saverOn = false;
    Art.event('saver_stop', "Frame TV's own screensaver stopped");
    clearTimeout(saverTimer);
    setClass($('saver'), 'on', false);
    if (cinema() && tvf.area === 'hero' && !calmMode()) showHero(tvf.hero, true);
  }

  function poke() {
    idleAt = Date.now();
    artAsked = false;
    if (saverOn) { hideSaver(); return true; }
    return false;
  }

  // MARK: - Keys

  // Holding OK on an episode or a movie marks it watched (on Kunstmodus, a new picture); a press opens it, on release.
  // For UNDO ms after that a hold anywhere takes it back: the card may be gone, and its neighbour isn't to be marked.
  var HOLD = 700, UNDO = 10000, holdTimer = 0, held = false, undo = null, marking = false;

  function undoLive() {
    return !!undo && (st.zone === Z.MAIN || st.zone === Z.TITLE) && Date.now() - undo.at < UNDO;
  }

  function markable(item) {
    return kindOf(item) === 'movie' ? item.status !== 'watched' : !!item.episodeTmdbId;
  }

  function holdable() {
    var f = focused();
    return undoLive() || !!(f && f.hold && (typeof f.hold === 'function' || markable(f.hold)));
  }

  function sameTitle(a, b) { return kindOf(a) === kindOf(b) && a.tmdbId === b.tmdbId; }

  /** The open title page of this item, or null. */
  function pageOf(item) {
    var all = page ? pages.concat([page]) : [];
    for (var i = all.length - 1; i >= 0; i--) if (all[i].kind === 'title' && sameTitle(all[i].item, item)) return all[i];
    return null;
  }

  /** Stasera's new answer on the title page; unlike merged, its nulls count here (out of the library, no next episode). */
  function showMarked(p, t) {
    if (!p || !t) return;
    p.item = merged(p.item, t);
    p.item.status = t.status;
    p.item.nextEpisode = t.nextEpisode;
    if (p.changed) p.changed(p.item);
    if (p === page) renderPage();
  }

  function markLabel(item) { return kindOf(item) === 'movie' ? item.title : item.title + ' ' + ep(item); }

  function markError(err) {
    return err && err.message === 'old' ? tr('Requires a newer Stasera.') : titleError(err);
  }

  /** Marks item watched; previous is where a movie goes if it's undone. done() when Stasera has answered. */
  function markItem(item, previous, done) {
    if (marking) return;
    marking = true;
    Stasera.watched(item, function (err, t, changed) {
      marking = false;
      if (done) done();
      if (err) { toast(markError(err)); return; }
      var p = pageOf(item);
      if (changed) {
        undo = {item: item, previous: previous, at: Date.now()};
        if (p) p.marked = {previous: previous};
        toast(trf('Watched: {title} · hold OK to undo', {title: markLabel(item)}), UNDO);
      } else {
        toast(trf('Already watched: {title}', {title: markLabel(item)}));
      }
      showMarked(p, t);
    });
  }

  function unmark(item, previous) {
    if (marking) return;
    marking = true;
    Stasera.unwatched(item, previous, function (err, t) {
      marking = false;
      if (err) { toast(markError(err)); return; }
      if (undo && sameTitle(undo.item, item)) undo = null;
      var p = pageOf(item);
      if (p) p.marked = null;
      toast(trf('Undone: {title}', {title: markLabel(item)}));
      showMarked(p, t);
    });
  }

  function markWatched(f) {
    if (!f || !f.hold) return;
    if (typeof f.hold === 'function') { f.hold(); return; }   // a tile's own long press (Kunstmodus)
    var item = f.hold, node = f.node;
    setClass(node, 'marked', true);
    // Home's movies are the watchlist's.
    markItem(item, kindOf(item) === 'movie' ? item.status || 'watchlist' : null, function () { setClass(node, 'marked', false); });
  }

  /** The remote's play, pause and skip keys control Spotify, wherever the home screen is. */
  function mediaKey(k) {
    var m = TV.keys.media;
    if (!Spotify.enabled() || !m) return false;
    var n = Spotify.now();
    if (k === m.playPause) Spotify.toggle(spotifyDone);
    else if (k === m.play) { if (!n || !n.playing) Spotify.toggle(spotifyDone); }
    else if (k === m.pause) { if (n && n.playing) Spotify.toggle(spotifyDone); }
    else if (k === m.next) Spotify.next(spotifyDone);
    else if (k === m.previous) Spotify.previous(spotifyDone);
    else return false;
    return true;
  }

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (poke()) { e.preventDefault(); return; }   // the first press only wakes the screen
    if (k === TV.keys.ok && holdable()) {
      if (!holdTimer && !held) {
        // Settled at the press: the hero rotates, and the undo may run out during the hold.
        var under = focused(), undoing = undoLive();
        holdTimer = setTimeout(function () {
          holdTimer = 0;
          held = true;
          if (!undoing) markWatched(under);
          else if (undo) unmark(undo.item, undo.previous);
        }, HOLD);
      }
      e.preventDefault();
      return;
    }
    if (mediaKey(k)) { e.preventDefault(); return; }
    if (st.zone === Z.TYPE && k === 8) { typeKey({run: 'back'}); e.preventDefault(); return; }
    if (k === TV.keys.left) move(-1, 0);
    else if (k === TV.keys.right) move(1, 0);
    else if (k === TV.keys.up) move(0, -1);
    else if (k === TV.keys.down) move(0, 1);
    else if (k === TV.keys.ok) activate();
    else if (k === TV.keys.back || k === 27 || k === 8) back();
    else return;
    e.preventDefault();
  });
  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== TV.keys.ok) return;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; activate(); }
    held = false;
  });
  document.addEventListener('mousemove', function () { poke(); });
  // A keyboard on the TV (or the Mac's, previewing) types into the keyboard sheet; pasting too.
  document.addEventListener('keypress', function (e) {
    if (st.zone !== Z.TYPE || !e.charCode || e.charCode < 32) return;
    typeText(String.fromCharCode(e.charCode));
    e.preventDefault();
  });
  document.addEventListener('paste', function (e) {
    if (st.zone !== Z.TYPE || !e.clipboardData) return;
    typeText(e.clipboardData.getData('text').replace(/\s+/g, ' '));
    e.preventDefault();
  });

  // MARK: - Start

  function renderAll() {
    renderTabs();
    renderHome();
    renderTV();
    renderPanes();
    renderClock();
    if (st.zone === Z.SETTINGS) renderSettings();
    showTab(nav.tab);
  }

  /** hide_apps: left out of the apps and All Apps, by id or name (part of it). The entries that hide app. */
  function hiders(app) {
    var id = (app.id || '').toLowerCase(), title = (app.title || '').toLowerCase();
    return Settings.get('hideApps').filter(function (s) {
      s = s.toLowerCase();
      return !!s && (id.indexOf(s) >= 0 || title.indexOf(s) >= 0);
    });
  }
  function hidden(app) { return hiders(app).length > 0; }

  var allApps = [];   // hidden ones too, for Home Settings

  function loadApps(done) {
    TV.apps(function (list) {
      allApps = list;
      apps = list.filter(function (a) { return !hidden(a); });
      Data.setApps(apps);
      pickShelf();
      if (done) done();
    });
  }

  /** Back to the home screen (the app was opened again): Hjem, everything closed. */
  function reset() {
    hideSaver();
    closeSheets();
    clearSearch();
    if (Stasera.linked()) renderSearch();
    nav.area = 'content';
    grid('home').focus = 0;
    showTab('home');
  }

  function refresh() {
    Data.refresh();
    Stasera.refresh();
    GitHub.refresh();
    YouTube.refresh();
    Spotify.refresh();
  }

  /** What Stasera last said, so a refresh with the same answer doesn't redraw (and reload every picture). */
  function staseraKey() {
    try { return (Stasera.linked() ? '1' : '0') + JSON.stringify(Stasera.home()); } catch (e) { return String(Math.random()); }
  }

  var wasLinked = Stasera.linked(), lastStasera = staseraKey();
  Stasera.onChange(function () {
    var linked = Stasera.linked();
    if (linked !== wasLinked) {
      wasLinked = linked;
      if (linked && st.zone === Z.LINK && linkFor === 'stasera') { closeSheets(); toast(tr('Linked to Stasera.')); }
      if (st.zone === Z.SETTINGS) renderSettings();
      if (st.zone === Z.TITLE) { closeTitle(); updateFocus(); }   // it came from the search, which goes now
      clearSearch();   // unlinked: no trace of it; linked: a fresh one
      if (linked) renderSearch();
      renderTabs();   // the Stasera and Search tabs come and go with the link
    }
    if (st.zone === Z.LINK && linkFor === 'stasera') renderLink();
    renderClock();   // the greeting
    var key = staseraKey();
    if (key === lastStasera) return;
    lastStasera = key;
    renderHome();
    renderTV();
    if (linked) renderStasera();
    showTab(nav.tab);
  });

  var lastArt = '';
  Art.onChange(function () {
    var key = [Art.showing(), Art.minutes(), Art.mode(), Art.category()].join(':');
    if (key === lastArt) return;
    lastArt = key;
    renderHome();
    update();
  });

  var lastGitHub = '';
  GitHub.onChange(function () {
    var key = JSON.stringify(GitHub.summary());
    if (key === lastGitHub) return;
    lastGitHub = key;
    renderHome();
    renderGitHub();
    update();
  });

  // HA's states come one by one; draw once they've settled.
  var haTimer = 0;
  HA.onChange(function () {
    if (!HA.enabled()) return;
    clearTimeout(haTimer);
    haTimer = setTimeout(function () {
      renderHA();
      if (nav.tab === 'home' && st.zone === Z.MAIN) renderHome();
      update();
    }, 250);
  });
  HA.onNotify(function (d) {
    var text = [d.title, d.message].filter(function (s) { return s; }).join(': ');
    if (text) toast(text, d.seconds > 0 ? d.seconds * 1000 : 0);
  });

  Spotify.onChange(function () {
    if (!Spotify.enabled()) return;
    renderSpotify();
    if (nav.tab === 'spotify') showTab('spotify');   // the room's light: the new cover
    if (st.zone === Z.MAIN) renderHome();   // also behind another tab, so Hjem is right when it comes back
    update();
  });
  setInterval(function () { if (nav.tab === 'spotify' && !document.hidden) tickSpotify(); }, 1000);
  if (Spotify.enabled()) TV.mediaKeys();

  function youtubeKey() { return JSON.stringify([YouTube.playlist(), YouTube.saved(), YouTube.videos()]); }
  var wasSignedIn = YouTube.linked(), lastYouTube = youtubeKey();
  YouTube.onChange(function () {
    var linked = YouTube.linked();
    if (linked !== wasSignedIn) {
      wasSignedIn = linked;
      if (linked && st.zone === Z.LINK && linkFor === 'youtube') { closeSheets(); toast(tr('Signed in to YouTube.')); }
      if (st.zone === Z.SETTINGS) renderSettings();
    }
    if (st.zone === Z.LINK && linkFor === 'youtube') renderLink();
    if (st.zone === Z.SETTINGS) renderSettings();   // the playlists came
    var key = youtubeKey();
    if (key === lastYouTube) return;
    lastYouTube = key;
    renderHome();
    renderTV();
    showTab(nav.tab);
  });

  Data.onChange(function () {
    renderClock();
    if (nav.tab === 'home' && st.zone === Z.MAIN) { renderHome(); update(); }
  });

  function reopened() {
    reset();
    loadApps(function () { renderHome(); renderTV(); update(); refresh(); });
  }

  window.addEventListener('resize', fit);
  window.addEventListener('appcontrol', reopened);   // opened again while running
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hideSaver(); clearTimeout(heroTimer); return; }
    idleAt = Date.now();
    artAsked = false;
    loadApps(function () { renderHome(); renderTV(); showTab(nav.tab); refresh(); });
  });

  I18N.set(Prefs.language());
  fit();
  renderTabs();
  tickClock();
  update();
  loadApps(function () {
    renderAll();
    refresh();
  });
  setInterval(function () {
    refresh();
    var after = saverAfter();
    if (listening()) idleAt = Date.now();   // the idle minutes count from when the music stops
    if (!saverOn && after && !sheetOpen() && Date.now() - idleAt > after) startSaver();
    if (saverOn) tickSaverClock($('saver').querySelector('.clock'));
  }, 30000);

  // For the browser preview and tests.
  window.FrameTV = {nav: nav, tv: tvf, state: st, move: move, activate: activate, back: back, showSaver: showSaver, hideSaver: hideSaver, toast: toast};
})();
