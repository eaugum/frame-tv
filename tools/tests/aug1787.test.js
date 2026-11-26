'use strict';
// AUG-1787: a token only goes to the address (origin) it was set or linked for. A new address on the TV needs the
// token again; http:// with a token gives a warning; the Stasera and YouTube caches belong to the account they came
// from. Every token here is made up (DUMMY-...), and nothing leaves the fake XHR and WebSocket of the harness.
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadApp} = require('./harness');

const HA = 'http://ha.test:8123', ART = 'http://art.test:8099', STASERA = 'https://stasera.test';
const EVIL = 'evil.test';

// MARK: - Recording and driving

/** Every call the page made: XHR (method, url, headers, body) and WebSocket (url, what was sent), as text. */
function calls(app) {
  return app.requests.map((r) => ({kind: 'xhr', to: r.method + ' ' + r.url, text: JSON.stringify([r.url, r.requestHeaders, r.body])}))
    .concat(app.sockets.map((s) => ({kind: 'ws', to: s.url, text: JSON.stringify([s.url, s.sent])})));
}

/** The calls that carry this text anywhere (url, headers, body, socket messages). */
function carrying(app, secret) { return calls(app).filter((c) => c.text.indexOf(secret) >= 0); }
function toHost(app, host) { return calls(app).filter((c) => c.to.indexOf('//' + host) >= 0); }

/** HA's socket answers auth_required, as Home Assistant does on connect. */
function haHello(app) {
  for (const s of app.sockets) {
    if (s.readyState === 3 || typeof s.onmessage !== 'function') continue;
    s.readyState = 1;
    s.onmessage({data: JSON.stringify({type: 'auth_required'})});
  }
}

function clickText(root, selector, text) {
  const node = root.querySelectorAll(selector).filter((n) => n.textContent.indexOf(text) === 0)[0];
  if (!node) throw new Error('no ' + selector + ' starting with ' + JSON.stringify(text) + ' in ' + JSON.stringify(root.querySelectorAll(selector).map((n) => n.textContent)));
  node.click();
}

/** The rows of the open settings page: [{label, value, dim}]. */
function rows(app) {
  return app.document.getElementById('settings').querySelectorAll('.row').map((r) => {
    const v = r.querySelector('.value');
    return {label: r.childNodes[0] && r.childNodes[0].nodeType === 3 ? r.childNodes[0].textContent : '',
      value: v ? v.textContent.replace(/[‹›]/g, '') : '', dim: /\bdim\b/.test(r.className)};
  });
}

function row(app, label) { return rows(app).filter((r) => r.label === label)[0]; }

/** Home Settings → Connections (from the home screen). */
function openConnections(app) {
  app.document.getElementById('tabs').children[0].click();   // the gear
  clickText(app.document.getElementById('settings'), '.row', 'Connections');
}

/** Connections → service → setting → Change/Type a new one, then the text and Done. Gives the sheet's hint before Done. */
function typeSetting(app, service, setting, text) {
  const d = app.document, sheet = d.getElementById('settings');
  openConnections(app);
  clickText(sheet, '.row', service);
  clickText(sheet, '.row', setting);
  clickText(sheet, '.row', /Token|Key/.test(setting) ? 'Type a new one' : 'Change');
  const before = d.getElementById('typer').querySelector('.hint').textContent;
  for (let i = 0; i < 60; i++) app.key(8);   // empty the field
  for (const ch of text) app.dispatch(d, 'keypress', {charCode: ch.charCodeAt(0)});
  clickText(d.getElementById('typer'), '.s-key', 'Done');
  return before;
}

/** Leaves Home Settings (Back until it closes), as a person does; the app then reloads. */
function leave(app) {
  for (let i = 0; i < 8; i++) app.key('back');
  app.advance(1000);
}

/** The next start: the same files and localStorage, as location.reload() gives. */
function restart(app, o) {
  return loadApp(Object.assign({config: app.config, storage: app.storage.dump()}, o || {}));
}

