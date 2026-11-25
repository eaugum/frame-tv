'use strict';
// AUG-1790: tools/setup.html takes its key from the opened link only, sends only the fields that changed, and shows a
// run that goes on after a reload. The page's own script, in Node's vm with the fake DOM and a fake setup.py.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {documentFrom} = require('./dom');

// SETUP_HTML: another copy of the page (an older one had the key put in by the server at {{KEY}}).
const KEY = 'FAKE-KEY-1790';
const HTML = fs.readFileSync(process.env.SETUP_HTML || path.join(__dirname, '..', 'setup.html'), 'utf8')
  .replace('{{KEY}}', KEY);
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(HTML)[1];
const LINK = 'Open the link that tools/setup.py printed in the terminal.';
const BUTTONS = ['save', 'install', 'root-status', 'root-apply', 'root-restore'];

/** setup.py as the page sees it: the file's values, what runs, and every request. */
function fakeServer() {
  const keys = [{key: 'name', kind: 'text'}, {key: 'temperature', kind: 'choice', choices: ['auto', 'C', 'F']},
                {key: 'language', kind: 'choice', choices: ['auto', 'en', 'nb']}];
  const srv = {
    file: {name: 'Ada', temperature: 'auto', language: 'auto'}, running: null, ok: null, requests: [],
    answer(url, method, key, body) {
      srv.requests.push({url, method, key, body});
      if (key !== KEY) return [403, {error: 'forbidden'}];
      if (url === '/api/config' && method === 'GET') {
        return [200, {path: '/fake/config.properties', exists: true, problems: [], sections: [{title: 'Home', note: '',
          keys: keys.map((k) => Object.assign({help: '', example: '', value: srv.file[k.key]}, k))}]}];
      }
      if (url === '/api/config') { Object.assign(srv.file, body.values); return [200, {ok: true}]; }
      if (url === '/api/status') return [200, {running: srv.running, ok: srv.ok}];
      if (url === '/api/from-tv') return [200, {}];
      return [404, {error: 'not found'}];
    }
  };
  return srv;
}

