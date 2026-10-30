/*
 * Spotify on the home screen (AUG-1470): what's playing on any of our devices, with the controls (previous, play or
 * pause, next, volume), moving the playing over to the TV or another device, and opening Spotify's own app. On with spotify_client_id
 * and spotify_refresh_token in config.properties unless spotify=false; tools/spotify_login.py signs in on the Mac
 * (PKCE: no client secret) and writes both there. Spotify turns a refresh token down 6 months after the sign-in,
 * refreshing or not; then the tab says to run the script again.
 * A refresh may hand back a new refresh token, and the old one may stop working: the newest stays in localStorage,
 * and config.properties' token is only where it starts (a new one there wins once, as the other settings do).
 * Controlling needs Premium (Spotify answers 403 without it). In a desktop browser without config it shows a sample.
 */
var Spotify = (function () {
  'use strict';

  function trim(s) { return String(s || '').replace(/^\s+|\s+$/g, ''); }

  var CLIENT = trim(Settings.get('spotifyClientId')), SEED = trim(Settings.get('spotifyRefreshToken'));
  var ON = Modules.on('spotify');
  var SAMPLE = ON && !(CLIENT && SEED) && TV.name === 'browser';
  var READY = ON && !!CLIENT && !!SEED;
  var APP = 'rJeHak5zRg.Spotify';
  var AUTH = 'fmtv.spotify.auth';
  var API = 'https://api.spotify.com/v1/';
  // How often to ask: often while someone looks at it, seldom otherwise (Spotify counts calls in 30 s windows, and
  // an app in development mode has a quota besides). After a 429, nothing for a minute, then twice as long each time.
  var FAST = 4000, SLOW = 60000, BUSY_MIN = 60000, BUSY_MAX = 30 * 60000;
  var busyUntil = 0, busyWait = 0;

  // auth: {seed: the config token it started from, refresh, access, expires (ms)}
  var auth = null;
  try { auth = JSON.parse(localStorage.getItem(AUTH)); } catch (e) {}
  if (!auth || auth.seed !== SEED || !auth.refresh) auth = SEED ? {seed: SEED, refresh: SEED, access: '', expires: 0} : null;
  function saveAuth() { try { localStorage.setItem(AUTH, JSON.stringify(auth)); } catch (e) {} }

  // 'connecting', 'online', 'offline' (no answer), 'busy' (429: too many calls), 'expired' (sign in again) or 'auth'
  // (the client isn't accepted)
  var status = SAMPLE ? 'online' : 'connecting';

  // now: {id, title, artist, album, picture and thumb (urls, '' in the sample), duration (ms), progress (ms),
  //       at (ms: when progress was), playing, device: {id, name, type, volume (0-100 or null)}}, or null when
  //       nothing is playing
  var now = null, devices = [];

  if (SAMPLE) {
    now = {id: 'sample', title: 'Fjellsang', artist: 'Kari Bremnes', album: 'Det vi har', picture: '', thumb: '',
      duration: 241000, progress: 74000, at: Date.now(), playing: true,
      device: {id: 'phone', name: 'iPhone', type: 'Smartphone', restricted: false, volume: 60}};
    devices = [now.device, {id: 'tv', name: 'Samsung The Frame', type: 'TV', restricted: false, volume: 30},
      {id: 'kitchen', name: 'Kjøkken', type: 'Speaker', restricted: false, volume: 40}];
  }

  var listeners = [];
  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  function setStatus(s) {
    if (s === status) return;
    status = s;
    changed();
  }

  /** One request; done(status, json). Status 0: no connection. form: an object sent as a POST form; body: JSON. */
  function request(method, url, form, body, token, done) {
    var x = new XMLHttpRequest(), over = false, send = null;
    x.open(method, url, true);
    x.timeout = 15000;
    if (form) {
      var parts = [];
      for (var k in form) if (form.hasOwnProperty(k)) parts.push(k + '=' + encodeURIComponent(form[k]));
      send = parts.join('&');
      x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    } else if (body) {
      send = JSON.stringify(body);
      x.setRequestHeader('Content-Type', 'application/json');
    }
    if (token) x.setRequestHeader('Authorization', 'Bearer ' + token);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      var json = null;
      try { json = JSON.parse(x.responseText); } catch (e) {}
      done(x.status, json);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(0, null); } };
    x.send(send);
  }

  // MARK: - The token

  var waiting = null;   // what waits for the access token being fetched

  /** done(token) with an access token that works for a while yet, or done('') with the status set. */
  function token(done) {
    if (!auth) { done(''); return; }
    if (auth.access && auth.expires - Date.now() > 60000) { done(auth.access); return; }
    if (waiting) { waiting.push(done); return; }
    waiting = [done];
    request('POST', 'https://accounts.spotify.com/api/token',
      {grant_type: 'refresh_token', refresh_token: auth.refresh, client_id: CLIENT}, null, null, function (s, json) {
        var out = '';
        if (s === 200 && json && json.access_token) {
          auth.access = json.access_token;
          auth.expires = Date.now() + (json.expires_in || 3600) * 1000;
          if (json.refresh_token) auth.refresh = json.refresh_token;
          saveAuth();
          out = auth.access;
        } else if (s === 400 && json && json.error === 'invalid_grant') {
          // Expired (6 months) or replaced: only signing in again helps.
          auth = null;
          try { localStorage.removeItem(AUTH); } catch (e) {}
          setStatus('expired');
        } else if (s === 400 || s === 401) {
          setStatus('auth');
        } else {
          setStatus('offline');
        }
        var all = waiting;
        waiting = null;
        for (var i = 0; i < all.length; i++) all[i](out);
      });
  }

  /** A Web API call with a fresh token; done(status, json). A 401 refreshes the token once and tries again. */
  function api(method, path, body, done, again) {
    if (Date.now() < busyUntil) { if (done) done(429, null); return; }
    token(function (t) {
      if (!t) { if (done) done(-1, null); return; }
      request(method, API + path, null, body, t, function (s, json) {
        if (s === 401 && !again && auth) { auth.expires = 0; api(method, path, body, done, true); return; }
        if (s === 429) {
          busyWait = Math.min(BUSY_MAX, busyWait ? busyWait * 2 : BUSY_MIN);
          busyUntil = Date.now() + busyWait;
          setStatus('busy');
        } else if (s === 0) setStatus('offline');
        else if (s < 500) { busyWait = 0; setStatus('online'); }
        if (done) done(s, json);
      });
    });
  }

  // MARK: - What's playing

  function deviceOf(d) {
    return d ? {id: d.id || '', name: d.name || '', type: d.type || '', restricted: !!d.is_restricted,
      volume: d.supports_volume === false ? null : (typeof d.volume_percent === 'number' ? d.volume_percent : null)} : null;
  }

  // Spotify lists a picture's sizes largest first: 640, 300 and 64 px.
  function biggest(images) { return images && images.length ? images[0].url : ''; }
  function middle(images) { return images && images.length ? images[Math.min(1, images.length - 1)].url : ''; }

  /** GET /me/player's answer as now (see the top). */
  function nowOf(p) {
    var item = p && p.item;
    if (!item) return null;
    var episode = item.type === 'episode', names = [];
    var images = episode ? item.images || (item.show && item.show.images) : item.album && item.album.images;
    for (var i = 0; !episode && item.artists && i < item.artists.length; i++) names.push(item.artists[i].name);
    return {
      id: item.id || item.uri || '',
      title: item.name || '',
      artist: episode ? (item.show && item.show.name) || '' : names.join(', '),
      album: episode ? '' : (item.album && item.album.name) || '',
      picture: biggest(images),
      thumb: middle(images),
      duration: item.duration_ms || 0,
      progress: p.progress_ms || 0,
      at: Date.now(),
      playing: !!p.is_playing,
      device: deviceOf(p.device)
    };
  }

  var lastKey = '';
  function key() {
    return now ? [now.id, now.playing, now.device && now.device.id, now.device && now.device.volume].join('|') : '';
  }

  /**
   * Tells the listeners only when the song, playing or paused, the device or its volume changed, or it jumped (moved
   * somewhere else in the song).
   */
  function settle(jumped) {
    var k = key() + '|' + status;
    if (k === lastKey && !jumped) return;
    lastKey = k;
    changed();
  }

  function fetchNow(done) {
    if (!READY || status === 'expired' || status === 'auth') { if (done) done(); return; }
    api('GET', 'me/player?additional_types=episode', null, function (s, json) {
      var was = now ? position() : 0, same = now, jumped = false;
      if (s === 200) now = nowOf(json);
      else if (s === 204) now = null;
      if (same && now && same.id === now.id) jumped = Math.abs(now.progress - was) > 3000;
      settle(jumped);
      if (done) done();
    });
  }

  function fetchDevices(done) {
    if (SAMPLE) { if (done) done(devices); return; }
    api('GET', 'me/player/devices', null, function (s, json) {
      if (s === 200 && json && json.devices) {
        devices = [];
        for (var i = 0; i < json.devices.length; i++) devices.push(deviceOf(json.devices[i]));
      }
      if (done) done(devices);
    });
  }

  /** This TV among Spotify's devices: the first TV; or null. */
  function tvDevice() {
    for (var i = 0; i < devices.length; i++) {
      var d = devices[i];
      if (d.type === 'TV') return d;
    }
    return null;
  }

  var fast = false, pollTimer = 0;
  function poll() {
    clearTimeout(pollTimer);
    if (document.hidden) return;
    fetchNow(function () { pollTimer = setTimeout(poll, Math.max(fast ? FAST : SLOW, busyUntil - Date.now())); });
  }

  // MARK: - Controls

  /** What a control's answer means: done(ok, why), why '' or 'premium', 'device' (nothing to play on), 'offline'. */
  function answer(done) {
    return function (s, json) {
      var why = '';
      if (s === 0 || s === -1) why = 'offline';
      else if (s === 403) why = 'premium';
      else if (s === 404) why = 'device';
      else if (s >= 300) why = (json && json.error && json.error.reason === 'NO_ACTIVE_DEVICE') ? 'device' : 'other';
      // Spotify takes a moment before /me/player says what it did.
      setTimeout(fetchNow, 600);
      if (done) done(!why, why);
    };
  }

  /** A change on the screen at once, before Spotify says so. */
  function guess(fn) {
    if (!now) return;
    fn(now);
    settle();
  }

  function sampleDo(fn, done) {
    guess(fn);
    if (done) setTimeout(function () { done(true, ''); }, 0);
  }

  function toggle(done) {
    var playing = now && now.playing;
    if (SAMPLE) { sampleDo(function (n) { n.progress = position(); n.at = Date.now(); n.playing = !playing; }, done); return; }
    guess(function (n) { n.progress = position(); n.at = Date.now(); n.playing = !playing; });
    api('PUT', playing ? 'me/player/pause' : 'me/player/play', null, answer(done));
  }

  function skip(dir, done) {
    if (SAMPLE) { sampleDo(function (n) { n.progress = 0; n.at = Date.now(); }, done); return; }
    api('POST', dir > 0 ? 'me/player/next' : 'me/player/previous', null, answer(done));
  }

  var volumeTimer = 0;
  /** The volume at once on the screen, to Spotify once the presses stop. */
  function volume(pct, done) {
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    guess(function (n) { if (n.device) n.device.volume = pct; });
    if (SAMPLE) { if (done) done(true, ''); return; }
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(function () { api('PUT', 'me/player/volume?volume_percent=' + pct, null, answer(done)); }, 300);
  }

  /** Moves the playing to one of Spotify's devices (from devices()); done(ok, why). */
  function playOn(device, done) {
    if (SAMPLE) { sampleDo(function (n) { n.device = device; n.playing = true; }, done); return; }
    api('PUT', 'me/player', {device_ids: [device.id], play: true}, answer(done));
  }

  /** Opens Spotify's app on the TV; done(ok). */
  function openApp(done) {
    TV.launch(APP, null, function (ok) { if (done) done(ok); });
  }

  /**
   * Moves the playing to the TV. Spotify only lists the TV while its app is open, so without it among the devices this
   * opens the app and keeps asking for a while (the app needs a few seconds to show up); done(ok, why) with why
   * 'opened' when it went by the app. The app has to stay in front: tried on The Frame (Tizen 6.5) in October 2026,
   * it stops playing once Frame TV comes back, and Spotify's Web Playback SDK doesn't run on Tizen.
   */
  function toTV(done) {
    if (SAMPLE) {
      var tv = tvDevice();
      sampleDo(function (n) { n.device = tv; n.playing = true; }, done);
      return;
    }
    fetchDevices(function () {
      var tv = tvDevice();
      if (tv) { playOn(tv, done); return; }
      openApp(function (ok) {
        if (!ok) { if (done) done(false, 'app'); return; }
        var tries = 0;
        (function look() {
          fetchDevices(function () {
            var found = tvDevice();
            if (found) api('PUT', 'me/player', {device_ids: [found.id], play: true}, answer(null));
            else if (++tries < 8) setTimeout(look, 2500);
          });
        })();
        if (done) done(true, 'opened');
      });
    });
  }

  /** Where the song is now, ms (counted on from the last answer while it plays). */
  function position() {
    if (!now) return 0;
    var p = now.progress + (now.playing ? Date.now() - now.at : 0);
    return Math.max(0, Math.min(now.duration || p, p));
  }

  if (READY) poll();
  document.addEventListener('visibilitychange', function () { if (!document.hidden && READY) poll(); });

  return {
    /** The module is on and signed in (or the browser preview, with a sample). */
    enabled: function () { return READY || SAMPLE; },
    /** The newest refresh token, for "Upload config" (Spotify may have replaced the one in the file), or ''. */
    token: function () { return auth && auth.refresh || ''; },
    sample: function () { return SAMPLE; },
    status: function () { return status; },
    /** What's playing (see now at the top), or null. */
    now: function () { return now; },
    position: position,
    /** This TV is the device playing. */
    onTV: function () {
      var tv = tvDevice();
      return !!(now && now.device && (tv ? tv.id === now.device.id : now.device.type === 'TV'));
    },
    /** Asks often while the Spotify tab is in front, seldom otherwise. */
    watch: function (on) {
      if (on === fast) return;
      fast = on;
      if (on && READY) { fetchDevices(); poll(); }
    },
    refresh: function () { if (READY && !fast) fetchNow(); },
    toggle: toggle,
    next: function (done) { skip(1, done); },
    previous: function (done) { skip(-1, done); },
    volume: volume,
    toTV: toTV,
    playOn: playOn,
    /** Spotify's devices, done(list) with this TV's marked tv: true; phones and computers only while Spotify is open. */
    devices: function (done) {
      fetchDevices(function (list) {
        var tv = tvDevice();
        for (var i = 0; i < list.length; i++) list[i].tv = list[i] === tv;
        done(list);
      });
    },
    openApp: openApp,
    app: APP,
    onChange: function (fn) { listeners.push(fn); }
  };
})();