// MARK: - The rule itself (data.js)

test('origin: scheme, host and port in lower case; anything else is no origin', () => {
  const app = loadApp();
  const o = (u) => app.eval('Settings.origin(' + JSON.stringify(u) + ')');
  assert.equal(o('HTTP://HA.Test:8123/api?x=1'), 'http://ha.test:8123');
  assert.equal(o(' https://stasera.test/ '), 'https://stasera.test');
  assert.equal(o('http://[fe80::1]:8123'), 'http://[fe80::1]:8123');
  assert.equal(o('http://ha.test:8123\\@evil.test'), 'http://ha.test:8123');
  assert.notEqual(o('http://ha.test:8123@evil.test'), 'http://ha.test:8123');
  for (const bad of ['', 'ha.test:8123', 'ftp://ha.test', 'http://', 'javascript:alert(1)', null, 7]) {
    assert.equal(o(bad), '', JSON.stringify(bad) + ' has no origin');
  }
});

// MARK: - Home Assistant

const HA_CONFIG = {homeAssistant: true, homeAssistantUrl: HA, homeAssistantToken: 'DUMMY-HA-1'};

test('ST22/T79/T68: a new Home Assistant address on the TV gets no token, also after a restart', () => {
  const app = loadApp({config: HA_CONFIG});
  haHello(app);
  assert.equal(carrying(app, 'DUMMY-HA-1').length, 1, 'the config token goes to its own address');
  assert.equal(carrying(app, 'DUMMY-HA-1')[0].to, 'ws://ha.test:8123/api/websocket');

  const hint = typeSetting(app, 'Home Assistant', 'Address', 'http://' + EVIL + ':8123');
  assert.equal(hint, 'A new address needs the token again.');
  assert.equal(app.eval("Settings.get('homeAssistantUrl')"), 'http://evil.test:8123', 'the address is saved');
  // Back on the service page: the switch and the token say what's missing.
  app.key('back');
  assert.equal(row(app, 'Home Assistant').value, 'On · Missing Token');
  assert.equal(row(app, 'Token').value, 'For another address');
  app.key('back');
  assert.equal(row(app, 'Home Assistant').value, 'On · Missing Token', 'Connections says it too');
  leave(app);
  assert.equal(app.location.reloads, 1, 'leaving Home Settings restarts the app');

  const next = restart(app);
  haHello(next);
  next.advance(120000);
  assert.deepEqual(carrying(next, 'DUMMY-HA-1'), [], 'no call carries the token');
  assert.deepEqual(toHost(next, EVIL), [], 'nothing goes to the new address at all');
  assert.equal(next.eval("Modules.ready('homeAssistant')"), false);
  assert.equal(next.eval('HA.enabled() && !HA.sample()'), false, 'only the preview\'s samples');
  assert.ok(next.storage.getItem('fmtv.settings').indexOf('DUMMY-HA-1') < 0, 'the file token is not copied anywhere');
});

test('ST22: putting the old Home Assistant address back makes the token work again', () => {
  const app = loadApp({config: HA_CONFIG});
  typeSetting(app, 'Home Assistant', 'Address', 'http://' + EVIL + ':8123');
  leave(app);
  const moved = restart(app);
  typeSetting(moved, 'Home Assistant', 'Address', HA + '/');
  leave(moved);
  const back = restart(moved);
  haHello(back);
  assert.equal(carrying(back, 'DUMMY-HA-1').length, 1);
  assert.equal(carrying(back, 'DUMMY-HA-1')[0].to, 'ws://ha.test:8123/api/websocket');
});

test('ST22: a new token in the config while the address override stays does not go to the override', () => {
  const app = loadApp({config: HA_CONFIG});
  typeSetting(app, 'Home Assistant', 'Address', 'http://' + EVIL + ':8123');
  leave(app);
  const next = restart(app, {config: Object.assign({}, HA_CONFIG, {homeAssistantToken: 'DUMMY-HA-2'})});
  haHello(next);
  next.advance(120000);
  assert.deepEqual(carrying(next, 'DUMMY-HA-2'), []);
  assert.deepEqual(carrying(next, 'DUMMY-HA-1'), []);
  assert.deepEqual(toHost(next, EVIL), []);
});

