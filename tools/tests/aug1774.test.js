'use strict';
// AUG-1774: what art.js sends to Frame Art's /event never holds half an emoji (a lone UTF-16 surrogate), which the
// add-on can't encode as UTF-8. The address and the key are made up.
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadApp} = require('./harness');

const ART = 'http://127.0.0.1:8099';
const EMOJI = '😀';   // one emoji, two UTF-16 units

/** True when s has a surrogate that isn't half of a pair. */
function lone(s) {
  return /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);
}

/** As the add-on: a body with a lone surrogate can't be encoded, and the answer is an error. */
function addOn(x) {
  const events = JSON.parse(x.body).events;
  const bad = events.some((e) => lone(String(e.kind)) || lone(String(e.detail)));
  return bad ? {status: 500, body: {ok: false, error: 'surrogates not allowed'}} : {status: 200, body: {ok: true}};
}

function load(storage) {
  const app = loadApp({
    config: {art: true, artUrl: ART, artKey: 'fake-key'},
    storage: storage || {},
    xhr: [{method: 'POST', url: /\/event$/, respond: addOn}]
  });
  app.advance(0);   // the start event goes out and is answered
  return app;
}

function eventPosts(app) {
  return app.requests.filter((r) => r.method === 'POST' && /\/event$/.test(r.url));
}

/** Logs one event and returns the body /event got for it, as text and parsed. */
function logged(app, kind, detail) {
  const before = eventPosts(app).length;
  app.eval('Art.event(' + JSON.stringify(kind) + ', ' + JSON.stringify(detail) + ')');
  const posts = eventPosts(app);
  assert.equal(posts.length, before + 1, 'the event went to /event');
  const body = posts[posts.length - 1].body;
  app.advance(0);
  const events = JSON.parse(body).events;
  return {body, event: events[events.length - 1], queue: app.storage.getItem('artEvents')};
}

/** Nothing in the body or the queue is a lone surrogate; JSON.stringify writes those as \udXXX escapes. */
function assertWellFormed(r, what) {
  assert.doesNotMatch(r.body, /\\ud[89a-f][0-9a-f]{2}/i, what + ': no \\udXXX escape in the body');
  assert.equal(lone(r.event.detail), false, what + ': the detail has no lone surrogate');
  assert.equal(lone(String(r.event.kind)), false, what + ': the kind has no lone surrogate');
  assert.ok(r.event.detail.length <= 300, what + ': the detail is at most 300 units (' + r.event.detail.length + ')');
  assert.equal(r.queue, '[]', what + ': the add-on took it, the queue is empty');
}

test('an emoji across position 300 is left out whole, not cut in half', () => {
  const app = load();
  const r = logged(app, 'error', 'a'.repeat(299) + EMOJI + ' and more');
  assertWellFormed(r, 'emoji at 299/300');
  assert.equal(r.event.detail, 'a'.repeat(299));
});

test('an emoji that ends at position 300 stays', () => {
  const app = load();
  const r = logged(app, 'error', 'a'.repeat(298) + EMOJI + 'b');
  assertWellFormed(r, 'emoji at 298/299');
  assert.equal(r.event.detail, 'a'.repeat(298) + EMOJI);
});

test('a lone surrogate in the text itself becomes U+FFFD', () => {
  const app = load();
  const r = logged(app, 'open', 'x\ud83dy\ude00z' + EMOJI + '\ud83d');
  assertWellFormed(r, 'lone surrogates in the input');
  assert.equal(r.event.detail, 'x�y�z' + EMOJI + '�');
});

test('10 000 units of mixed text: at most 300, no half emoji', () => {
  const app = load();
  // 'z', then 'ab' and an emoji over and over: an emoji's first half lands at 299.
  const s = ('z' + ('ab' + EMOJI).repeat(2500)).slice(0, 10000);
  assert.equal(s.charCodeAt(299), 0xd83d);
  const r = logged(app, 'error', s);
  assertWellFormed(r, '10 000 units');
  assert.equal(r.event.detail.length, 299, 'all but the emoji at 299');
  assert.equal(s.indexOf(r.event.detail), 0, 'a prefix of the text');
});

