/*
 * Kunstmodus (AUG-1438): the Frame Art add-on on the Pi (eaugum/frame-art) decides what's on the wall; Frame TV only
 * has the buttons (AUG-1490). It asks what's showing and the mode (GET /status), for a new picture
 * (POST /next?art_mode=1) and for Art Mode (POST /artmode), and says when the screensaver starts (POST /saver); the
 * answers wait for the TV, up to a couple of minutes. Every call carries art_key (AUG-1496). On with art_url unless
 * art=false. In a desktop browser without it, sample data.
 *
 * It also tells the add-on's event log what Frame TV does (POST /event, AUG-1523): started, hidden and shown, what it
 * opened, the screensaver and errors. They wait in localStorage while the add-on doesn't answer (the TV going off
 * hides the app before a request gets out), and go when it does.
 *
 * When it starts on the TV, and every hour after, it reports what only the TV itself can read (POST /tv/report,
 * AUG-1722): the firmware, the Tizen and Chromium versions, memory, storage and the Wi-Fi signal, for the add-on's TV
 * tab; and, from the small service beside it (tizen/service/), the TV's own ECO, power and HDMI-CEC settings.
 */
var Art = (function () {
  'use strict';

  var URL = String(Settings.get('artUrl') || '').replace(/^\s+|\s+$/g, '').replace(/\/+$/, '');
  var KEY = String(Settings.get('artKey') || '').replace(/^\s+|\s+$/g, '');
  var ON = Modules.on('art');
  var SAMPLE = ON && !URL && TV.name === 'browser';
  var EVERY = 5 * 60000;
  var REPORT_EVERY = 60 * 60000;
  var SERVICE = 'org.frametv.service';

  var status = SAMPLE ? {showing: 'nasjonalmuseet: The Day After, Edvard Munch', interval_minutes: 60} : null;
  var busy = false, listeners = [];

  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  function request(method, path, timeout, done, body) {
    var x = new XMLHttpRequest();
    x.open(method, URL + path, true);
    if (KEY) x.setRequestHeader('Authorization', 'Bearer ' + KEY);
    if (body) x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = timeout;
    x.onload = function () {
      var o = null;
      try { o = JSON.parse(x.responseText); } catch (e) {}
      done(o, x.status >= 200 && x.status < 300 && !!o && o.ok !== false);
    };
    x.onerror = x.ontimeout = function () { done(null, false); };
    x.send(body ? JSON.stringify(body) : null);
  }

  // MARK: - The event log (AUG-1523)

  var QUEUE = 'artEvents', MAX_QUEUE = 300, BATCH = 50, MAX_ERRORS = 20;
  var sending = false, errors = 0, made = 0;

  function queued() {
    try { return JSON.parse(localStorage.getItem(QUEUE)) || []; } catch (e) { return []; }
  }

  function keep(q) {
    try { localStorage.setItem(QUEUE, JSON.stringify(q.slice(-MAX_QUEUE))); } catch (e) {}
  }

  /** Sends what's waiting, a batch at a time; what doesn't get through stays for the next try. */
  function send() {
    if (sending || !ON || SAMPLE || !URL) return;
    var batch = queued().slice(0, BATCH);
    if (!batch.length) return;
    sending = true;
    request('POST', '/event', 20000, function (o, ok) {
      sending = false;
      if (!ok) return;
      var sent = {};
      for (var i = 0; i < batch.length; i++) sent[batch[i].n] = true;
      var left = [], q = queued();
      for (var j = 0; j < q.length; j++) if (!sent[q[j].n]) left.push(q[j]);
      keep(left);
      if (left.length) send();
    }, {events: batch});
  }

  function event(kind, detail) {
    if (!ON || SAMPLE || !URL) return;
    var q = queued();
    q.push({n: Date.now() + '.' + (made++), at: Date.now(), kind: kind, detail: String(detail || '').slice(0, 300)});
    keep(q);
    send();
  }

  if (ON && URL && !SAMPLE) {
    event('start', 'Frame TV started');
    document.addEventListener('visibilitychange', function () {
      event(document.hidden ? 'hidden' : 'shown', document.hidden ? 'Frame TV hidden (the TV off, or another app)' :
        'Frame TV shown');
    });
    window.addEventListener('appcontrol', function () { event('reopened', 'Frame TV opened again'); });
    window.addEventListener('error', function (e) {
      if (++errors > MAX_ERRORS) return;
      var where = e.filename ? ' (' + String(e.filename).split('/').pop() + ':' + e.lineno + ')' : '';
      event('error', (e.message || 'an error') + where);
    });
    TV.onOpen(function (id, what, ok) {
      event(ok ? 'open' : 'open_failed', id + (what && what !== 'app' ? ': ' + what : '') + (ok ? '' : " (didn't open)"));
    });
  }

  // MARK: - The report for the TV tab (AUG-1722)

  /** What the TV says about itself; each part on its own, since some aren't there on every TV. done(report). */
  function readTV(done) {
    var r = {}, waiting = 0, over = false;
    function finish() { if (!over) { over = true; done(r); } }
    function ask(property, use) {
      waiting++;
      try {
        window.tizen.systeminfo.getPropertyValue(property, function (v) {
          try { use(v); } catch (e) {}
          if (--waiting === 0) finish();
        }, function () { if (--waiting === 0) finish(); });
      } catch (e) { waiting--; }
    }
    try { r.app_version = window.tizen.application.getCurrentApplication().appInfo.version; } catch (e) {}
    // Tizen's says "(KHTML, like Gecko) 85.0.4183.93/6.5 TV" rather than "Chrome/85..."
    var chrome = /(?:Chrome\/|Gecko\) )(\d+)\.\d+\.\d+\.\d+/.exec(navigator.userAgent);
    if (chrome) r.browser = 'Chromium ' + chrome[1];
    try { r.tizen = window.tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version'); } catch (e) {}
    try {
      r.memory_free = window.tizen.systeminfo.getAvailableMemory();
      r.memory_total = window.tizen.systeminfo.getTotalMemory();
    } catch (e) {}
    ask('BUILD', function (v) { r.firmware = v.buildVersion; r.model = v.model; });
    ask('STORAGE', function (v) {
      for (var i = 0; i < v.units.length; i++) {
        if (v.units[i].type === 'INTERNAL') {
          r.storage_free = v.units[i].availableCapacity;
          r.storage_total = v.units[i].capacity;
        }
      }
    });
    ask('WIFI_NETWORK', function (v) { if (v.status === 'ON') r.wifi_signal = v.signalStrength; });
    askService(r, function (n) { waiting += n; }, function () { if (--waiting === 0) finish(); });
    if (waiting === 0) finish();
    setTimeout(finish, 8000);
  }

  /** The service's answer as r.settings: {vconf key: value}, with the JSON strings among them parsed, so the report
   * stays small. Not installed (or an older TV): nothing. */
  function askService(r, start, end) {
    var control;
    try {
      control = new window.tizen.ApplicationControl('http://tizen.org/appcontrol/operation/default', null, null, null,
        []);
    } catch (e) { return; }
    var over = false;
    function done() { if (!over) { over = true; end(); } }
    start(1);
    function got(data) {
      for (var i = 0; i < (data || []).length; i++) {
        if (data[i].key !== 'settings') continue;
        try {
          var all = JSON.parse(data[i].value[0]);
          for (var k in all) {
            if (typeof all[k] === 'string' && /^\s*[\[{]/.test(all[k])) {
              try { all[k] = JSON.parse(all[k]); } catch (e) {}
            }
          }
          r.settings = all;
        } catch (e) {}
      }
      done();
    }
    try {
      window.tizen.application.launchAppControl(control, SERVICE, null, done, {onsuccess: got, onfailure: done});
    } catch (e) { done(); }
  }

  function report() {
    if (!ON || SAMPLE || !URL || TV.name === 'browser' || !window.tizen) return;
    readTV(function (r) { request('POST', '/tv/report', 20000, function () {}, r); });
  }

  function refresh() {
    if (!ON || SAMPLE || !URL) return;
    send();
    request('GET', '/status', 10000, function (o) {
      if (o) { status = o; changed(); }
    });
  }

  function act(path, done) {
    if (SAMPLE) { setTimeout(function () { done(true); }, 800); return; }
    if (busy) { done(false); return; }
    busy = true;
    request('POST', path, 180000, function (o, ok) {
      busy = false;
      if (o) { status = o; changed(); }
      done(ok);
    });
  }

  if (ON && URL) { refresh(); setInterval(refresh, EVERY); report(); setInterval(report, REPORT_EVERY); }

  return {
    enabled: function () { return ON && (!!URL || SAMPLE); },
    sample: function () { return SAMPLE; },
    /** "Title, Artist" of what's on the TV, or ''. */
    showing: function () {
      var s = status && status.showing || '';
      var c = s.indexOf(': ');
      return c < 0 ? s : s.slice(c + 2);
    },
    minutes: function () { return status ? status.interval_minutes : 0; },
    /** 'shuffle', 'category' or 'fixed' (a picture chosen on the add-on's page, until the next Morgenbildet). */
    mode: function () { return status && status.mode || 'shuffle'; },
    category: function () { return status && status.category || ''; },
    busy: function () { return busy; },
    /** False when the screensaver is switched off in Home Assistant (switch.frame_art_screensaver). */
    saverAllowed: function () { return !(status && status.settings && status.settings.screensaver === false); },
    /** A new picture, and the TV in Art Mode. done(ok). */
    next: function (done) { act('/next?art_mode=1', done); },
    /** Art Mode, with the picture it has. done(ok). */
    artMode: function (done) { act('/artmode', done); },
    /** The screensaver started: the add-on puts the TV in Art Mode, a new picture every `minutes`. done(ok); without
     * it, Frame TV shows its own. */
    saver: function (minutes, done) {
      if (!ON || SAMPLE || !URL || busy) { done(false); return; }
      request('POST', '/saver?minutes=' + minutes, 60000, function (o, ok) {
        if (o) { status = o; changed(); }
        done(ok);
      });
    },
    onChange: function (f) { listeners.push(f); },
    /** One event for the add-on's log: kind a short word, detail what happened, in words. */
    event: event
  };
})();