test('ST22: a token typed for the new address works there, and "Use the config\'s again" does not bypass the binding', () => {
  const app = loadApp({config: HA_CONFIG});
  typeSetting(app, 'Home Assistant', 'Address', 'http://' + EVIL + ':8123');
  // The person with the remote may replace the token for the new address (askHA checks it there first).
  app.xhr({url: /evil\.test/, status: 200, body: {}});
  app.eval("Settings.set('homeAssistantToken', 'DUMMY-HA-TYPED')");
  assert.equal(app.eval("Settings.token('homeAssistantToken')"), 'DUMMY-HA-TYPED');
  // Back to the config's token: it belongs to the config's address, not the override.
  app.eval("Settings.reset('homeAssistantToken')");
  assert.equal(app.eval("Settings.get('homeAssistantToken')"), 'DUMMY-HA-1');
  assert.equal(app.eval("Settings.token('homeAssistantToken')"), '');
  const next = restart(app);
  haHello(next);
  assert.deepEqual(carrying(next, 'DUMMY-HA-1'), []);
  assert.deepEqual(toHost(next, EVIL), []);
});

test('upgrade: a Home Assistant token typed on the TV before the fix is kept but not used until typed again', () => {
  // As the old code wrote it: the TV's value and what the file said then, no address.
  const storage = {'fmtv.settings': {homeAssistantToken: {v: 'DUMMY-HA-OLD', file: JSON.stringify('DUMMY-HA-1')}}};
  const app = loadApp({config: HA_CONFIG, storage});
  haHello(app);
  assert.deepEqual(carrying(app, 'DUMMY-HA-OLD'), []);
  assert.deepEqual(carrying(app, 'DUMMY-HA-1'), [], 'nor the file token: the TV value applies');
  assert.ok(app.storage.getItem('fmtv.settings').indexOf('DUMMY-HA-OLD') >= 0, 'still stored');
  openConnections(app);
  assert.equal(row(app, 'Home Assistant').value, 'On · Missing Token');
});

test('upgrade: an address override written by the old code does not get the config token', () => {
  const storage = {'fmtv.settings': {homeAssistantUrl: {v: 'http://' + EVIL + ':8123', file: JSON.stringify(HA)}}};
  const app = loadApp({config: HA_CONFIG, storage});
  haHello(app);
  assert.deepEqual(carrying(app, 'DUMMY-HA-1'), []);
  assert.deepEqual(toHost(app, EVIL), []);
});

// MARK: - T74: http:// with a token

test('T74: http:// with a usable token shows a dim warning on the service page; https:// and no token do not', () => {
  const WARN = 'http:// sends the token unencrypted';
  const plain = loadApp({config: HA_CONFIG});
  openConnections(plain);
  clickText(plain.document.getElementById('settings'), '.row', 'Home Assistant');
  const w = row(plain, WARN);
  assert.ok(w, 'the warning is there: ' + JSON.stringify(rows(plain)));
  assert.equal(w.dim, true);
  assert.ok(plain.sockets.length > 0, 'and nothing is blocked');

  const secure = loadApp({config: Object.assign({}, HA_CONFIG, {homeAssistantUrl: 'https://ha.test:8123'})});
  openConnections(secure);
  clickText(secure.document.getElementById('settings'), '.row', 'Home Assistant');
  assert.equal(row(secure, WARN), undefined);

  const none = loadApp({config: Object.assign({}, HA_CONFIG, {homeAssistantToken: ''})});
  openConnections(none);
  clickText(none.document.getElementById('settings'), '.row', 'Home Assistant');
  assert.equal(row(none, WARN), undefined);

  const art = loadApp({config: {art: true, artUrl: ART, artKey: 'DUMMY-ART-1'}});
  openConnections(art);
  clickText(art.document.getElementById('settings'), '.row', 'Art Mode');
  assert.ok(row(art, 'http:// sends the key unencrypted'), JSON.stringify(rows(art)));
});