test('plain text is unchanged, and ASCII over 300 is cut at 300', () => {
  const app = load();
  assert.equal(logged(app, 'open', 'netflix: Stranger Things').event.detail, 'netflix: Stranger Things');
  assert.equal(logged(app, 'open', 'Kaffe ' + EMOJI + ' på æøå').event.detail, 'Kaffe ' + EMOJI + ' på æøå');
  const r = logged(app, 'error', 'x'.repeat(301));
  assertWellFormed(r, 'ASCII');
  assert.equal(r.event.detail, 'x'.repeat(300));
  assert.equal(logged(app, 'start', '').event.detail, '');
  assert.equal(logged(app, 'start', undefined).event.detail, '');
});

test('the kind is cleaned the same way', () => {
  const app = load();
  const r = logged(app, 'saver_' + EMOJI + '\ud83d' + 'x'.repeat(100), 'detail');
  assertWellFormed(r, 'kind');
  assert.ok(r.event.kind.length <= 40, 'the kind is short (' + r.event.kind.length + ')');
  assert.equal(r.event.kind.indexOf('saver_' + EMOJI + '�'), 0);
  assert.equal(logged(app, 'open_failed', 'detail').event.kind, 'open_failed');
});

test('what waits in the queue holds no half emoji', () => {
  const app = load();
  // While a batch is out, a new event only waits in the queue.
  app.xhr({method: 'POST', url: /\/event$/, delay: 1000, respond: addOn});
  app.eval('Art.event("error", "first")');
  app.eval('Art.event("error", ' + JSON.stringify('a'.repeat(299) + EMOJI) + ')');
  const queue = app.storage.getItem('artEvents');
  assert.doesNotMatch(queue, /\\ud[89a-f][0-9a-f]{2}/i, 'no \\udXXX escape in the queue');
  assert.equal(JSON.parse(queue).pop().detail, 'a'.repeat(299));
  app.advance(1000);
  app.advance(1000);
  assert.equal(app.storage.getItem('artEvents'), '[]', 'both went out');
});

test('an event queued by the old version with half an emoji is cleaned when sent and no longer blocks', () => {
  const old = [
    {n: '1700000000000.0', at: 1700000000000, kind: 'error', detail: 'a'.repeat(299) + '\ud83d'},
    {n: '1700000000000.1', at: 1700000000001, kind: 'open', detail: 'netflix'}
  ];
  const app = load({artEvents: old});
  const first = eventPosts(app)[0];
  assert.doesNotMatch(first.body, /\\ud[89a-f][0-9a-f]{2}/i, 'no \\udXXX escape in the body');
  const sent = JSON.parse(first.body).events;
  assert.deepEqual(sent.map((e) => e.n), ['1700000000000.0', '1700000000000.1', sent[2].n], 'old ones first, then start');
  assert.equal(sent[0].detail, 'a'.repeat(299) + '�');
  assert.equal(sent[0].at, 1700000000000);
  assert.equal(sent[1].detail, 'netflix');
  assert.equal(first.status, 200, 'the add-on took the batch');
  assert.equal(app.storage.getItem('artEvents'), '[]', 'the queue is empty');
});

test('a stored queue that is not a list is read as empty, and art.js still starts', () => {
  for (const stored of ['{"a":1}', '5', '"str"', 'true', 'null', 'not json']) {
    const app = load({artEvents: stored});
    const posts = eventPosts(app);
    assert.equal(posts.length, 1, stored + ': the start event went out');
    assert.deepEqual(JSON.parse(posts[0].body).events.map((e) => e.kind), ['start'], stored + ': only the start event');
    assert.equal(app.storage.getItem('artEvents'), '[]', stored + ': the queue is empty after the answer');
  }
});

test('entries that are not events are dropped, and a batch the add-on took is not sent again', () => {
  const ok = {n: '1700000000000.0', at: 1700000000000, kind: 'open', detail: 'netflix'};
  const app = load({artEvents: [null, 5, 'str', true, ok]});
  const posts = eventPosts(app);
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].body).events.map((e) => e.n), [ok.n, JSON.parse(posts[0].body).events[1].n]);
  assert.equal(posts[0].status, 200, 'the add-on took the batch');
  assert.equal(app.storage.getItem('artEvents'), '[]', 'the queue is empty');
  app.advance(60 * 60000);   // an hour of refreshes (the screensaver logs new events meanwhile)
  const again = eventPosts(app).filter((r) => JSON.parse(r.body).events.some((e) => e.n === ok.n));
  assert.equal(again.length, 1, 'the batch the add-on took was not sent again');
});
