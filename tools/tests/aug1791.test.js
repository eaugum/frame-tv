'use strict';
// AUG-1791: a saver_every of 0 (or junk) in the build, in a stored setting or in the old fmtv.prefs must not give a
// screensaver loop without a pause; youtube_shelf and the place come from config.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadApp} = require('./harness');

const MIN = 60000;
const BAD = [1441, 1e12, Infinity, 0, '0', -3, 'abc', null, NaN, 0.4];

function saverShown(app) { return /\bon\b/.test(app.document.getElementById('saver').className); }

/** The app idle past its saver minutes: our own screensaver starts (no Frame Art, no Stasera photos). */
function idle(options) {
  const o = Object.assign({config: {}}, options);
  o.config = Object.assign({saverMinutes: 1}, o.config);
  const app = loadApp(o);
  app.advance(3 * MIN);   // throws when a timer keeps rescheduling itself without the clock moving
  return app;
}

test('saver_every in config.js: 0 and junk fall back to the default 5', () => {
  for (const bad of BAD) {
    const app = loadApp({config: {saverEvery: bad}});
    assert.equal(app.eval('Prefs.saverEvery()'), 5, 'config ' + JSON.stringify(bad));
  }
  assert.equal(loadApp({config: {saverEvery: 2}}).eval('Prefs.saverEvery()'), 2);
});

test('saver_every stored on the TV (fmtv.settings) or in the old fmtv.prefs: 0 and junk fall back', () => {
  for (const bad of BAD) {
    const stored = loadApp({storage: {'fmtv.settings': {saverEvery: {v: bad, file: 'null'}}}});
    assert.equal(stored.eval('Prefs.saverEvery()'), 5, 'settings ' + JSON.stringify(bad));
    const old = loadApp({storage: {'fmtv.prefs': {saverEvery: bad}}});
    assert.equal(old.eval('Prefs.saverEvery()'), 5, 'old prefs ' + JSON.stringify(bad));
  }
  assert.equal(loadApp({storage: {'fmtv.settings': {saverEvery: {v: 10, file: 'null'}}}}).eval('Prefs.saverEvery()'), 10);
});

test('the screensaver with saver_every 0 pauses between its pictures', () => {
  for (const options of [{config: {saverEvery: 0}},
    {storage: {'fmtv.settings': {saverEvery: {v: 0, file: 'null'}}}},
    {storage: {'fmtv.prefs': {saverEvery: 0}}}]) {
    const app = idle(options);
    assert.equal(saverShown(app), true, 'our screensaver started');
    const waits = app.clock.pending().map((t) => t.at - app.clock.now());
    assert.ok(waits.every((w) => w > 0), 'no timer is due at once: ' + waits.join(', '));
    assert.ok(waits.some((w) => w >= 3 * MIN), 'the next picture is minutes away: ' + waits.join(', '));
  }
});

test('a stored saver_every of 0 is not uploaded as 0 (the build would refuse the whole upload)', () => {
  const app = loadApp({storage: {'fmtv.settings': {saverEvery: {v: 0, file: 'null'}}}});
  assert.equal(app.eval('Settings.get("saverEvery")'), 5);
});

test('youtube_shelf and the place in config.js are read', () => {
  const app = loadApp({config: {youtubeShelf: ['com.a', 'com.b'], latitude: '60.39', longitude: '5.32', city: 'Bergen'}});
  assert.deepEqual(app.json('Prefs.youtubeShelf()'), ['com.a', 'com.b']);
  assert.deepEqual(app.json('[Place.lat, Place.lon, Place.city]'), ['60.39', '5.32', 'Bergen']);
});

test('the place and the YouTube shelf picked on the TV are among what "Upload config" sends', () => {
  // uploadConfig() sends each Settings key that changed on the TV, by the name in config.js.
  const app = loadApp();
  app.eval('Settings.set("latitude", "60.39"); Settings.set("longitude", "5.32"); Settings.set("city", "Bergen"); ' +
    'Settings.set("youtubeShelf", ["com.a"]);');
  const sent = app.json('(function () { var o = {}; Settings.keys().forEach(function (k) { if (Settings.changed(k)) o[k] = Settings.get(k); }); return o; })()');
  assert.deepEqual(sent, {latitude: '60.39', longitude: '5.32', city: 'Bergen', youtubeShelf: ['com.a']});
});