// MARK: - Art Mode (T66)

const ART_CONFIG = {art: true, artUrl: ART, artKey: 'DUMMY-ART-1'};

test('T66: a new Art Mode address gets no key, no events and no report, also after a restart', () => {
  const tizen = fakeTizen();
  const app = loadApp({config: ART_CONFIG, tizen, xhr: [{url: /art\.test/, body: {ok: true}}]});
  app.advance(10000);
  assert.ok(carrying(app, 'DUMMY-ART-1').length > 0, 'the key goes to its own address');
  const hint = typeSetting(app, 'Art Mode', 'Address', 'http://' + EVIL + ':8099');
  assert.equal(hint, 'A new address needs the key again.');
  app.key('back');
  assert.equal(row(app, 'Art Mode').value, 'On · Missing Key');
  assert.equal(row(app, 'Key').value, 'For another address');
  leave(app);
  const next = restart(app, {tizen});
  next.advance(2 * 3600000);
  next.setHidden(true);
  next.setHidden(false);
  next.eval("Art.event('test', 'something')");
  assert.deepEqual(carrying(next, 'DUMMY-ART-1'), []);
  assert.deepEqual(toHost(next, EVIL), [], 'no events, no status and no report to the new address');
  assert.equal(next.eval('Art.enabled()'), false);

  // The old address back: the key works again.
  typeSetting(next, 'Art Mode', 'Address', ART);
  leave(next);
  const back = restart(next, {tizen, xhr: [{url: /art\.test/, body: {ok: true}}]});
  back.advance(10000);
  assert.ok(carrying(back, 'DUMMY-ART-1').every((c) => c.to.indexOf('//art.test:8099/') >= 0));
  assert.ok(carrying(back, 'DUMMY-ART-1').length > 0);
});

/** Enough of tizen for art.js's report (it only reports on a TV). */
function fakeTizen() {
  return {
    application: {getCurrentApplication: () => ({appInfo: {version: '1.0.0'}}), getAppsInfo: (ok) => ok([]),
      launchAppControl: (c, id, a, b, cb) => { cb.onfailure(); }},
    systeminfo: {getCapability: () => '6.5', getAvailableMemory: () => 1, getTotalMemory: () => 2,
      getPropertyValue: (p, ok, err) => err()},
    ApplicationControl: function () {}
  };
}

// MARK: - Stasera (T85)

const ST_CONFIG = {stasera: true, staseraUrl: STASERA};
const HOME_A = {watching: [{kind: 'show', titleId: 1, title: 'Account A Show', providers: [], networks: []}], watchingCount: 1,
  wantToStart: [], movies: [], friends: [], stats: null};
const HOME_B = {watching: [{kind: 'show', titleId: 2, title: 'Account B Show', providers: [], networks: []}], watchingCount: 1,
  wantToStart: [], movies: [], friends: [], stats: null};

/** Links this TV through the QR flow (fake answers) with a made-up token, and lets /tv/home answer. */
function link(app, token, home) {
  app.eval("Stasera.link('Fake TV', function () {})");
  app.request(/\/tv\/pair\/start/).respond(200, {secret: 'DUMMY-PAIR', code: 'ABCD', url: STASERA + '/tv/link', expiresAt: app.clock.now() + 600000});
  app.advance(3000);
  app.request(/\/tv\/pair\/poll/).respond(200, {status: 'approved', token});
  if (home) {
    const r = app.pending().filter((x) => /\/tv\/home/.test(x.url));
    r.forEach((x) => x.respond(200, home));
  }
  app.advance(0);
}

const watching = (app) => app.json('Stasera.home().watching.map(function (w) { return w.title; })');

