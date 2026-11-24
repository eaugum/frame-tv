'use strict';
// AUG-1792: the home screen starts even with a bad address or a bad cached answer, and one module failing leaves the
// rest drawn. Every value here is made up; no token is real.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {loadApp} = require('./harness');

const HARNESS = path.join(__dirname, 'harness.js');
const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 24, 11, 0, 0);   // the harness's default: 12:00 in Oslo

// As a browser: XMLHttpRequest.open throws a SyntaxError for an address it can't parse (WHATWG URL, as Chromium).
const BROWSER_OPEN = {url: (u) => { try { new URL(u); return false; } catch (e) { return true; } }, throwOn: 'open'};

// Counts the app list loading (home.js's loadApps hands it to Data.setApps).
const COUNT_APPS = '(function (set) { Data.setApps = function (a) { window.appsLoaded = (window.appsLoaded || 0) + 1; set(a); }; })(Data.setApps);';

function load(o) {
  const opts = Object.assign({}, o);
  opts.xhr = [BROWSER_OPEN].concat(opts.xhr || []);
  opts.after = Object.assign({}, opts.after);
  opts.after['data.js'] = COUNT_APPS + (opts.after['data.js'] || '');
  return loadApp(opts);
}

/** What a start drew and did. */
function started(app) {
  const d = app.document;
  return {
    ranToEnd: typeof app.window.FrameTV === 'object',
    tabs: d.getElementById('tabs').children.length,
    homeTiles: d.getElementById('pane-home').querySelectorAll('.tile').length,
    homeLabels: d.getElementById('pane-home').querySelectorAll('.label').map((n) => n.textContent),
    appsLoaded: app.eval('window.appsLoaded || 0'),
    interval: app.clock.pending().some((t) => t.every === 30000),
    asked: app.requests.map((r) => r.method + ' ' + r.url)
  };
}

function assertStarted(app, what) {
  const s = started(app);
  assert.equal(s.ranToEnd, true, what + ': home.js ran to its end');
  assert.ok(s.tabs > 0, what + ': the tab bar is drawn');
  assert.ok(s.homeTiles > 0, what + ': Home has tiles');
  assert.ok(s.appsLoaded > 0, what + ': the app list loaded');
  assert.ok(s.interval, what + ': the 30 s refresh is registered');
  return s;
}

