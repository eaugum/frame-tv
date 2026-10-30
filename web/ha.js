/*
 * Home Assistant on the home screen (AUG-1437), over HA's WebSocket API (no CORS there, unlike its REST API):
 * subscribe_entities for the entities config.properties names, call_service when OK runs a scene or turns a light
 * on or off, and subscribe_events for frametv_notify ({title, message, seconds?}), shown on the TV. The TV says what
 * it's doing with the event frametv_state: {state: 'home'} when Frame TV is on the screen, {state: 'app', app, app_id,
 * title?, kind?} when it opens an app (kind: show, movie, video or trailer), and {state: 'hidden'} when it's left some other way
 * (the remote's Home, or the TV turned off). Both events need an admin user in HA.
 * On with home_assistant_url and home_assistant_token unless home_assistant=false. The connection comes back by
 * itself (a ping every 30 s finds one that died quietly). In a desktop browser without them it shows sample data.
 */
var HA = (function () {
  'use strict';

  function trim(s) { return String(s || '').replace(/^\s+|\s+$/g, ''); }

  var URL = trim(Settings.get('homeAssistantUrl')).replace(/\/+$/, '');
  var TOKEN = trim(Settings.get('homeAssistantToken'));
  var ON = Modules.on('homeAssistant');
  var SAMPLE = ON && !(URL && TOKEN) && TV.name === 'browser';
  var PING = 30000, PONG = 10000, BACKOFF = [2000, 5000, 15000, 30000, 60000];

  /** "light.x:Name, light.y" from config.properties as [{id, name}] (name '' = HA's friendly name). */
  function picks(list) {
    var out = [];
    for (var i = 0; i < (list || []).length; i++) {
      var s = trim(list[i]), c = s.indexOf(':');
      if (s) out.push({id: trim(c < 0 ? s : s.slice(0, c)), name: c < 0 ? '' : trim(s.slice(c + 1))});
    }
    return out;
  }

  var GROUPS = {
    scenes: picks(Settings.get('homeAssistantScenes')),
    lights: picks(Settings.get('homeAssistantLights')),
    power: picks(Settings.get('homeAssistantPower')),
    laundry: picks(Settings.get('homeAssistantLaundry')),
    guest: picks(Settings.get('homeAssistantGuestWifi'))
  };

  if (SAMPLE) {
    GROUPS = {
      scenes: picks(['script.home:Home', 'script.evening:Evening', 'script.bedtime:Bedtime', 'script.lights_off:Lights off']),
      lights: picks(['light.string_lights:String lights', 'light.mood_lights:Mood lights', 'light.all:All lights']),
      power: picks(['sensor.price', 'sensor.grid:Grid fee']),
      laundry: picks(['input_boolean.washer:Washer', 'input_boolean.dryer:Dryer']),
      guest: []
    };
  }

  var ids = [];
  for (var g in GROUPS) {
    if (!GROUPS.hasOwnProperty(g)) continue;
    for (var gi = 0; gi < GROUPS[g].length; gi++) if (ids.indexOf(GROUPS[g][gi].id) < 0) ids.push(GROUPS[g][gi].id);
  }

  // entity id -> {state, attributes, changed: ms}
  var states = {};
  // 'connecting', 'online', 'offline' (no answer) or 'auth' (the token wasn't accepted)
  var status = SAMPLE ? 'online' : 'connecting';

  if (SAMPLE) {
    var now = Date.now();
    states = {
      'script.home': {state: 'off', attributes: {}, changed: now},
      'script.evening': {state: 'off', attributes: {}, changed: now},
      'script.bedtime': {state: 'off', attributes: {}, changed: now},
      'script.lights_off': {state: 'off', attributes: {}, changed: now},
      'light.string_lights': {state: 'on', attributes: {brightness: 115, supported_color_modes: ['brightness']}, changed: now - 3600000},
      'light.mood_lights': {state: 'off', attributes: {}, changed: now - 7200000},
      'light.all': {state: 'on', attributes: {brightness: 46}, changed: now - 600000},
      'sensor.price': {state: '1.357', attributes: {unit_of_measurement: 'NOK/kWh', friendly_name: 'Electricity price',
        min_price: 0.144, avg_price: 0.788, max_price: 1.563}, changed: now},
      'sensor.grid': {state: '0.314', attributes: {unit_of_measurement: 'NOK/kWh'}, changed: now},
      'input_boolean.washer': {state: 'on', attributes: {}, changed: now - 24 * 60000},
      'input_boolean.dryer': {state: 'off', attributes: {}, changed: now - 2 * 86400000}
    };
  }

  var listeners = [], notifyListeners = [];
  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  // MARK: - The connection

  var ws = null, nextId = 1, pending = {}, retries = 0, retryTimer = 0, pingTimer = 0, pongTimer = 0, subs = {};

  function wsUrl() { return URL.replace(/^http/, 'ws') + '/api/websocket'; }

  function send(msg, done) {
    if (!ws || ws.readyState !== 1) { if (done) done(false, {message: 'offline'}); return 0; }
    msg.id = nextId++;
    if (done) pending[msg.id] = done;
    try { ws.send(JSON.stringify(msg)); } catch (e) { delete pending[msg.id]; if (done) done(false, {message: String(e)}); }
    return msg.id;
  }

  function setStatus(s) {
    if (s === status) return;
    status = s;
    changed();
  }

  function connect() {
    clearTimeout(retryTimer);
    if (!ON || SAMPLE || !URL || !TOKEN || ws) return;
    try { ws = new WebSocket(wsUrl()); } catch (e) { ws = null; retry(); return; }
    var sock = ws;
    sock.onmessage = function (ev) {
      if (sock !== ws) return;
      var m = null;
      try { m = JSON.parse(ev.data); } catch (e) {}
      if (m) receive(m);
    };
    sock.onclose = sock.onerror = function () {
      if (sock !== ws) return;
      drop();
      if (status !== 'auth') { setStatus('offline'); retry(); }
    };
  }

  /** Forgets the socket and what waited on it. */
  function drop() {
    var s = ws;
    ws = null;
    clearInterval(pingTimer);
    clearTimeout(pongTimer);
    subs = {};
    for (var id in pending) if (pending.hasOwnProperty(id)) pending[id](false, {message: 'offline'});
    pending = {};
    if (s) { s.onclose = s.onerror = s.onmessage = null; try { s.close(); } catch (e) {} }
  }

  function retry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, BACKOFF[Math.min(retries++, BACKOFF.length - 1)]);
  }

  function receive(m) {
    if (m.type === 'auth_required') {
      ws.send(JSON.stringify({type: 'auth', access_token: TOKEN}));
    } else if (m.type === 'auth_invalid') {
      drop();
      setStatus('auth');
    } else if (m.type === 'auth_ok') {
      retries = 0;
      subscribe();
      if (!document.hidden) tell({state: 'home'});
      pingTimer = setInterval(ping, PING);
    } else if (m.type === 'result' || m.type === 'pong') {
      var done = pending[m.id];
      delete pending[m.id];
      if (done) done(m.type === 'pong' || !!m.success, m.error || m.result);
    } else if (m.type === 'event' && subs[m.id]) {
      subs[m.id](m.event);
    }
  }

  function ping() {
    send({type: 'ping'}, function () { clearTimeout(pongTimer); });
    clearTimeout(pongTimer);
    pongTimer = setTimeout(function () { drop(); setStatus('offline'); retry(); }, PONG);
  }

  function subscribe() {
    if (ids.length) {
      var e = send({type: 'subscribe_entities', entity_ids: ids}, function (ok) { if (ok) setStatus('online'); });
      subs[e] = entities;
    } else setStatus('online');
    var n = send({type: 'subscribe_events', event_type: 'frametv_notify'});
    subs[n] = function (ev) {
      var d = ev && ev.data || {};
      for (var i = 0; i < notifyListeners.length; i++) notifyListeners[i](d);
    };
  }

  /** subscribe_entities' compressed states: a (added in full), c (changed: + merged, - attributes gone), r (removed). */
  function entities(ev) {
    var id, s;
    for (id in ev.a || {}) {
      if (!ev.a.hasOwnProperty(id)) continue;
      s = ev.a[id];
      states[id] = {state: s.s, attributes: s.a || {}, changed: (s.lc || 0) * 1000};
    }
    for (id in ev.c || {}) {
      if (!ev.c.hasOwnProperty(id) || !states[id]) continue;
      var plus = ev.c[id]['+'], minus = ev.c[id]['-'], k;
      s = states[id];
      if (plus) {
        if (plus.s !== undefined) s.state = plus.s;
        if (plus.lc) s.changed = plus.lc * 1000;
        for (k in plus.a || {}) if (plus.a.hasOwnProperty(k)) s.attributes[k] = plus.a[k];
      }
      if (minus && minus.a) for (k = 0; k < minus.a.length; k++) delete s.attributes[minus.a[k]];
    }
    for (var r = 0; ev.r && r < ev.r.length; r++) delete states[ev.r[r]];
    changed();
  }

  // MARK: - Doing things

  /** Runs a scene or script, or turns a light (or switch) on or off; done(ok) when HA has answered. */
  function run(id, done) {
    var domain = id.slice(0, id.indexOf('.')), service = 'turn_on';
    if (domain === 'light' || domain === 'switch' || domain === 'input_boolean') service = 'toggle';
    if (SAMPLE) {
      var s = states[id];
      if (s && service === 'toggle') { s.state = s.state === 'on' ? 'off' : 'on'; s.changed = Date.now(); changed(); }
      if (done) done(true);
      return;
    }
    send({type: 'call_service', domain: domain, service: service, target: {entity_id: id}}, function (ok) {
      if (done) done(ok);
    });
  }

  var toldAt = 0;

  /** frametv_state to HA: what the TV is doing (see the top). */
  function tell(data) {
    if (!ON || SAMPLE || !ws) return;
    toldAt = Date.now();
    send({type: 'fire_event', event_type: 'frametv_state', event_data: data});
  }

  /** Sets a light's brightness, 0-100 (0 turns it off); done(ok). */
  function brightness(id, pct, done) {
    if (SAMPLE) {
      var s = states[id];
      if (s) { s.state = pct > 0 ? 'on' : 'off'; s.attributes.brightness = Math.round(pct * 2.55); changed(); }
      if (done) done(true);
      return;
    }
    var msg = pct > 0 ? {type: 'call_service', domain: 'light', service: 'turn_on', service_data: {brightness_pct: pct}}
      : {type: 'call_service', domain: 'light', service: 'turn_off'};
    msg.target = {entity_id: id};
    send(msg, function (ok) { if (done) done(ok); });
  }

  /** A light that dims (its color modes are more than on and off). */
  function dims(e) {
    var modes = e.attributes.supported_color_modes || [];
    return /^light\./.test(e.id) && modes.length > 0 && !(modes.length === 1 && modes[0] === 'onoff');
  }

  /** A group's entities that HA has and can use now: [{id, name, state, attributes, changed}]. */
  function group(name) {
    var out = [], list = GROUPS[name] || [];
    for (var i = 0; i < list.length; i++) {
      var s = states[list[i].id];
      if (!s || s.state === 'unavailable') continue;
      out.push({id: list[i].id, name: list[i].name || s.attributes.friendly_name || list[i].id, state: s.state,
        attributes: s.attributes, changed: s.changed});
    }
    return out;
  }

  /** An image entity's picture, with the short-lived token HA puts in it (none until it has one). */
  function picture(attributes) {
    var p = attributes && attributes.entity_picture;
    return p ? (/^https?:/.test(p) ? p : URL + p) : '';
  }

  connect();
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      // Hidden right after an app was opened is that app; otherwise the TV went somewhere else.
      if (Date.now() - toldAt > 3000) tell({state: 'hidden'});
      return;
    }
    if (ws) tell({state: 'home'});
    else if (status !== 'auth') { retries = 0; connect(); }
  });

  return {
    /** The module is on and has its address and token (or the browser preview, with sample data). */
    enabled: function () { return ON && !!(URL && TOKEN) || SAMPLE; },
    sample: function () { return SAMPLE; },
    status: function () { return status; },
    group: group,
    picture: picture,
    run: run,
    brightness: brightness,
    /** Frame TV opens an app: app is {id, title}, item a title ({title, kind}) or a video, or null. */
    opening: function (app, item) {
      var d = {state: 'app', app: app.title || app.id, app_id: app.id};
      if (item && item.title) { d.title = item.title; if (item.kind) d.kind = item.kind; }
      tell(d);
    },
    dims: dims,
    /** Every entity in HA, for Home Settings: done([{id, name}]) sorted by name, or done(null) without a connection. */
    states: function (done) {
      function out(list) {
        var r = [];
        for (var i = 0; i < list.length; i++) {
          var a = list[i].attributes || {};
          r.push({id: list[i].entity_id, name: a.friendly_name || list[i].entity_id});
        }
        r.sort(function (x, y) { return x.name.toLowerCase() < y.name.toLowerCase() ? -1 : 1; });
        done(r);
      }
      if (SAMPLE) {
        var fake = [];
        for (var id in states) if (states.hasOwnProperty(id)) fake.push({entity_id: id, attributes: states[id].attributes});
        fake.push({entity_id: 'image.guest_wifi', attributes: {friendly_name: 'Guest Wi-Fi QR'}});
        fake.push({entity_id: 'switch.guest_wifi', attributes: {friendly_name: 'Guest Wi-Fi'}});
        out(fake);
        return;
      }
      send({type: 'get_states'}, function (ok, result) { if (ok && result) out(result); else done(null); });
    },
    onChange: function (fn) { listeners.push(fn); },
    /** fn({title, message, seconds}) for each frametv_notify event. */
    onNotify: function (fn) { notifyListeners.push(fn); }
  };
})();