test('T85/ST22: a Stasera link goes only to the server it was made with', () => {
  const app = loadApp({config: ST_CONFIG, xhr: [{url: /\/tv\/me/, body: {name: 'Fake TV'}}]});
  link(app, 'DUMMY-STASERA-1', HOME_A);
  assert.equal(app.eval('Stasera.linked()'), true);
  assert.deepEqual(watching(app), ['Account A Show']);
  const hint = typeSetting(app, 'Stasera', 'Address', 'http://' + EVIL + ':8080');
  assert.equal(hint, 'A new address needs the token again.');
  leave(app);
  const next = restart(app);
  next.advance(10 * 60000);
  assert.deepEqual(carrying(next, 'DUMMY-STASERA-1'), []);
  assert.equal(next.eval('Stasera.linked()'), false, 'not linked: the Link tile asks for it');
  assert.ok(next.document.getElementById('rows').textContent.indexOf('Account A Show') < 0, "account A's cache is not shown");
  assert.ok(next.document.body.textContent.indexOf('Link this TV to Stasera') >= 0, 'the Link tile is there');
  assert.equal(next.storage.getItem('fmtv.stasera.token'), 'DUMMY-STASERA-1', 'the token stays stored');

  typeSetting(next, 'Stasera', 'Address', STASERA);
  leave(next);
  const back = restart(next, {xhr: [{url: /\/tv\/me/, body: {name: 'Fake TV'}}]});
  assert.equal(back.eval('Stasera.linked()'), true, 'the old address back: linked again');
  assert.ok(carrying(back, 'DUMMY-STASERA-1').every((c) => c.to.indexOf('//stasera.test/') >= 0));
  assert.deepEqual(watching(back), ['Account A Show'], 'and its own cache is drawn at once');
});

test('T85: a link made after the address changed but before Home Settings closes belongs to the server it was made with', () => {
  const app = loadApp({config: ST_CONFIG, xhr: [{url: /\/tv\/me/, body: {name: 'Fake TV'}}]});
  typeSetting(app, 'Stasera', 'Address', 'http://' + EVIL + ':8080');
  link(app, 'DUMMY-STASERA-2', HOME_A);   // this run still talks to stasera.test
  assert.ok(carrying(app, 'DUMMY-STASERA-2').every((c) => c.to.indexOf('//stasera.test/') >= 0));
  leave(app);
  const next = restart(app);
  next.advance(10 * 60000);
  assert.deepEqual(carrying(next, 'DUMMY-STASERA-2'), []);
  assert.deepEqual(toHost(next, EVIL).filter((c) => c.text.indexOf('Bearer') >= 0), []);
});

test('upgrade: a Stasera link from before the fix is kept but not used, and its cache is not shown', () => {
  const cache = {data: HOME_A, at: Date.UTC(2026, 10, 24, 10), name: 'Fake TV', hello: null};
  const app = loadApp({config: ST_CONFIG, storage: {'fmtv.stasera.token': 'DUMMY-STASERA-OLD', 'fmtv.stasera.home2': cache}});
  app.advance(10 * 60000);
  assert.deepEqual(carrying(app, 'DUMMY-STASERA-OLD'), []);
  assert.equal(app.eval('Stasera.linked()'), false);
  assert.deepEqual(watching(app), []);
  assert.ok(app.document.body.textContent.indexOf('Link this TV to Stasera') >= 0);
  assert.equal(app.storage.getItem('fmtv.stasera.token'), 'DUMMY-STASERA-OLD');
  openConnections(app);
  assert.equal(row(app, 'Stasera').value, 'On · Not linked');
});