/** The page opened at "/" + hash, in a tab whose sessionStorage is `tab` (a reload keeps it). */
async function open(srv, hash, tab) {
  const doc = documentFrom(HTML);
  const timers = [];
  const win = {
    document: doc, console, TextDecoder, URL,
    location: {hash: hash || '', pathname: '/', search: ''},
    history: {replaceState(state, title, url) { win.replaced = url; win.location.hash = ''; }},
    sessionStorage: {getItem: (k) => (tab.has(k) ? tab.get(k) : null), setItem: (k, v) => { tab.set(k, String(v)); }},
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    clearInterval: (id) => { timers[id - 1] = null; },
    setTimeout: (fn) => { timers.push(null); return 0; },
    addEventListener() {}, confirm: () => true, open() {},
    async fetch(url, o) {
      const headers = o.headers || {};
      const [status, body] = srv.answer(url, o.method || 'GET', headers['X-Setup'], o.body ? JSON.parse(o.body) : null);
      return {ok: status < 400, status, json: async () => body};
    }
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SCRIPT, win);
  await settle();
  return {
    win, doc,
    text: () => doc.body.textContent.replace(/\s+/g, ' ').trim(),
    status: () => doc.getElementById('status').textContent,
    disabled: () => BUTTONS.map((id) => doc.getElementById(id).disabled === true),
    field(key) {
      const label = doc.querySelectorAll('label').find((l) => l.textContent === key);
      return label.parentNode.querySelector('input') || label.parentNode.querySelector('select');
    },
    type(key, value) {
      const f = this.field(key);
      f.value = value;
      (f.oninput || f.onchange)();
    },
    async save() { await doc.getElementById('save').onclick(); await settle(); },
    async tick() { for (const fn of timers) if (fn) fn(); await settle(); }
  };
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

test('without a key the page asks for the link and calls nothing', async () => {
  const srv = fakeServer();
  const page = await open(srv, '', new Map());
  assert.equal(page.text(), LINK);
  assert.equal(srv.requests.length, 0);
});

test('a wrong key gives the same and nothing else', async () => {
  const srv = fakeServer();
  const page = await open(srv, '#key=wrong-1790', new Map());
  assert.equal(page.text(), LINK);
  await page.tick();
  assert.equal(page.text(), LINK);
  assert.ok(srv.requests.every((r) => r.key === 'wrong-1790'));
});

test('the key comes from the link, leaves the address bar, and a reload keeps it', async () => {
  const srv = fakeServer(), tab = new Map();
  const page = await open(srv, '#key=' + KEY, tab);
  assert.equal(page.win.replaced, '/');
  assert.equal(page.win.location.hash, '');
  assert.equal(page.status(), 'Loaded.');
  assert.ok(srv.requests.length > 0 && srv.requests.every((r) => r.key === KEY));
  const again = await open(srv, '', tab);   // reload: the address has no key any more
  assert.equal(again.status(), 'Loaded.');
  assert.equal(again.win.replaced, undefined);
  assert.equal((await open(srv, '', new Map())).text(), LINK);   // another tab doesn't have it
});

test('save sends only the fields that changed', async () => {
  const srv = fakeServer();
  const page = await open(srv, '#key=' + KEY, new Map());
  page.type('name', 'Bo');
  await page.save();
  page.type('temperature', 'F');
  await page.save();
  await page.save();
  const posts = srv.requests.filter((r) => r.method === 'POST' && r.url === '/api/config').map((r) => r.body.values);
  assert.deepEqual(JSON.parse(JSON.stringify(posts)), [{name: 'Bo'}, {temperature: 'F'}, {}]);
  assert.equal(page.status(), 'Saved.');
});

test('two pages saving different fields keep both, and an older page does not undo an accepted upload', async () => {
  const srv = fakeServer();
  const a = await open(srv, '#key=' + KEY, new Map()), b = await open(srv, '#key=' + KEY, new Map());
  srv.file.language = 'nb';   // accepted from the TV after both pages loaded
  a.type('name', 'Bo');
  await a.save();
  b.type('temperature', 'F');
  await b.save();
  assert.deepEqual(srv.file, {name: 'Bo', temperature: 'F', language: 'nb'});
  b.type('name', 'Cy');   // the same field from two pages: the last wins
  await b.save();
  assert.equal(srv.file.name, 'Cy');
});

test('English can be picked', async () => {
  const srv = fakeServer();
  const page = await open(srv, '#key=' + KEY, new Map());
  assert.deepEqual(page.field('language').childNodes.map((o) => o.value), ['auto', 'en', 'nb']);
  page.type('language', 'en');
  await page.save();
  assert.equal(srv.file.language, 'en');
});

test('a page loaded while something runs says so, with the buttons off, until it is done', async () => {
  for (const [running, still, done] of [
    ['install', 'Still running: build and install. It goes on without this page.', 'Build and install finished.'],
    ['root', 'Still running: the root script. It goes on without this page.', 'The root script finished.']]) {
    const srv = fakeServer();
    srv.running = running;
    const page = await open(srv, '#key=' + KEY, new Map());
    assert.equal(page.status(), still);
    assert.deepEqual(page.disabled(), BUTTONS.map(() => true));
    await page.tick();
    assert.equal(page.status(), still);
    assert.deepEqual(page.disabled(), BUTTONS.map(() => true));
    srv.running = null;
    srv.ok = true;
    await page.tick();
    assert.equal(page.status(), done);
    assert.deepEqual(page.disabled(), BUTTONS.map(() => false));
  }
});

test('a run that ended badly while the page was away says so', async () => {
  const srv = fakeServer();
  srv.running = 'install';
  const page = await open(srv, '#key=' + KEY, new Map());
  srv.running = null;
  srv.ok = false;
  await page.tick();
  assert.equal(page.status(), 'Build and install stopped with an error.');
  assert.deepEqual(page.disabled(), BUTTONS.map(() => false));
});
