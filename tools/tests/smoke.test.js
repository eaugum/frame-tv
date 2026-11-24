'use strict';
// Smoke tests of the harness itself: web/ loads and starts, a scripted answer reaches localStorage, a request can throw.
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadApp, scripts} = require('./harness');

/** An Open-Meteo answer with made-up numbers. */
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

test('web/ loads in index.html order and the home screen starts, with no network answers', () => {
  assert.deepEqual(scripts().slice(0, 3), ['config.js', 'i18n.js', 'strings.js']);
  assert.equal(scripts()[scripts().length - 1], 'home.js');
  const app = loadApp();
  assert.equal(app.eval('TV.name'), 'browser', 'no tizen object: tv.js uses its stand-in');
  assert.equal(typeof app.window.FrameTV, 'object', 'home.js ran to its end');
  assert.ok(app.document.getElementById('tabs').children.length > 0, 'the tab bar is drawn');
  assert.ok(app.requests.length > 0, 'it asked for something (the weather)');
  assert.ok(app.requests.every((r) => !r.done), 'and nothing answered');
  app.advance(2 * 60 * 60000);   // two hours of its own timers, still without answers
  app.key('right');
  app.key('ok');
  app.key('back');
});

test('a scripted answer arrives and is kept in localStorage; a pre-filled value is read', () => {
  const app = loadApp({
    storage: {'fmtv.prefs': {theme: 'dark'}},
    xhr: [{url: /api\.open-meteo\.com/, status: 200, body: forecast()}]
  });
  assert.equal(app.eval('Prefs.theme()'), 'dark');
  assert.equal(app.eval('Data.weather'), null, 'no answer before the clock moves');
  app.advance(0);
  const kept = JSON.parse(app.storage.getItem('fmtv.weather'));
  assert.equal(kept.body.current.temperature_2m, 3.4);
  assert.equal(kept.at, app.clock.now());
  assert.equal(app.eval('Data.weather.temp'), 3.4);

  // The same answer as a cache: a new start draws it without asking again inside 30 minutes.
  const again = loadApp({storage: app.storage.dump(), now: app.clock.now() + 60000});
  assert.equal(again.eval('Data.weather.temp'), 3.4);
  assert.equal(again.requests.filter((r) => /open-meteo/.test(r.url)).length, 0);
});

test('a request answered by hand, a failed one and a timed-out one', () => {
  const app = loadApp();
  app.request(/open-meteo/).fail();
  assert.equal(app.eval('Data.weather'), null);
  app.advance(30000);   // home.js refreshes every 30 s: it asks again
  app.request(/open-meteo/).expire();
  app.advance(30000);
  app.request(/open-meteo/).respond(200, forecast());
  assert.equal(app.eval('Data.weather.temp'), 3.4);
});

test('a request with a timeout and no answer expires when the clock passes it; one without stays pending', () => {
  const app = loadApp();
  const weather = app.request(/open-meteo/);
  assert.equal(weather.timeout, 10000, 'data.js asks with a 10 s timeout');
  app.advance(9999);
  assert.equal(weather.done, false);
  app.advance(1);
  assert.equal(weather.done, true);
  assert.equal(weather.readyState, 4);
  assert.equal(weather.status, 0);

  app.eval("var seen = []; var t = new XMLHttpRequest(); t.open('GET', 'https://fake.test/t', true); t.timeout = 500;" +
    "t.onreadystatechange = function () { seen.push('readystatechange ' + t.readyState); };" +
    "t.ontimeout = function () { seen.push('timeout'); }; t.onload = function () { seen.push('load'); }; t.send();" +
    "var n = new XMLHttpRequest(); n.open('GET', 'https://fake.test/no-timeout', true); n.send();");
  app.advance(500);
  assert.deepEqual(app.json('seen'), ['readystatechange 4', 'timeout']);
  app.advance(24 * 60 * 60000);
  assert.equal(app.request('fake.test/no-timeout').done, false);
});

test('a later app.xhr rule goes before the earlier ones', () => {
  const app = loadApp({xhr: [{url: /open-meteo/, body: forecast()}]});
  app.advance(0);
  assert.equal(app.eval('Data.weather.temp'), 3.4);
  const warmer = forecast();
  warmer.current.temperature_2m = 7;
  app.xhr({url: /open-meteo/, body: warmer});
  app.advance(31 * 60000);   // the weather is asked again after 30 minutes
  assert.equal(app.eval('Data.weather.temp'), 7);
});

test('days of timers in one advance; a zero-delay loop is stopped', () => {
  const app = loadApp({xhr: [{url: /open-meteo/, body: forecast()}]});
  app.advance(3 * 24 * 60 * 60000);
  assert.equal(app.clock.now(), Date.UTC(2026, 10, 27, 11, 0, 0));
  app.eval('function again() { setTimeout(again, 0); } again()');
  assert.throws(() => app.advance(1000), /zero-delay loop/);
});

test('a script that throws while loading leaves the half-loaded app on the error', () => {
  let caught = null;
  assert.throws(() => loadApp({
    storage: {'fmtv.prefs': {theme: 'dark'}},
    after: {'data.js': "Data.refresh = function () { throw new Error('planted by the test'); }"}
  }), (e) => { caught = e; return /^web\/home\.js threw while loading: .*planted by the test/s.test(e.message); });
  const app = caught.app;
  assert.equal(app.eval('Prefs.theme()'), 'dark', 'the scripts before home.js had loaded');
  assert.equal(app.storage.getItem('fmtv.prefs'), '{"theme":"dark"}');
  assert.equal(typeof app.window.FrameTV, 'undefined', 'home.js stopped before its end');
  assert.throws(() => loadApp({after: {'tv.js': "throw new Error('right after tv.js')"}}),
    /the test's code after web\/tv\.js threw while loading/);
});
test('a fake XHR whose open, setRequestHeader or send throws', () => {
  const app = loadApp();
  app.xhr({url: /fake\.test\/open/, throwOn: 'open'});
  app.xhr({url: /fake\.test\/header/, throwOn: 'setRequestHeader', header: 'Authorization'});
  app.xhr({url: /fake\.test\/send/, throwOn: 'send'});
  assert.throws(() => app.eval("new XMLHttpRequest().open('GET', 'https://fake.test/open', true)"), /open threw/);
  assert.throws(() => app.eval(
    "var x = new XMLHttpRequest(); x.open('GET', 'https://fake.test/header', true); x.setRequestHeader('Accept', 'a');" +
    "x.setRequestHeader('Authorization', 'Bearer fake')"), /setRequestHeader\(Authorization\) threw/);
  assert.throws(() => app.eval("var y = new XMLHttpRequest(); y.open('GET', 'https://fake.test/send', true); y.send()"),
    /send threw/);
  // Other requests are not affected.
  app.eval("var z = new XMLHttpRequest(); z.open('GET', 'https://fake.test/other', true); z.send()");
  assert.equal(app.request('fake.test/other').sent, true);
});

test('an exception in a timer or a handler reaches the test', () => {
  const app = loadApp();
  app.eval("setTimeout(function () { throw new Error('boom in a timer'); }, 1000)");
  assert.throws(() => app.advance(1000), /boom in a timer/);
  app.eval("var w = new XMLHttpRequest(); w.open('GET', 'https://fake.test/w', true);" +
    "w.onload = function () { throw new Error('boom in onload'); }; w.send()");
  assert.throws(() => app.request('fake.test/w').respond(200, {}), /boom in onload/);
});