test('Stasera: a token from the config works without anything new, also as the old code left it', () => {
  const config = Object.assign({}, ST_CONFIG, {staseraToken: 'DUMMY-STASERA-CFG'});
  const fresh = loadApp({config});
  assert.equal(fresh.eval('Stasera.linked()'), true);
  assert.ok(carrying(fresh, 'DUMMY-STASERA-CFG').some((c) => c.to.indexOf('GET ' + STASERA + '/tv/home?') === 0));
  // The old code seeded it: the token and the seed mark, no link record.
  const old = loadApp({config, storage: {'fmtv.stasera.token': 'DUMMY-STASERA-CFG', 'fmtv.stasera.seed': 'DUMMY-STASERA-CFG'}});
  assert.equal(old.eval('Stasera.linked()'), true);
  assert.ok(carrying(old, 'DUMMY-STASERA-CFG').some((c) => c.to.indexOf('GET ' + STASERA + '/tv/home?') === 0));
  // With a Stasera address override on the TV, the config's token is not sent there.
  const moved = loadApp({config, storage: {'fmtv.settings': {staseraUrl: {v: 'http://' + EVIL + ':8080', file: JSON.stringify(STASERA)}}}});
  moved.advance(10 * 60000);
  assert.deepEqual(carrying(moved, 'DUMMY-STASERA-CFG'), []);
  assert.equal(moved.eval('Stasera.linked()'), false);
});

test('ST23: after a new Stasera link the previous account\'s cache is not shown, not even before the answer', () => {
  const app = loadApp({config: ST_CONFIG, xhr: [{url: /\/tv\/me/, body: {name: 'Fake TV'}}]});
  link(app, 'DUMMY-STASERA-A', HOME_A);
  assert.deepEqual(watching(app), ['Account A Show']);
  link(app, 'DUMMY-STASERA-B', null);   // /tv/home for B has not answered yet
  assert.deepEqual(watching(app), [], "A's titles are gone at once");
  // Restarting before B's answer came: A's cache is still not B's.
  const next = restart(app);
  assert.deepEqual(watching(next), []);
  next.request(/\/tv\/home/).respond(200, HOME_B);
  assert.deepEqual(watching(next), ['Account B Show']);
  assert.ok(carrying(next, 'DUMMY-STASERA-B').length > 0);
});

test('ST23: a new Stasera token in the config does not show the previous account\'s cache', () => {
  const app = loadApp({config: Object.assign({}, ST_CONFIG, {staseraToken: 'DUMMY-STASERA-A'}),
    xhr: [{url: /\/tv\/home/, body: HOME_A}, {url: /\/tv\/me/, body: {name: 'Fake TV'}}]});
  app.advance(0);
  assert.deepEqual(watching(app), ['Account A Show']);
  const next = restart(app, {config: Object.assign({}, ST_CONFIG, {staseraToken: 'DUMMY-STASERA-B'})});
  assert.deepEqual(watching(next), []);
  assert.ok(carrying(next, 'DUMMY-STASERA-B').length > 0);
  assert.deepEqual(carrying(next, 'DUMMY-STASERA-A'), []);
});

// MARK: - YouTube (ST23)

const YT_CONFIG = {youtube: true, youtubeClientId: 'fake-client-id', youtubeClientSecret: 'fake-client-secret'};
const YT_CACHE = {client: 'fake-client-id', data: {channels: [], playlists: [{id: 'PLa', title: 'Account A list'}],
  channelsAt: Date.UTC(2026, 10, 24, 10), videos: [{id: 'va', title: 'Account A video', channel: 'A', at: Date.UTC(2026, 10, 24, 9),
  duration: 600}], saved: [], savedFor: '', at: Date.UTC(2026, 10, 24, 10)}};

test('upgrade: a YouTube sign-in from before the fix asks to sign in again, and its cache is not shown', () => {
  const app = loadApp({config: YT_CONFIG, storage: {'fmtv.youtube.auth': {refresh: 'DUMMY-YT-OLD', access: '', expires: 0, name: 'A'},
    'fmtv.youtube': YT_CACHE}});
  app.advance(10 * 60000);
  assert.equal(app.eval('YouTube.linked()'), false);
  assert.deepEqual(carrying(app, 'DUMMY-YT-OLD'), []);
  assert.ok(app.json('YouTube.videos().map(function (v) { return v.title; })').indexOf('Account A video') < 0);
  assert.ok(app.storage.getItem('fmtv.youtube.auth').indexOf('DUMMY-YT-OLD') >= 0, 'kept');
  openConnections(app);
  assert.equal(row(app, 'YouTube').value, 'On · Not signed in');
});

