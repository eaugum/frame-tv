/*
 * The TV's side of the home screen: its apps, opening one, its settings, the Back key, its time zone.
 *  - Samsung Tizen: Tizen's web APIs (tizen.application).
 *  - A desktop browser: a stand-in with sample apps, so the screen can be previewed and tested on a computer.
 * Plain ES5: Tizen 3 runs a Chromium from 2017.
 */
var TV = (function () {
  'use strict';

  var samsung = typeof window.tizen !== 'undefined' && !!window.tizen.application;

  // Not shown among Samsung's apps: Smart Hub's own pieces, the platform's tools and players (but its browser,
  // Netflix and Prime Video, which live there too), services, keyboards and ad players. The rest is what Smart Hub shows.
  // Tizen 4 also lists Samsung's own pieces: the YouTube engine's hosts (cobalt-*: "App", "Youtube", "YoutubeTV"),
  // Bixby, search, previews, the weather and notification popups, Apple TV's stand-in and engine (the app itself is
  // com.samsung.tv.aria-video).
  // A 2020 TU8000 (Tizen 5.5) ships Prime Video as org.tizen.primevideo, next to a -dummy and a _companionapp.
  // A 2023 Q60C (Tizen 9 in Brazil) ships Globoplay as org.tizen.globoplayapp.
  var SAMSUNG_HIDDEN = new RegExp('^(org\\.volt\\.|org\\.tizen\\.(?!browser$|netflix|primevideo$|globoplay)|org\\.tizen\\.netflixlowmem$|ise-|ug-|d75857a5-)' +
      '|[Ss]ervice$|[Dd]aemon|Preview$|syspopup|[Hh]elper$|AdPlayer|AdSuite|[Kk]eyboard|\\.OTApp$' +
      '|^com\\.samsung\\.(calendar-account-manager|tv\\.(cobalt-|aria-(dummy|engine)|airplay-app|ambient-support|' +
      'built-in-app-info-viewer|commonsearch|searchall|preview-|tv-scheduler|csfs|notification-app|mycontents|' +
      'safLaunchBridge|shortcut|remote-workspace|voiceassistant|mybixby|weather-viewer))');

  // Samsung apps whose iconPath is Tizen's generic pinwheel (a valid image, so onerror never fires): our own icons.
  // Seen on a 2018 NU7675 (Tizen 4); Smart Hub draws their real icons from a folder apps can't read. On a 2017
  // MU6100 (Tizen 3) no iconPath loads at all, so common apps get a logo here: Simple Icons' (CC0), cropped and tinted
  // for the tiles, with a width and height so old WebKit sizes them like PNGs.
  var SAMSUNG_ICONS = {
    '9Ur5IzDKqV.TizenYouTube': 'icons/youtube.png',
    'evKhCgZelL.AmazonIgnitionLauncher2': 'icons/prime.png',
    'org.tizen.primevideo': 'icons/prime.png',
    'RN1MCdNq8t.Netflix': 'icons/netflix.svg',
    'org.tizen.netflix-app': 'icons/netflix.svg',
    'NvZ26VG9Yw.HBOGOLAG': 'icons/max.svg',
    '5b8c3eb16b.BeamCTVDev': 'icons/max.svg',
    'com.samsung.tv.aria-video': 'icons/appletv.svg',
    'MCmYXNxgcu.DisneyPlus': 'icons/disneyplus.svg',
    'rJeHak5zRg.Spotify': 'icons/spotify.svg',
    'cexr1qp97S.Deezer': 'icons/deezer.svg',
    '5SLwh7m3En.TizenYouTubeKids': 'icons/youtubekids.svg',
    '4OAwqypfRT.RedBullTV': 'icons/redbull.svg',
    'UCJa2s9hhC.TED': 'icons/ted.svg',
    'QizQxC7CUf.PlayMovies': 'icons/googleplay.svg',
    'vIutycUzou.SteamLink': 'icons/steam.svg',
    'geUOM7qimf.FOXPlay': 'icons/fox.svg',
    'AprZAARz4r.Jellyfin': 'icons/jellyfin.svg'
  };

  // Names Smart Hub gets wrong: HBO's app has none (so it never reached the shelf), others are long or old.
  var SAMSUNG_TITLES = {
    'NvZ26VG9Yw.HBOGOLAG': 'Max',
    'rJeHak5zRg.Spotify': 'Spotify',
    'evKhCgZelL.AmazonIgnitionLauncher2': 'Prime Video',
    'org.tizen.globoplayapp': 'Globoplay'
  };

  // Samsung's settings menu on Tizen 3, which answers no "settings" app control.
  var SAMSUNG_MENU = 'org.tizen.menu';

  // The browser's stand-in: the services in the default app library (ids as on a The Frame from 2022), and two more.
  var SAMPLE = [
    ['com.samsung.tv.aria-video', 'Apple TV', '#1C1C1E'], ['PyZfkXAf88.tv2sumoTizen', 'TV 2 Play', '#1F35D6'],
    ['niYSnzL6h1.Viaplay', 'Viaplay', '#E8175D'], ['org.tizen.netflix-app', 'Netflix', '#E50914'],
    ['9Ur5IzDKqV.TizenYouTube', 'YouTube', '#FF0033'], ['5b8c3eb16b.BeamCTVDev', 'HBO Max', '#6C3BE0'],
    ['MCmYXNxgcu.DisneyPlus', 'Disney+', '#1838C8'], ['n8N84lD1cR.NRKTVBeta', 'NRK TV', '#13253F'],
    ['org.tizen.primevideo', 'Prime Video', '#1A98FF'], ['vGtV7app01.VGTV', 'VG TV', '#E11F26'],
    ['rJeHak5zRg.Spotify', 'Spotify', '#1DB954'], ['org.tizen.browser', 'Internet', '#3A7BD5']
  ];

  var self = '';
  if (samsung) {
    try { self = window.tizen.application.getCurrentApplication().appInfo.id; } catch (e) {}
  }

  // MARK: - Samsung

  function samsungApps(done) {
    try {
      window.tizen.application.getAppsInfo(function (list) {
        var out = [];
        // App ids named in apps (config.properties) stay even with show false, and are looked up when the list leaves
        // them out: Moonlight, installed in Developer Mode on a 2023 Q60C (Tizen 9), never reached the shelf though
        // Smart Hub lists it. Only whole ids, so a name in apps can't bring back the platform's hidden pieces.
        var ids = Settings.get('apps').filter(function (w) { return w.indexOf('.') > 0; });
        for (var i = 0; i < list.length; i++) {
          var a = list[i];
          if (!a.id || a.id === self || SAMSUNG_HIDDEN.test(a.id) || (a.show === false && ids.indexOf(a.id) < 0)) continue;
          out.push(samsungApp(a));
        }
        ids.forEach(function (id) {
          if (out.some(function (x) { return x.id === id; })) return;
          try { out.push(samsungApp(window.tizen.application.getAppInfo(id))); } catch (e) {}
        });
        // The built-in Netflix stays only when the store's Netflix isn't installed.
        var store = out.some(function (x) { return /\.Netflix$/.test(x.id); });
        if (store) out = out.filter(function (x) { return x.id.indexOf('org.tizen.netflix') !== 0; });
        // Smart Hub keeps its own order, which isn't readable: the same alphabetical order as All Apps elsewhere.
        out.sort(function (x, y) { var a = x.title.toLowerCase(), b = y.title.toLowerCase(); return a < b ? -1 : a > b ? 1 : 0; });
        done(out);
      }, function () { done([]); });
    } catch (e) {
      done([]);
    }
  }

  function samsungApp(a) {
    var icon = a.iconPath || '';
    if (icon && icon.indexOf('://') < 0) icon = 'file://' + icon;
    if (SAMSUNG_ICONS[a.id]) icon = SAMSUNG_ICONS[a.id];
    return {id: a.id, title: SAMSUNG_TITLES[a.id] || a.name || a.id, icon: icon, color: ''};
  }

  function samsungLaunch(id, done) {
    try {
      window.tizen.application.launch(id, function () { if (done) done(true); }, function () { if (done) done(false); });
    } catch (e) {
      if (done) done(false);
    }
  }

  // MARK: - Deep links (AUG-1433)

  // What Smart Hub sends when a preview tile is picked: eden_resume, with the app's own action_data under PAYLOAD,
  // wrapped as {"values": action_data}. Each app reads its own action_data; these are the forms seen in
  // JustWatch's Tizen links. ids is Stasera's streamingIds (the service's id for the show or movie, from Wikidata).
  // Tried on The Frame (Tizen 6.5) in October 2026: Netflix, Disney+, Max, NRK TV and TV 2 Play open only the app
  // whatever they're sent. A cold start stops at the profile picker and drops the title; once past it, it opens.
  var RESUME = 'http://samsung.com/appcontrol/operation/eden_resume';
  var RECIPES = {
    prime: function (ids) {
      // Only the GTI opens a title; the 26-character ids Wikidata also has don't.
      return /^amzn1\.dv\.gti\./.test(ids.primeVideo || '') ? ids.primeVideo : null;
    },
    appletv: function (ids, kind) {
      return ids.appleTv ? 'https://tv.apple.com/' + (kind === 'movie' ? 'movie' : 'show') + '/' + ids.appleTv : null;
    },
    youtube: function (ids, kind, item) {
      return /^[\w-]{11}$/.test(item.videoId || '') ? 'v=' + item.videoId : null;
    }
  };

  /** The action_data that opens item in service's app, or null. */
  function actionData(service, item) {
    var recipe = RECIPES[service];
    return recipe && item ? recipe(item.streamingIds || {}, item.kind, item) : null;
  }

  function samsungResume(id, data, done) {
    try {
      var payload = new window.tizen.ApplicationControlData('PAYLOAD', [JSON.stringify({values: data})]);
      var control = new window.tizen.ApplicationControl(RESUME, null, null, null, [payload]);
      window.tizen.application.launchAppControl(control, id, function () { if (done) done(true); },
        function () { samsungLaunch(id, done); });
    } catch (e) {
      samsungLaunch(id, done);
    }
  }

  /** Samsung's settings: whichever app answers the platform's "settings" request, else the TV's menu (Tizen 3). */
  function samsungSettings(done) {
    function menu() { samsungLaunch(SAMSUNG_MENU, done); }
    try {
      var control = new window.tizen.ApplicationControl('http://tizen.org/appcontrol/operation/setting', null, null, null, []);
      window.tizen.application.launchAppControl(control, null, function () { if (done) done(true); }, menu);
    } catch (e) {
      menu();
    }
  }

  // MARK: - The TV, whichever it is

  // Told of everything opened, for Frame Art's event log (AUG-1523): f(id, what, ok)
  var openers = [];
  function told(id, what, done) {
    return function (ok) {
      for (var i = 0; i < openers.length; i++) {
        try { openers[i](id, what, ok); } catch (e) {}
      }
      if (done) done(ok);
    };
  }

  function launch(id, done) {
    if (samsung) { samsungLaunch(id, done); return; }
    if (done) setTimeout(function () { done(true); }, 0);
  }

  return {
    name: samsung ? 'tizen' : 'browser',

    /** Installed apps, as Smart Hub lists them: [{id, title, icon, color}]. */
    apps: function (done) {
      if (samsung) { samsungApps(done); return; }
      done(SAMPLE.map(function (s) { return {id: s[0], title: s[1], icon: SAMSUNG_ICONS[s[0]] || '', color: s[2]}; }));
    },

    /** Opens an app; done(ok). */
    launch: function (id, params, done) {
      launch(id, told(id, 'app', done));
    },

    /**
     * Opens a title in its app: service is Data's key ('netflix', 'prime'...), item a title from Stasera with kind and
     * streamingIds, or a video with videoId. Without a recipe or an id, it opens the app. done(ok).
     */
    deepLink: function (id, service, item, done) {
      var data = actionData(service, item);
      if (!data) { launch(id, told(id, 'app', done)); return; }
      done = told(id, item && item.title ? item.title : item && item.videoId ? 'video ' + item.videoId : service, done);
      if (samsung) { samsungResume(id, data, done); return; }
      if (done) setTimeout(function () { done(true); }, 0);
    },

    /** The TV's own settings; done(ok). */
    settings: function (done) {
      done = told('settings', 'the TV\'s settings', done);
      if (samsung) samsungSettings(done);
      else done(true);
    },

    /** f(id, what, ok) after each launch, deep link or settings. */
    onOpen: function (f) { openers.push(f); },

    /** Back on the first screen: back to wherever the person came from. */
    back: function () {
      if (!samsung) return;
      try { window.tizen.application.getCurrentApplication().hide(); } catch (e) {}
    },

    /** The TV's time zone ("Europe/Oslo"), or ''. */
    zone: function () {
      if (samsung) {
        try { return window.tizen.time.getLocalTimezone() || ''; } catch (e) {}
      }
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
    },

    /**
     * Key codes: the arrows, OK and the remote's Back (10009; Escape in a browser), and on Samsung the media keys
     * (they reach the app only once mediaKeys() has asked for them).
     */
    keys: {left: 37, up: 38, right: 39, down: 40, ok: 13, back: samsung ? 10009 : 27,
      media: samsung ? {playPause: 10252, play: 415, pause: 19, next: 10233, previous: 10232} : null},

    /** Asks the TV for the remote's media keys (play, pause, the skips). */
    mediaKeys: function () {
      if (!samsung || !window.tizen.tvinputdevice) return;
      var names = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaTrackNext', 'MediaTrackPrevious'];
      for (var i = 0; i < names.length; i++) {
        try { window.tizen.tvinputdevice.registerKey(names[i]); } catch (e) {}
      }
    }
  };
})();
