/*
 * YouTube on the home screen (AUG-1441): our own playlist for the TV, and new videos from the channels we subscribe to
 * (Watch Later can't be read: Google closed it to the API in 2016). On with youtube_client_id and
 * youtube_client_secret in config.properties (a Google OAuth client of the type "TVs and Limited Input devices")
 * unless youtube=false. The TV signs in once from Home Settings → YouTube: Google's device flow, a code entered at
 * google.com/device, read-only (youtube.readonly). The refresh token stays in localStorage on the TV.
 * The subscriptions and our playlists are read once a day; on every refresh, the playlist picked in Home Settings (by
 * default one called "Fram TV" or "Frame TV") and each channel's newest long videos (its UULF playlist, so no Shorts),
 * with their length and pictures from videos.list. That costs a unit per channel, so with many channels it
 * asks less often, to stay well inside the API's 10,000 units a day. The last answer stays in localStorage; an error
 * keeps it, and a token Google no longer accepts signs out.
 * Until it's signed in it shows made-up sample videos, so the places it fills can be seen.
 */
var YouTube = (function () {
  'use strict';

  var CLIENT = Settings.get('youtubeClientId').replace(/^\s+|\s+$/g, '');
  var SECRET = Settings.get('youtubeClientSecret').replace(/^\s+|\s+$/g, '');
  var ON = Modules.on('youtube'), READY = ON && !!CLIENT && !!SECRET;
  var AUTH = 'fmtv.youtube.auth', CACHE = 'fmtv.youtube';
  var SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
  var API = 'https://www.googleapis.com/youtube/v3/';
  var MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  var EVERY = 30 * MIN, BUDGET = 8000, RECENT = 14 * DAY, PER_CHANNEL = 2, MAX = 40, PARALLEL = 4, SAVED = 50;

  // title, channel, how long ago, length (s), the channel's color (the cards are drawn: no pictures to fetch)
  var SAMPLE = [
    ['The quietest keyboard I have ever tested', 'Desk Setup Weekly', 3 * HOUR, 754, '#3F6FD8'],
    ['Why the fjords never freeze', 'Science Explained', 9 * HOUR, 1121, '#1E9E8C'],
    ['Restoring a 1970s Tandberg radio', 'Workshop North', 26 * HOUR, 1987, '#C8742B'],
    ['Five weeknight dinners in 20 minutes', 'Kitchen Lab', 2 * DAY, 862, '#D2483E'],
    ['A week alone in a mountain cabin', 'Fjellturer', 3 * DAY, 2410, '#5E8F3A'],
    ['Every Zelda game, ranked', 'Retro Games Daily', 5 * DAY, 3105, '#8A4FD0']
  ];

  // auth: {refresh, access, expires (ms), name}
  // data: {channels: [{id, title, all: true when it has no UULF playlist}], playlists: [{id, title}], channelsAt,
  //        videos and saved (the playlist, last added first): [{id, title, channel, at, duration (s), views, thumb,
  //        picture}], savedFor: the playlist saved is from, at}
  function empty() { return {channels: [], playlists: [], channelsAt: 0, videos: [], saved: [], savedFor: '', at: 0}; }
  var auth = null, data = empty();
  try {
    auth = JSON.parse(localStorage.getItem(AUTH));
    var c = JSON.parse(localStorage.getItem(CACHE));
    if (auth && c && c.client === CLIENT && c.data && c.data.playlists) data = c.data;
    if (data.saved.length && !data.savedFor) data.at = 0;   // a cache from before savedFor: ask again at once
  } catch (e) {}
  if (!auth || !auth.refresh) auth = null;
  // A sign-in sent to config.properties (AUG-1521): a new one there wins once, so signing out on the TV stays.
  var SEED = Settings.get('youtubeRefreshToken'), SEEDED = 'fmtv.youtube.seed';
  try {
    if (SEED && localStorage.getItem(SEEDED) !== SEED) {
      if (!auth || auth.refresh !== SEED) { auth = {refresh: SEED, access: '', expires: 0, name: ''}; data = empty(); }
      localStorage.setItem(SEEDED, SEED);
      localStorage.setItem(AUTH, JSON.stringify(auth));
    }
  } catch (e) {}

  function saveAuth() { try { localStorage.setItem(AUTH, JSON.stringify(auth)); } catch (e) {} }
  function save() { try { localStorage.setItem(CACHE, JSON.stringify({client: CLIENT, data: data})); } catch (e) {} }

  var listeners = [];
  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  /** One request; done(status, json). Status 0: no connection. form: an object sent as a POST form. */
  function request(url, form, token, done) {
    var x = new XMLHttpRequest(), over = false, body = null;
    x.open(form ? 'POST' : 'GET', url, true);
    x.timeout = 15000;
    if (form) {
      var parts = [];
      for (var k in form) if (form.hasOwnProperty(k)) parts.push(k + '=' + encodeURIComponent(form[k]));
      body = parts.join('&');
      x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
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
    x.send(body);
  }

  /** Signed out: Google no longer takes the token, or the person signed out here. */
  function forget() {
    auth = null;
    data = empty();
    try { localStorage.removeItem(AUTH); localStorage.removeItem(CACHE); } catch (e) {}
    changed();
  }

  // MARK: - Signing in (Google's device flow)

  var pairing = null, pollTimer = 0;

  /** Asks Google for a code; done(error) when it couldn't. The code is in pairing() until it's entered. */
  function link(done) {
    cancel();
    request('https://oauth2.googleapis.com/device/code', {client_id: CLIENT, scope: SCOPE}, null, function (status, json) {
      if (status !== 200 || !json || !json.device_code) { done(new Error(status === 0 ? 'offline' : 'refused')); return; }
      pairing = {code: json.user_code, url: json.verification_url || 'https://www.google.com/device',
        device: json.device_code, every: (json.interval || 5) * 1000, expiresAt: Date.now() + (json.expires_in || 1800) * 1000};
      done(null);
      changed();
      poll();
    });
  }

  function poll() {
    pollTimer = setTimeout(function () {
      if (!pairing) return;
      var p = pairing;
      request('https://oauth2.googleapis.com/token', {client_id: CLIENT, client_secret: SECRET, device_code: p.device,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'}, null, function (status, json) {
        if (pairing !== p) return;
        var error = json && json.error;
        if (status === 200 && json && json.refresh_token) {
          auth = {refresh: json.refresh_token, access: json.access_token, expires: Date.now() + (json.expires_in || 3600) * 1000, name: ''};
          saveAuth();
          pairing = null;
          data.at = 0;
          data.channelsAt = 0;
          changed();
          whoAmI();
          refresh(true);
          return;
        }
        if (error === 'slow_down') p.every += 5000;
        if (error === 'access_denied' || error === 'expired_token' || Date.now() > p.expiresAt) {
          pairing = null;   // home.js offers a new code
          changed();
          return;
        }
        poll();
      });
    }, pairing.every);
  }

  function cancel() {
    clearTimeout(pollTimer);
    pairing = null;
  }

  /** The account's channel name, for Home Settings. */
  function whoAmI() {
    withToken(function (token) {
      if (!token) return;
      request(API + 'channels?part=snippet&mine=true&fields=items/snippet/title', null, token, function (status, json) {
        if (status !== 200 || !auth || !json || !json.items || !json.items.length) return;
        auth.name = json.items[0].snippet.title || '';
        saveAuth();
        changed();
      });
    });
  }

  /** A valid access token, refreshed when it's about to run out; done(token), or done(null). */
  function withToken(done) {
    if (!auth) { done(null); return; }
    if (auth.access && auth.expires - Date.now() > MIN) { done(auth.access); return; }
    request('https://oauth2.googleapis.com/token', {client_id: CLIENT, client_secret: SECRET, refresh_token: auth.refresh,
      grant_type: 'refresh_token'}, null, function (status, json) {
      if (!auth) { done(null); return; }
      if (status === 200 && json && json.access_token) {
        auth.access = json.access_token;
        auth.expires = Date.now() + (json.expires_in || 3600) * 1000;
        saveAuth();
        done(auth.access);
        return;
      }
      if (json && json.error === 'invalid_grant') forget();   // revoked, or signed in elsewhere too often
      done(null);
    });
  }

  // MARK: - What it shows

  var busy = false, failedAt = 0, problem = '';

  /** How often to ask: every half hour, or less often when the channels would use too much of the day's quota. */
  function every() {
    return Math.max(EVERY, Math.ceil(DAY * (data.channels.length + 4) / BUDGET));
  }

  /** The playlist to show: the one picked in Home Settings, or one called "Fram TV" or "Frame TV"; null without. */
  function playlist() {
    var picked = Prefs.youtubePlaylist(), i;
    for (i = 0; i < data.playlists.length; i++) if (data.playlists[i].id === picked) return data.playlists[i];
    for (i = 0; i < data.playlists.length; i++) {
      if (/^frame? ?tv$/i.test(data.playlists[i].title.replace(/^\s+|\s+$/g, ''))) return data.playlists[i];
    }
    return null;
  }

  /** "PT1H2M3S" → seconds. */
  function seconds(iso) {
    var m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
    return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0;
  }

  function api(path, token, done) { request(API + path, null, token, done); }

  /** Every subscription, 50 at a time; done(channels) or done(null). */
  function subscriptions(token, done) {
    var out = [], pages = 0;
    function page(next) {
      api('subscriptions?part=snippet&mine=true&maxResults=50&order=alphabetical'
          + '&fields=nextPageToken,items(snippet(title,resourceId/channelId))' + (next ? '&pageToken=' + next : ''), token,
      function (status, json) {
        if (status !== 200 || !json) { done(null, status); return; }
        var items = json.items || [];
        for (var i = 0; i < items.length; i++) {
          var s = items[i].snippet, id = s && s.resourceId && s.resourceId.channelId;
          if (id) out.push({id: id, title: s.title || ''});
        }
        if (json.nextPageToken && ++pages < 20) page(json.nextPageToken);
        else done(out);
      });
    }
    page('');
  }

  /** Our own playlists; done(list) or done(null, status). */
  function playlists(token, done) {
    api('playlists?part=snippet&mine=true&maxResults=50&fields=items(id,snippet/title)', token, function (status, json) {
      if (status !== 200 || !json) { done(null, status); return; }
      var out = [], items = json.items || [];
      for (var i = 0; i < items.length; i++) out.push({id: items[i].id, title: items[i].snippet ? items[i].snippet.title || '' : ''});
      done(out);
    });
  }

  /** A playlist's videos, last added first, [{id, added}]; done([]) without a playlist. */
  function savedItems(list, token, done) {
    var out = [], pages = 0;
    if (!list) { done(out); return; }
    function page(next) {
      api('playlistItems?part=snippet&maxResults=50&playlistId=' + list.id
          + '&fields=nextPageToken,items(snippet(publishedAt,resourceId/videoId))' + (next ? '&pageToken=' + next : ''), token,
      function (status, json) {
        if (status === 404) { done([]); return; }   // deleted since we read the playlists
        if (status !== 200 || !json) { done(null, status); return; }
        var items = json.items || [];
        for (var i = 0; i < items.length; i++) {
          var s = items[i].snippet, id = s && s.resourceId && s.resourceId.videoId;
          if (id) out.push({id: id, added: Date.parse(s.publishedAt || '') || 0});
        }
        if (json.nextPageToken && ++pages < 4) { page(json.nextPageToken); return; }
        out.sort(function (a, b) { return b.added - a.added; });
        done(out.slice(0, SAVED));
      });
    }
    page('');
  }

  /** A channel's newest uploads, [{id, at}]: its long videos (UULF), or all of them when it has no such playlist. */
  function uploads(channel, token, done) {
    var rest = channel.id.slice(2);
    api('playlistItems?part=contentDetails&maxResults=' + (PER_CHANNEL + 1) + '&playlistId=' + (channel.all ? 'UU' : 'UULF') + rest
        + '&fields=items/contentDetails(videoId,videoPublishedAt)', token, function (status, json) {
      if (status === 404 && !channel.all) { channel.all = true; uploads(channel, token, done); return; }
      if (status !== 200 || !json) { done(null, status); return; }
      var out = [], items = json.items || [];
      for (var i = 0; i < items.length; i++) {
        var d = items[i].contentDetails;
        if (d && d.videoId) out.push({id: d.videoId, at: Date.parse(d.videoPublishedAt || '') || 0, channel: channel});
      }
      done(out);
    });
  }

  /** The channels' uploads, a few at a time; done(list, status of a failure or 0). */
  function allUploads(token, done) {
    var list = data.channels, next = 0, running = 0, out = [], failed = 0;
    if (!list.length) { done(out, 0); return; }
    function start() {
      while (running < PARALLEL && next < list.length && !failed) {
        running++;
        uploads(list[next++], token, function (items, status) {
          running--;
          if (items) out = out.concat(items);
          else if (status !== 404) failed = status || -1;   // a channel without uploads is no error
          if ((next >= list.length || failed) && !running) done(out, failed);
          else start();
        });
      }
    }
    start();
  }

  function thumb(t, sizes) {
    for (var i = 0; t && i < sizes.length; i++) if (t[sizes[i]] && t[sizes[i]].url) return t[sizes[i]].url;
    return '';
  }

  /**
   * Titles, lengths and pictures for these videos, 50 at a time; done({id: video}) or done(null). A video that's live,
   * not out yet, private or gone is left out, and so is a Short from a channel without a UULF playlist.
   */
  function details(wanted, token, done) {
    var out = {}, at = 0, byId = {}, ids = [];
    for (var i = 0; i < wanted.length; i++) {
      if (!byId[wanted[i].id]) ids.push(wanted[i].id);
      byId[wanted[i].id] = wanted[i];
    }
    function batch() {
      if (at >= ids.length) { done(out); return; }
      var some = ids.slice(at, at + 50);
      at += 50;
      api('videos?part=snippet,contentDetails,statistics&id=' + some.join(',')
          + '&fields=items(id,snippet(title,channelTitle,publishedAt,liveBroadcastContent,thumbnails),'
          + 'contentDetails/duration,statistics/viewCount)', token, function (status, json) {
        if (status !== 200 || !json) { done(null, status); return; }
        var items = json.items || [];
        for (var j = 0; j < items.length; j++) {
          var v = items[j], s = v.snippet || {}, up = byId[v.id], length = seconds(v.contentDetails && v.contentDetails.duration);
          if (s.liveBroadcastContent && s.liveBroadcastContent !== 'none') continue;   // live now, or not yet
          if (up && up.channel && up.channel.all && length <= 180) continue;
          out[v.id] = {id: v.id, title: s.title || '', channel: s.channelTitle || (up && up.channel ? up.channel.title : ''),
            at: up && up.at || Date.parse(s.publishedAt || '') || 0, duration: length,
            views: +(v.statistics && v.statistics.viewCount) || 0,
            thumb: thumb(s.thumbnails, ['high', 'medium', 'default']),
            picture: thumb(s.thumbnails, ['maxres', 'standard', 'high'])};
        }
        batch();
      });
    }
    batch();
  }

  /** The newest uploads: at most two per channel from the last two weeks, newest first. */
  function pick(list, now) {
    list.sort(function (a, b) { return b.at - a.at; });
    var out = [], per = {};
    for (var i = 0; i < list.length && out.length < MAX; i++) {
      var v = list[i];
      if (now - v.at > RECENT) continue;
      per[v.channel.id] = (per[v.channel.id] || 0) + 1;
      if (per[v.channel.id] <= PER_CHANNEL) out.push(v);
    }
    return out;
  }

  function failed(status) {
    busy = false;
    failedAt = Date.now();
    problem = status === 403 ? 'quota' : status === 0 || status === -1 ? 'offline' : 'error';
    changed();
  }

  function refresh(force) {
    if (!READY || !auth || busy) return;
    var now = Date.now();
    if (!force && now - data.at < every() && now >= data.at) return;
    if (!force && failedAt && now - failedAt < 5 * MIN) return;
    busy = true;
    withToken(function (token) {
      if (!token) { if (auth) failed(0); else busy = false; return; }
      var fresh = now - data.channelsAt < DAY && now >= data.channelsAt && data.channels.length;
      if (fresh && playlist()) videos(token);
      else if (fresh) {
        // No playlist to show yet: look again, so one made on the phone comes within the half hour.
        playlists(token, function (lists, status) {
          if (!lists) { failed(status); return; }
          data.playlists = lists;
          videos(token);
        });
      } else {
        subscriptions(token, function (channels, status) {
          if (!channels) { failed(status); return; }
          playlists(token, function (lists, s2) {
            if (!lists) { failed(s2); return; }
            var was = {};
            for (var i = 0; i < data.channels.length; i++) was[data.channels[i].id] = data.channels[i].all;
            for (i = 0; i < channels.length; i++) if (was[channels[i].id]) channels[i].all = true;
            data.channels = channels;
            data.playlists = lists;
            data.channelsAt = Date.now();
            videos(token);
          });
        });
      }
    });
  }

  /** The videos of these ids that details() found, in the same order. */
  function found(list, byId) {
    var out = [];
    for (var i = 0; i < list.length; i++) if (byId[list[i].id]) out.push(byId[list[i].id]);
    return out;
  }

  /** Keeps a playlist's videos, unless another one was picked while they were asked for. */
  function keepSaved(list, saved, byId) {
    var now = playlist();
    if (!list || !now || now.id !== list.id) return;
    data.saved = found(saved, byId);
    data.savedFor = list.id;
  }

  /** Just the playlist's videos: a newly picked playlist shows at once, without asking every channel again. */
  function refreshSaved() {
    var list = playlist();
    withToken(function (token) {
      if (!token) return;
      savedItems(list, token, function (saved) {
        if (!saved) return;
        details(saved, token, function (byId) {
          if (!byId) return;
          keepSaved(list, saved, byId);
          save();
          changed();
        });
      });
    });
  }

  function videos(token) {
    var list = playlist();
    savedItems(list, token, function (saved, s1) {
      if (!saved) { failed(s1); return; }
      allUploads(token, function (list, status) {
        if (status) { failed(status); return; }   // keep the last answer rather than half of one
        var picked = pick(list, Date.now());
        details(saved.concat(picked), token, function (byId, s2) {
          if (!byId) { failed(s2); return; }
          keepSaved(list, saved, byId);
          data.videos = found(picked, byId);
          data.at = Date.now();
          busy = false;
          failedAt = 0;
          problem = '';
          save();
          changed();
        });
      });
    });
  }

  function samples() {
    var now = Date.now();
    return SAMPLE.map(function (v, i) {
      return {id: 'sample-' + i, title: v[0], channel: v[1], at: now - v[2], duration: v[3], color: v[4]};
    });
  }

  return {
    /** The module is on (youtube=true, the client in config.properties, or the browser preview). */
    enabled: function () { return ON; },
    /** It can sign in: config.properties has the OAuth client. */
    ready: function () { return READY; },
    linked: function () { return READY && !!auth; },
    /** The sign-in's refresh token, for "Upload config", or ''. */
    token: function () { return auth && auth.refresh || ''; },
    /** The account's channel name, or ''. */
    name: function () { return auth ? auth.name || '' : ''; },
    /** The videos are made up: it isn't signed in. */
    sample: function () { return !this.linked(); },
    /** '' or why the last refresh failed: 'quota', 'offline' or 'error'. */
    problem: function () { return problem; },
    /** Newest first: [{id, title, channel, at (ms), duration (s), views, thumb, picture}], or the samples with a color. */
    videos: function () { return this.linked() ? data.videos : samples(); },
    /** The playlist's videos, last added first (as videos()); [] without one. */
    saved: function () {
      var list = playlist();
      return this.linked() && list && data.savedFor === list.id ? data.saved : [];
    },
    /** The playlist shown ({id, title}) or null, and all of ours to pick from. */
    playlist: playlist,
    playlists: function () { return this.linked() ? data.playlists : []; },
    /** Shows another of our playlists (its id), and asks for its videos at once. */
    choose: function (id) {
      Prefs.set('youtubePlaylist', id);
      changed();
      refreshSaved();
    },
    /** {code, url, expiresAt} while a code waits to be entered, or null. */
    pairing: function () { return pairing; },
    link: link,
    cancel: cancel,
    /** Signs out, and tells Google to forget the token. */
    unlink: function () {
      if (auth) request('https://oauth2.googleapis.com/revoke', {token: auth.refresh}, null, function () {});
      cancel();
      forget();
    },
    refresh: refresh,
    onChange: function (fn) { listeners.push(fn); }
  };
})();