function google() {
  return [
    {url: /oauth2\.googleapis\.com\/device\/code/, body: {device_code: 'DUMMY-DEVICE', user_code: 'ABCD-EFGH', interval: 5, expires_in: 1800}},
    {url: /oauth2\.googleapis\.com\/token/, respond: (x) => /device_code/.test(x.body) ?
      {status: 200, body: {refresh_token: x.body.indexOf('DUMMY-DEVICE-B') >= 0 ? 'DUMMY-YT-B' : 'DUMMY-YT-A', access_token: 'DUMMY-ACCESS', expires_in: 3600}} :
      {status: 200, body: {access_token: 'DUMMY-ACCESS', expires_in: 3600}}},
    {url: /youtube\/v3\//, delay: 60000, body: {items: []}}
  ];
}

test('ST23: a YouTube sign-in works across a restart, and a new account does not show the previous one\'s cache', () => {
  const app = loadApp({config: YT_CONFIG, xhr: google()});
  app.eval('YouTube.link(function () {})');
  app.advance(6000);
  assert.equal(app.eval('YouTube.linked()'), true);
  // Its own cache, as a refresh would leave it.
  app.eval("localStorage.setItem('fmtv.youtube', JSON.stringify({client: 'fake-client-id', account: JSON.parse(localStorage.getItem('fmtv.youtube.auth')).id, data: " + JSON.stringify(YT_CACHE.data) + '}))');
  const next = restart(app, {xhr: google()});
  assert.equal(next.eval('YouTube.linked()'), true, 'still signed in after a restart');
  assert.ok(next.json('YouTube.videos().map(function (v) { return v.title; })').indexOf('Account A video') >= 0, 'its cache is drawn');
  // Signing in again (another account): A's videos are gone at once.
  next.xhr({url: /oauth2\.googleapis\.com\/device\/code/, body: {device_code: 'DUMMY-DEVICE-B', user_code: 'WXYZ', interval: 5, expires_in: 1800}});
  next.eval('YouTube.link(function () {})');
  next.advance(6000);
  assert.equal(next.eval('YouTube.linked()'), true);
  assert.ok(next.json('YouTube.videos().map(function (v) { return v.title; })').indexOf('Account A video') < 0);
  const third = restart(next, {xhr: google()});
  assert.ok(third.json('YouTube.videos().map(function (v) { return v.title; })').indexOf('Account A video') < 0, 'nor after a restart');
});

test('YouTube: a refresh token from the config works without anything new, also as the old code left it', () => {
  const config = Object.assign({}, YT_CONFIG, {youtubeRefreshToken: 'DUMMY-YT-CFG'});
  const fresh = loadApp({config, xhr: google()});
  assert.equal(fresh.eval('YouTube.linked()'), true);
  const old = loadApp({config, xhr: google(), storage: {'fmtv.youtube.seed': 'DUMMY-YT-CFG',
    'fmtv.youtube.auth': {refresh: 'DUMMY-YT-CFG', access: '', expires: 0, name: 'A'}}});
  assert.equal(old.eval('YouTube.linked()'), true);
  old.advance(0);
  assert.ok(carrying(old, 'DUMMY-YT-CFG').every((c) => c.to.indexOf('https://oauth2.googleapis.com/') >= 0));
});

test('T74: Stasera linked over http:// shows the warning too', () => {
  const app = loadApp({config: {stasera: true, staseraUrl: 'http://stasera.test', staseraToken: 'DUMMY-STASERA-CFG'}});
  openConnections(app);
  clickText(app.document.getElementById('settings'), '.row', 'Stasera');
  assert.ok(row(app, 'http:// sends the token unencrypted'), JSON.stringify(rows(app)));
});

test('a link or sign-in record that is not what it should be does not stop the start, and sends nothing', () => {
  for (const junk of ['{', '7', 'null', '"x"', JSON.stringify({origin: STASERA}), JSON.stringify({origin: STASERA, id: ''})]) {
    const app = loadApp({config: Object.assign({}, ST_CONFIG, YT_CONFIG), storage: {'fmtv.stasera.token': 'DUMMY-STASERA-J',
      'fmtv.stasera.link': junk, 'fmtv.youtube.auth': junk === '{' ? '{' : JSON.stringify({refresh: 'DUMMY-YT-J', client: junk})}});
    assert.equal(typeof app.window.FrameTV, 'object', junk + ': home.js ran to its end');
    assert.equal(app.eval('Stasera.linked() || YouTube.linked()'), false, junk);
    assert.deepEqual(carrying(app, 'DUMMY-STASERA-J').concat(carrying(app, 'DUMMY-YT-J')), [], junk);
  }
});

// localStorage that is full for a big value (as a browser's quota), on top of the harness's.
const QUOTA = "(function (s) { var set = s.setItem; s.setItem = function (k, v) { if (String(v).length > 100000) {" +
  " var e = new Error('QuotaExceededError (planted by the test)'); e.name = 'QuotaExceededError'; throw e; } return set.call(s, k, v); }; })(localStorage);";

test('T85: a link whose token cannot be stored never leaves the old token bound to the new address', () => {
  // The owner linked at stasera.test; someone sets another address and links there, with a token too big to store.
  const owner = loadApp({config: ST_CONFIG, xhr: [{url: /\/tv\/me/, body: {name: 'Fake TV'}}]});
  link(owner, 'DUMMY-STASERA-OWNER', HOME_A);
  typeSetting(owner, 'Stasera', 'Address', 'http://' + EVIL + ':81');
  leave(owner);
  const evil = restart(owner, {after: {'config.js': QUOTA}});
  link(evil, 'DUMMY-EVIL-' + 'x'.repeat(200000), null);
  const next = restart(evil, {after: {'config.js': QUOTA}});
  next.advance(10 * 60000);
  assert.deepEqual(carrying(next, 'DUMMY-STASERA-OWNER'), [], "the owner's token goes nowhere");
  assert.deepEqual(toHost(next, EVIL).filter((c) => c.text.indexOf('Bearer') >= 0), []);
  assert.equal(next.eval('Stasera.linked()'), false);
  // And the owner's address back: still not paired with the record written for evil.test.
  const back = restart(next, {config: ST_CONFIG, storage: Object.assign(next.storage.dump(), {'fmtv.settings': '{}'})});
  assert.ok(carrying(back, 'DUMMY-STASERA-OWNER').every((c) => c.to.indexOf('//stasera.test/') >= 0));
});

test('T85: a link record that cannot be written leaves the stored token unused', () => {
  const FAIL_LINK = "(function (s) { var set = s.setItem; s.setItem = function (k, v) { if (k === 'fmtv.stasera.link' && /evil/.test(v)) {" +
    " throw new Error('QuotaExceededError (planted by the test)'); } return set.call(s, k, v); }; })(localStorage);";
  const owner = loadApp({config: ST_CONFIG, xhr: [{url: /\/tv\/me/, body: {name: 'Fake TV'}}]});
  link(owner, 'DUMMY-STASERA-OWNER', HOME_A);
  typeSetting(owner, 'Stasera', 'Address', 'http://' + EVIL + ':81');
  leave(owner);
  const evil = restart(owner, {after: {'config.js': FAIL_LINK}});
  link(evil, 'DUMMY-STASERA-EVIL', null);
  const next = restart(evil);
  next.advance(10 * 60000);
  assert.deepEqual(carrying(next, 'DUMMY-STASERA-OWNER'), []);
  assert.equal(next.eval('Stasera.linked()'), false, 'no record: not linked, asks again');
});