/** Runs a scenario in its own Node, so a loop that never ends fails the test instead of hanging it. */
function isolated(scenario, input) {
  const code = 'const {loadApp} = require(' + JSON.stringify(HARNESS) + ');\n' +
    'const input = ' + JSON.stringify(input) + ';\n' +
    'const result = (' + scenario.toString() + ')(loadApp, input);\n' +
    'process.stdout.write(JSON.stringify(result));';
  try {
    return JSON.parse(execFileSync(process.execPath, ['-e', code], {encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe']}));
  } catch (e) {
    if (e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT') throw new Error('the start did not return within 20 s (a loop that never ends)');
    throw new Error('the scenario failed: ' + (e.stderr || e.message).toString().split('\n').slice(0, 6).join('\n'));
  }
}

/** A value that can't become text or a number: String() and Number() throw on it. */
const POISON = {toString: 1, valueOf: 1};

/** An Open-Meteo answer with made-up numbers, local times from 24 November 00:00. */
function forecast() {
  const hours = [];
  for (let h = 0; h < 48; h++) hours.push('2026-11-' + (24 + Math.floor(h / 24)) + 'T' + String(h % 24).padStart(2, '0') + ':00');
  return {
    utc_offset_seconds: 3600,
    current: {temperature_2m: 3.4, weather_code: 3, is_day: 1},
    daily: {temperature_2m_max: [5.1, 4], temperature_2m_min: [-1.2, 0], sunrise: ['2026-11-24T08:41', '2026-11-25T08:43'],
      sunset: ['2026-11-24T15:20', '2026-11-25T15:19']},
    hourly: {time: hours, temperature_2m: hours.map(() => 2), weather_code: hours.map(() => 3), is_day: hours.map(() => 1)}
  };
}

/** The weather record data.js keeps, for Oslo (the harness's time zone), read `ago` ms before NOW. */
function weatherRecord(body, ago) {
  return {place: '59.92,10.75', body, at: NOW - ago};
}

// MARK: - T64, T76: an Art Mode address or key the browser can't use

/** localStorage as Settings.set leaves it: values set on the TV. */
function setOnTV(values) {
  const seed = loadApp();
  for (const [k, v] of Object.entries(values)) seed.eval('Settings.set(' + JSON.stringify(k) + ', ' + JSON.stringify(v) + ')');
  return seed.storage.dump();
}

test('T64/T76: an Art address saved on the TV that cannot be parsed does not stop the start', () => {
  for (const bad of ['http://192.168.1.10:80990', 'http://192.168.1.300:8099', 'http://192.168.1:10:8099']) {
    const app = load({storage: setOnTV({art: true, artUrl: bad})});
    assertStarted(app, bad);
    assert.equal(app.eval('typeof Art'), 'object', bad + ': Art exists');
    assert.ok(app.requests.some((r) => /open-meteo/.test(r.url)), bad + ': the weather was asked for');
    // The module still answers: an action fails at once and leaves it free.
    app.eval('var result = null; Art.next(function (ok) { result = ok; })');
    app.advance(0);
    assert.equal(app.eval('result'), false, bad + ': Art.next answers false');
    assert.equal(app.eval('Art.busy()'), false, bad + ': and is not left busy');
    app.advance(5 * 60000);   // Art's own refresh, and home.js's, on the same bad address
    assertStarted(app, bad + ', five minutes on');
  }
});

test('T64: an art_key with a character outside Latin-1 does not stop the start; the log is sent once headers work', () => {
  const art = 'http://art.test:8099';
  const app = load({
    config: {art: true, artUrl: art, artKey: 'fake“key'},
    // As a browser: setRequestHeader throws a TypeError for a value above U+00FF.
    xhr: [{url: /art\.test/, throwOn: 'setRequestHeader', header: 'Authorization'}]
  });
  assertStarted(app, 'a bad key');
  assert.equal(app.eval('typeof Art'), 'object');
  app.advance(0);
  // A key that works from now on: the events waiting go out, so the failed send didn't leave it marked as sending.
  app.xhr({url: /art\.test:8099\/event/, body: {ok: true}});
  app.eval("Art.event('test', 'after the bad key')");
  const sent = app.requests.filter((r) => r.method === 'POST' && /\/event$/.test(r.url));
  assert.ok(sent.length > 0, 'the event log was sent');
  assert.ok(sent[sent.length - 1].body.indexOf('after the bad key') >= 0);
});

/** Clicks the first node under `root` whose text starts with `text`. */
function clickText(root, selector, text) {
  const node = root.querySelectorAll(selector).filter((n) => n.textContent.indexOf(text) === 0)[0];
  if (!node) throw new Error('no ' + selector + ' starting with ' + JSON.stringify(text));
  node.click();
}

/** Types an address into Home Settings → Connections → Art Mode → Address, and presses Done. The sheet's hint after. */
function typeArtAddress(app, text) {
  const d = app.document;
  d.getElementById('tabs').children[0].click();   // the gear
  const sheet = d.getElementById('settings');
  clickText(sheet, '.row', 'Connections');
  clickText(sheet, '.row', 'Art Mode');
  clickText(sheet, '.row', 'Address');
  clickText(sheet, '.row', 'Change');
  for (let i = 0; i < 60; i++) app.key(8);   // empty the field
  for (const ch of text) app.dispatch(d, 'keypress', {charCode: ch.charCodeAt(0)});
  clickText(d.getElementById('typer'), '.s-key', 'Done');
  const hint = d.getElementById('typer').querySelector('.hint');
  return {hint: hint ? hint.textContent : '', bad: !!hint && /\bbad\b/.test(hint.className)};
}

test('T76: Home Settings does not save an address that cannot be parsed, and saves one that can', () => {
  const good = 'http://art.test:8099';
  for (const bad of ['http://192.168.1.10:80999', 'http://192.168.1.300:8099', 'http://192.168.1:10:8099',
    'http://art.test:8o99', 'http://[fe80::1:8123', 'http://art.test:8099:1']) {
    const app = load({config: {art: true, artUrl: good}});
    const h = typeArtAddress(app, bad);
    assert.equal(app.eval("Settings.get('artUrl')"), good, bad + ' was not saved');
    assert.equal(app.eval("Settings.changed('artUrl')"), false, bad + ': nothing set on the TV');
    assert.ok(h.bad && h.hint, bad + ': the sheet says why (' + JSON.stringify(h.hint) + ')');
  }
  for (const ok of ['http://192.168.1.10:8099', 'https://www.stasera.app', 'http://homeassistant.local:8123/',
    'http://[fe80::1]:8123', 'http://art.test/frame']) {
    const app = load({config: {art: true, artUrl: good}});
    const h = typeArtAddress(app, ok);
    assert.equal(app.eval("Settings.get('artUrl')"), ok.replace(/\/+$/, ''), ok + ' was saved (' + h.hint + ')');
  }
});

// MARK: - T65: Art's status only from a good answer, and any type tolerated

const STATUS = {showing: 'nasjonalmuseet: Fake Picture, Fake Artist', interval_minutes: 60, mode: 'category',
  category: 'Landscapes', settings: {screensaver: false}};

function artApp() {
  return load({config: {art: true, artUrl: 'http://art.test:8099'},
    xhr: [{url: /art\.test:8099\/status/, body: STATUS}, {url: /art\.test:8099\//, body: {ok: true}}]});
}

test('T65: an error answer keeps the last good status', () => {
  const app = artApp();
  app.advance(0);
  assert.equal(app.eval('Art.showing()'), 'Fake Picture, Fake Artist');
  assert.equal(app.eval('Art.saverAllowed()'), false);
  // The add-on's key changed: /status answers 401 with a JSON error.
  app.xhr({url: /art\.test:8099\/status/, status: 401, body: {ok: false, error: 'wrong or no key'}});
  app.advance(5 * 60000);
  assert.equal(app.eval('Art.showing()'), 'Fake Picture, Fake Artist', 'the picture stays');
  assert.equal(app.eval('Art.saverAllowed()'), false, 'the screensaver stays off as Home Assistant says');
  assert.equal(app.eval('Art.mode()'), 'category');
  // A refused action (500, a bare error) leaves it too.
  app.xhr({url: /art\.test:8099\/artmode/, status: 500, body: {ok: false, error: 'TV off'}});
  app.eval('var r = null; Art.artMode(function (ok) { r = ok; })');
  app.advance(0);
  assert.equal(app.eval('r'), false);
  assert.equal(app.eval('Art.showing()'), 'Fake Picture, Fake Artist');
});

test('T65: a status with other types does not throw, and Home is drawn', () => {
  const app = artApp();
  app.advance(0);
  app.xhr({url: /art\.test:8099\/status/, body: {showing: 42, interval_minutes: 'x', mode: {}, category: ['a'], settings: 7}});
  app.advance(5 * 60000);   // its refresh: this must not throw in Art.onChange
  assert.equal(app.eval('Art.showing()'), '');
  assert.equal(app.eval('Art.mode()'), 'shuffle');
  assert.equal(app.eval('Art.category()'), '');
  assert.equal(app.eval('Art.minutes()'), 0);
  app.xhr({url: /art\.test:8099\/status/, body: {showing: POISON}});
  app.advance(5 * 60000);
  assert.equal(app.eval('Art.showing()'), '');
  const s = assertStarted(app, 'odd status');
  assert.ok(s.homeLabels.indexOf('Art Mode') >= 0, 'the Art tile is drawn');
});

// MARK: - T87: Stasera's fetching is always reset

const STASERA = {config: {stasera: true, staseraUrl: 'https://stasera.test'}, storage: {'fmtv.stasera.token': 'fake-stasera-token'}};
const HOME = {watching: [{kind: 'show', titleId: 1, title: 'Fake Show', providers: [], networks: []}], watchingCount: 1,
  wantToStart: [], movies: [], friends: [], stats: null};

function staseraApp(more) {
  return load(Object.assign({}, STASERA, more, {xhr: [{url: /stasera\.test\/tv\/me/, body: {name: 'Fake TV'}}].concat((more && more.xhr) || [])}));
}

test('T87: a listener that throws does not leave Stasera fetching', () => {
  const app = staseraApp({after: {'home.js': "var boom = 1; Stasera.onChange(function () { if (boom) { boom = 0; throw new Error('planted by the test'); } });"}});
  try { app.request(/stasera\.test\/tv\/home/).respond(200, HOME); } catch (e) { /* the planted listener */ }
  app.advance(0);
  const before = app.requests.filter((r) => /\/tv\/home/.test(r.url)).length;
  app.eval('Stasera.refresh(true)');   // as after marking something as watched
  const after = app.requests.filter((r) => /\/tv\/home/.test(r.url)).length;
  assert.equal(after, before + 1, 'a forced refresh asks again');
});

test('T87: x.open or setRequestHeader throwing does not stop Stasera or the start', () => {
  for (const rule of [{url: /stasera\.test/, throwOn: 'open'}, {url: /stasera\.test/, throwOn: 'setRequestHeader', header: 'Authorization'}]) {
    const app = staseraApp({xhr: [rule]});
    assertStarted(app, rule.throwOn);
    assert.ok(app.requests.some((r) => /open-meteo/.test(r.url)), rule.throwOn + ': the weather was asked for');
    app.advance(0);
    app.xhr({url: /stasera\.test\/tv\/home/, body: HOME});
    app.eval('Stasera.refresh(true)');
    app.advance(0);
    assert.equal(app.eval('Stasera.home().watching.length'), 1, rule.throwOn + ': the next refresh went out and was drawn');
  }
});

// MARK: - ST24: weather

test('ST24 weather, drawing: an object temperature or code in the cache does not stop the start', () => {
  for (const [what, change] of [['temperature', (b) => { b.current.temperature_2m = POISON; }],
    ['weather code', (b) => { b.current.weather_code = POISON; }],
    ['daily max', (b) => { b.daily.temperature_2m_max = [POISON]; }],
    ['an hour', (b) => { b.hourly.temperature_2m[13] = POISON; }]]) {
    const body = forecast();
    change(body);
    const app = load({storage: {'fmtv.weather': weatherRecord(body, DAY)}});
    assertStarted(app, what);
    assert.ok(app.requests.some((r) => /open-meteo/.test(r.url)), what + ': the weather was asked for again');
    app.advance(0);
    app.request(/open-meteo/).respond(200, forecast());
    assert.equal(app.eval('Data.weather.temp'), 3.4, what + ': the next good answer is drawn');
    app.advance(60000);   // the clock's minute
  }
});

test('ST24 weather, drawing: a bad answer from Open-Meteo does not throw and does not break the next start', () => {
  const body = forecast();
  body.current.temperature_2m = POISON;
  const app = load({xhr: [{url: /open-meteo/, body}]});
  app.advance(0);
  app.advance(60000);
  const next = load({storage: app.storage.dump(), now: NOW + DAY});
  assertStarted(next, 'the start after');
});

test('ST24 weather, parsing: an object in hourly.time past the first six hours does not stop a later start', () => {
  const body = forecast();
  body.hourly.time[20] = POISON;
  const app = load({xhr: [{url: /open-meteo/, body}]});
  app.advance(0);
  const next = load({storage: app.storage.dump(), now: NOW + DAY});   // the hours read then are past
  assertStarted(next, 'the start a day later');
  assert.equal(next.eval('typeof Data'), 'object');
  assert.ok(next.requests.some((r) => /open-meteo/.test(r.url)), 'the weather was asked for again');
});

test('ST24 weather, parsing: an hourly.time with a huge length does not hang a later start', () => {
  const body = forecast();
  const time = {length: 1e300};
  for (let i = 0; i < 12; i++) time[i] = body.hourly.time[i];
  body.hourly.time = time;
  const r = isolated(function (loadApp, input) {
    const app = loadApp({storage: {'fmtv.weather': input.record}, now: input.now});
    return {ranToEnd: typeof app.window.FrameTV === 'object', asked: app.requests.map((x) => x.url)};
  }, {record: weatherRecord(body, 0), now: NOW + DAY});
  assert.equal(r.ranToEnd, true);
  assert.ok(r.asked.some((u) => /open-meteo/.test(u)));
});

test('ST24 weather: a cached record that is not an object at all is dropped', () => {
  for (const record of [{place: '59.92,10.75', body: 'text', at: NOW}, {place: '59.92,10.75', body: {current: 7}, at: 'soon'}, 7, 'x']) {
    const app = load({storage: {'fmtv.weather': record}});
    assertStarted(app, JSON.stringify(record));
    assert.ok(app.requests.some((r) => /open-meteo/.test(r.url)), JSON.stringify(record) + ': asked again');
  }
});

// MARK: - ST24: GitHub

const GH = {config: {github: true, githubToken: 'fake-github-token-not-real'}};

function githubRules(activity, languages) {
  const pushed = new Date(NOW - DAY).toISOString();
  return [
    {url: /api\.github\.com\/user\/repos/, body: [{name: 'demo', full_name: 'fake/demo', pushed_at: pushed}]},
    {url: /\/stats\/commit_activity/, body: activity},
    {url: /\/commits\?per_page=1/, body: [{commit: {message: 'Fake commit', committer: {date: pushed}}}]},
    {url: /\/languages/, body: languages}
  ];
}

const GOOD_WEEKS = [{week: 1795000000, days: [0, 1, 2, 0, 0, 3, 0], total: 6}];

test('ST24 GitHub: a week without days from GitHub does not throw, and the next start asks again', () => {
  const app = load(Object.assign({}, GH, {xhr: githubRules([{week: 1795000000}], {JavaScript: 100})}));
  app.advance(0);   // GitHub's answers, and its listener drawing them
  assertStarted(app, 'after the answer');
  // GitHub answers well this time: the week it couldn't read is asked for again and drawn.
  const next = load(Object.assign({}, GH, {storage: app.storage.dump(), now: NOW + 3600000,
    xhr: githubRules(GOOD_WEEKS, {JavaScript: 100})}));
  assertStarted(next, 'the next start');
  next.advance(0);
  assert.ok(next.requests.some((r) => /commit_activity/.test(r.url)), 'commit_activity is asked for again');
  assert.equal(next.eval('GitHub.summary().repos[0].commits'), 6, 'and the good answer is counted');
});

test('ST24 GitHub: bad weeks, days or languages already in the cache are dropped at start', () => {
  const seed = load(Object.assign({}, GH, {xhr: githubRules(GOOD_WEEKS, {JavaScript: 100, CSS: 20})}));
  seed.advance(0);
  const kept = JSON.parse(seed.storage.getItem('fmtv.github'));
  assert.equal(kept.data.repos[0].weeks.length, 1, 'the seed saved a good record');
  for (const [what, change] of [['a week without days', (r) => { r.weeks = [{w: 1795000000}]; }],
    ['an object in days', (r) => { r.weeks[0].d = [POISON, 1, 1, 1, 1, 1, 1]; }],
    ['weeks not a list', (r) => { r.weeks = {length: 1e300}; }],
    ['hasOwnProperty in languages', (r) => { r.langs = {hasOwnProperty: 1, JS: 2}; }],
    ['a poisoned language', (r) => { r.langs = {JS: POISON}; }],
    ['a repo that is not an object', (r, d) => { d.repos.push(null); }],
    ['repos not a list', (r, d) => { d.repos = {length: 3}; }]]) {
    const rec = JSON.parse(JSON.stringify(kept));
    change(rec.data.repos[0], rec.data);
    const next = load(Object.assign({}, GH, {storage: Object.assign(seed.storage.dump(), {'fmtv.github': rec}), now: NOW + 3600000}));
    assertStarted(next, what);
    assert.equal(typeof next.json('GitHub.summary()').last30, 'number', what + ': the summary works');
    assert.ok(next.requests.some((r) => /api\.github\.com/.test(r.url)), what + ': GitHub is asked again');
  }
});

test("ST24 GitHub: a commit message or date that can't become text doesn't leave GitHub busy", () => {
  const rules = githubRules(GOOD_WEEKS, {JavaScript: 100});
  rules[2] = {url: /\/commits\?per_page=1/, body: [{commit: {message: POISON, committer: {date: POISON}}}]};
  const app = load(Object.assign({}, GH, {xhr: rules}));
  try { app.advance(0); } catch (e) { /* the unguarded line throws here */ }
  const repos = () => app.requests.filter((r) => /\/user\/repos/.test(r.url)).length;
  const before = repos();
  app.eval('GitHub.refresh(true)');
  assert.equal(repos(), before + 1, 'a forced refresh asks GitHub again');
  app.advance(0);
  assertStarted(app, 'after the answers');
});

// MARK: - ST24: Stasera

test('ST24 Stasera: a bad answer does not throw, does not break the next start, and a good one replaces it', () => {
  const bad = {watching: [null, 7, {kind: 'show', titleId: 2, watched: 1, airDate: '2026-11-23', backdropPath: '/x.jpg', providers: ['Netflix']}],
    watchingCount: POISON, wantToStart: 'abc', movies: {length: 3}, friends: [null, {entity: null}],
    watchingShelves: {watching: {length: 1e300}},
    stats: {hourCounts: [1, POISON], byMonth: {length: 5}, topNetworks: 'x', completions: {latest: {length: 2}}},
    greeting: {text: POISON, lang: 'en'}};
  const app = staseraApp({xhr: [{url: /stasera\.test\/tv\/home/, body: bad}]});
  app.advance(0);
  assertStarted(app, 'after the answer');
  const next = staseraApp({storage: app.storage.dump(), now: NOW + 3600000});
  assertStarted(next, 'the next start');
  assert.ok(next.requests.some((r) => /\/tv\/home/.test(r.url)), 'Stasera is asked again');
  next.request(/\/tv\/home/).respond(200, HOME);
  assert.equal(next.eval('Stasera.home().watching.length'), 1, 'the good answer is drawn');
});

test('ST24 Stasera: a huge hourCounts length in the cache does not hang the start', () => {
  const r = isolated(function (loadApp, input) {
    const app = loadApp({config: input.config, storage: input.storage});
    return {ranToEnd: typeof app.window.FrameTV === 'object', asked: app.requests.map((x) => x.url)};
  }, {config: STASERA.config, storage: {'fmtv.stasera.token': 'fake-stasera-token',
    'fmtv.stasera.home2': {data: {watching: [], wantToStart: [], movies: [], friends: [],
      stats: {totalEpisodes: 1, hourCounts: {length: 1e300}}}, at: NOW}}});
  assert.equal(r.ranToEnd, true);
  assert.ok(r.asked.some((u) => /\/tv\/home/.test(u)), 'Stasera is asked');
});

test('ST24 Stasera: a cached record of the wrong types is cleaned or dropped at start', () => {
  for (const c of [{data: 'x'}, {data: {watching: 'abc', stats: 5}, name: POISON, hello: {text: POISON, lang: 'en', at: NOW}},
    {data: {watching: [null, {title: POISON}]}}, 7]) {
    const app = staseraApp({storage: {'fmtv.stasera.token': 'fake-stasera-token', 'fmtv.stasera.home2': c}});
    assertStarted(app, JSON.stringify(c));
    assert.ok(app.requests.some((r) => /\/tv\/home/.test(r.url)), 'Stasera is asked');
  }
});

// MARK: - Each module on its own

test('a module that throws while drawing leaves the others drawn, the apps loaded and the refresh sent', () => {
  const on = {config: {github: true, githubToken: 'fake-github-token-not-real', art: true, artUrl: 'http://art.test:8099',
    stasera: true, staseraUrl: 'https://stasera.test'}, storage: {'fmtv.stasera.token': 'fake-stasera-token'}};
  const planted = [
    ['GitHub.summary', {'github.js': "GitHub.summary = function () { throw new Error('planted by the test'); };"}, 'GitHub'],
    ['Art.showing', {'art.js': "Art.showing = function () { throw new Error('planted by the test'); };"}, 'Art Mode'],
    ['Stasera.home', {'stasera.js': "Stasera.home = function () { throw new Error('planted by the test'); };"}, 'Stats'],
    ['Data.degrees', {'data.js': "Data.degrees = function () { throw new Error('planted by the test'); };"}, 'Oslo']];
  for (const [what, after, label] of planted) {
    const app = load(Object.assign({}, on, {after}));
    const s = assertStarted(app, what);
    assert.ok(s.homeLabels.length >= 3, what + ': the other tiles are drawn (' + s.homeLabels.join(', ') + ')');
    for (const other of ['GitHub', 'Art Mode', 'Stats']) {
      if (other !== label && !(what === 'Stasera.home' && other === 'Stats')) assert.ok(s.homeLabels.indexOf(other) >= 0, what + ': ' + other + ' is drawn');
    }
    assert.ok(s.asked.some((u) => /open-meteo/.test(u)), what + ': the weather was asked for');
    assert.ok(s.asked.some((u) => /api\.github\.com/.test(u)), what + ': GitHub was asked');
    app.advance(30000);   // the interval and the clock run on
  }
});

// MARK: - Round 2: YouTube, Spotify and the rest at home.js's top level; Stasera's fields; GitHub's languages

const YT = {config: {youtube: true, youtubeClientId: 'fake-client-id', youtubeClientSecret: 'fake-client-secret'}};

/** YouTube signed in (made-up refresh token), with a cache of these playlists. */
function youtubeStorage(playlists) {
  return {'fmtv.youtube.auth': {refresh: 'fake-refresh-token', access: '', expires: 0, name: 'Fake'},
    'fmtv.youtube': {client: 'fake-client-id', data: {channels: [], playlists, channelsAt: NOW, videos: [], saved: [],
      savedFor: '', at: NOW}}};
}

test('round 2: a YouTube cache whose playlist throws in playlist() does not stop the start', () => {
  for (const playlists of [[{id: 'p1', title: 5}], [null]]) {
    const app = load(Object.assign({}, YT, {storage: youtubeStorage(playlists)}));
    assertStarted(app, JSON.stringify(playlists));
    assert.equal(app.eval('YouTube.linked()'), true, 'YouTube is signed in');
    assert.ok(app.requests.some((r) => /open-meteo/.test(r.url)), 'the weather was asked for');
    app.advance(30000);
  }
});

test('round 2: YouTube or Spotify throwing at the top of home.js leaves the rest started', () => {
  for (const [what, after] of [
    ['YouTube.videos', {'youtube.js': "YouTube.videos = function () { throw new Error('planted by the test'); };"}],
    ['YouTube.linked', {'youtube.js': "YouTube.linked = function () { throw new Error('planted by the test'); };"}],
    ['Spotify.enabled', {'spotify.js': "Spotify.enabled = function () { throw new Error('planted by the test'); };"}]]) {
    const app = load(Object.assign({}, YT, {storage: youtubeStorage([]), after}));
    assertStarted(app, what);
    app.advance(30000);
  }
});

test('round 2: a Stasera title or friend with fields of the wrong type costs that item, not the TV tab', () => {
  const pushed = '2026-11-23';
  const good = {kind: 'show', titleId: 1, title: 'Fake Show', providers: ['Netflix'], networks: [], watched: 2, total: 8,
    seasonNumber: 1, episodeNumber: 3, airDate: pushed, backdropPath: '/a.jpg'};
  const bad = Object.assign({}, good, {titleId: 2, title: 'Fake Bad', episodeName: POISON, airDate: POISON, year: POISON,
    seasonNumber: POISON});
  const friend = {kind: 'episode-watch', friendName: 5, count: 1, at: NOW - 3600000,
    entity: {kind: 'show', titleId: 3, title: 'Fake Friend Show', backdropPath: '/b.jpg', year: POISON}};
  const home = {watching: [good, bad], watchingCount: 2, wantToStart: [], movies: [], friends: [friend], stats: null};
  const app = staseraApp({xhr: [{url: /stasera\.test\/tv\/home/, body: home}]});
  app.advance(0);
  const rows = app.document.getElementById('rows');
  const lanes = rows.querySelectorAll('.lane h2').map((n) => n.textContent);
  assert.ok(lanes.some((t) => /^Apps/.test(t)), 'the Apps lane is drawn (' + lanes.join(', ') + ')');
  assert.ok(lanes.length >= 2, 'and the Stasera lanes too (' + lanes.join(', ') + ')');
  assert.ok(rows.textContent.indexOf('Fake Show') >= 0, 'the good title is on the TV tab');
  assertStarted(app, 'after the answer');
  const next = staseraApp({storage: app.storage.dump(), now: NOW + 60000});
  assertStarted(next, 'the next start from the cache');
  assert.ok(next.document.getElementById('rows').querySelectorAll('.lane').length >= 2, 'the TV tab is drawn from the cache');
});

test('round 2: GitHub keeps no language named after an Object method', () => {
  const seed = load(Object.assign({}, GH, {xhr: githubRules(GOOD_WEEKS, {hasOwnProperty: 1, toString: 3, JavaScript: 2})}));
  seed.advance(0);
  for (const app of [seed, load(Object.assign({}, GH, {storage: (() => {
    const s = seed.storage.dump(), rec = JSON.parse(s['fmtv.github']);
    rec.data.repos[0].langs = {hasOwnProperty: 1, valueOf: 4, JavaScript: 2};
    s['fmtv.github'] = JSON.stringify(rec);
    return s;
  })(), now: NOW + 60000}))]) {
    const langs = app.json('GitHub.summary().languages');
    assert.deepEqual(langs.map((l) => l.name), ['JavaScript']);
    assert.ok(langs.every((l) => typeof l.bytes === 'number'), JSON.stringify(langs));
  }
});

// MARK: - Round 3: Data.refresh and the 30-second loop

test('round 3: Data.refresh throwing still lets Stasera and GitHub be asked', () => {
  let caught = null;
  try {
    load({config: {github: true, githubToken: 'fake-github-token-not-real', stasera: true, staseraUrl: 'https://stasera.test'},
      storage: {'fmtv.stasera.token': 'fake-stasera-token'},
      after: {'data.js': "Data.refresh = function () { throw new Error('planted by the test'); };"}});
  } catch (e) { caught = e; }
  // The approved smoke test wants this throw to reach the start (smoke.test.js:107); what matters here is who was asked.
  const app = caught ? caught.app : null;
  assert.ok(app, 'the start threw as the smoke test expects');
  const asked = app.requests.map((r) => r.url);
  assert.ok(asked.some((u) => /stasera\.test\/tv\/home/.test(u)), 'Stasera was asked (' + asked.join(', ') + ')');
  assert.ok(asked.some((u) => /api\.github\.com/.test(u)), 'GitHub was asked');
});

/** Whether Frame TV's own screensaver is showing. */
function saverShown(app) { return /\bon\b/.test(app.document.getElementById('saver').className); }

test('round 3: a module that throws in the 30-second loop does not stop the screensaver', () => {
  for (const [what, opts] of [
    ['Stasera.showcase', Object.assign({}, STASERA, {xhr: [{url: /stasera\.test/, body: HOME}],
      after: {'stasera.js': "Stasera.showcase = function () { throw new Error('planted by the test'); };"}})],
    ['Spotify.now', {after: {'spotify.js': "Spotify.now = function () { throw new Error('planted by the test'); };"}}],
    ['Art.saverAllowed', {config: {art: true, artUrl: 'http://art.test:8099'},
      xhr: [{url: /art\.test:8099\/saver/, status: 500, body: {ok: false}}, {url: /art\.test:8099\//, body: {ok: true}}],
      after: {'art.js': "Art.saverAllowed = function () { throw new Error('planted by the test'); };"}}],
    ['Art.saver', {config: {art: true, artUrl: 'http://art.test:8099'}, xhr: [{url: /art\.test:8099\//, body: {ok: true}}],
      after: {'art.js': "Art.saver = function () { throw new Error('planted by the test'); };"}}]]) {
    const app = load(opts);
    assertStarted(app, what);
    app.advance(16 * 60000);   // past the 15 idle minutes
    assert.equal(saverShown(app), true, what + ': our screensaver started');
    app.advance(60000);
    const errors = app.requests.filter((r) => /\/event$/.test(r.url) && /"kind":"error"/.test(r.body || '')).length;
    assert.equal(errors, 0, what + ': no error events every 30 s');
  }
});

test("a module whose refresh throws doesn't stop the others' refresh", () => {
  const app = load({config: {github: true, githubToken: 'fake-github-token-not-real', stasera: true, staseraUrl: 'https://stasera.test'},
    storage: {'fmtv.stasera.token': 'fake-stasera-token'},
    after: {'stasera.js': "Stasera.refresh = function () { throw new Error('planted by the test'); };"}});
  const s = assertStarted(app, 'Stasera.refresh throws');
  assert.ok(s.asked.some((u) => /api\.github\.com/.test(u)), 'GitHub, after Stasera, was asked');
  app.advance(30000);
});
