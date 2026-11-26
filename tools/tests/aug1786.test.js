'use strict';
// AUG-1786: "Upload config" is sealed with setup_key (web/seal.js, tools/seal.py): the same vectors pass here as in
// test_aug1786.py, the TV's own upload code is accepted by the real setup.py (fromtv_live.py on 127.0.0.1) and its
// replays, changes and wrong keys are not, and the setup page accepts only the list it showed. Every key and token
// here is made up; nothing leaves this Mac.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const {spawn} = require('node:child_process');
const {loadApp, ROOT} = require('./harness');
const {documentFrom} = require('./dom');

const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, 'seal_vectors.json'), 'utf8'));
const KEY = 'FAKE-SETUP-1786';
const SENT = 'Sent. Accept it on the setup page.';
const REFUSED = "The setup page didn't accept this TV: install the app from it again.";
const UNREACHABLE = "Couldn't reach the setup page. Is it running?";
const AGAIN = 'The TV sent again while this was shown: look at the list again before accepting.';
const REMOVED = 'Removed: a new address needs the token again';

// A transcript of the round trip, for the evidence folder when AUG1786_LOG names a file.
const transcript = [];
function note(line) { transcript.push(line); }
test.after(() => { if (process.env.AUG1786_LOG) fs.writeFileSync(process.env.AUG1786_LOG, transcript.join('\n') + '\n'); });

// MARK: - The vectors

/** web/seal.js on its own, in a vm. */
function sealJs() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web', 'seal.js'), 'utf8'), ctx, {filename: 'web/seal.js'});
  return vm.runInContext('Seal', ctx);
}

function bytesOf(v, Seal) {
  if (v.hex !== undefined) return Seal.unhex(v.hex);
  if (v.text !== undefined) return Seal.utf8(v.text);
  return Seal.utf8(v.repeat.repeat(v.times));
}

test('vectors: SHA-256 (FIPS 180-2 examples and the padding edges)', () => {
  const Seal = sealJs();
  for (const v of VECTORS.sha256) assert.equal(Seal.hex(Seal.sha256(bytesOf(v, Seal))), v.sha256, v.name);
});

test('vectors: HMAC-SHA256, RFC 4231 test cases 1-7', () => {
  const Seal = sealJs();
  for (const v of VECTORS.rfc4231) {
    const mac = Seal.hex(Seal.hmac(Seal.unhex(v.key), Seal.unhex(v.data)));
    assert.equal(mac.slice(0, v.hmac.length), v.hmac, 'case ' + v.case);
  }
});

test('vectors: UTF-8, the derived keys, the keystream and whole sealed bodies', () => {
  const Seal = sealJs();
  for (const v of VECTORS.utf8) assert.equal(Seal.hex(Seal.utf8(v.text)), v.hex, JSON.stringify(v.text));
  for (const v of VECTORS.derive) {
    const k = Seal.keys(v.setup_key);
    assert.equal(Seal.hex(k.enc), v.enc, v.setup_key);
    assert.equal(Seal.hex(k.mac), v.mac, v.setup_key);
  }
  for (const v of VECTORS.seal) {
    const k = Seal.keys(v.setup_key);
    assert.equal(Seal.hex(Seal.keystream(k.enc, v.nonce, v.tv, Seal.utf8(v.text).length)), v.keystream);
    assert.deepEqual(JSON.parse(JSON.stringify(Seal.seal(v.setup_key, v.nonce, v.tv, v.text))), v.body);
  }
});

test('the TV value is unique without crypto', () => {
  const app = loadApp();   // the harness has no window.crypto, as an old TV might not
  const a = app.eval('Seal.unique()'), b = app.eval('Seal.unique()');
  assert.match(a, /^[0-9a-z.]{1,64}$/);
  assert.notEqual(a, b);
});

// MARK: - The TV's upload

function clickText(root, selector, text) {
  const node = root.querySelectorAll(selector).filter((n) => n.textContent.indexOf(text) === 0)[0];
  if (!node) throw new Error('no ' + selector + ' starting with ' + JSON.stringify(text));
  node.click();
}

/** Home Settings → Upload config, as a person does. */
function pressUpload(app) {
  if (!/\bon\b/.test(app.document.getElementById('settings').className || '')) {
    app.document.getElementById('tabs').children[0].click();   // the gear
  }
  clickText(app.document.getElementById('settings'), '.row', 'Upload config');
}

function toast(app) { return app.document.getElementById('toast').textContent; }

const SETUP = 'http://192.0.2.1:8890';

test('the TV asks for a nonce, then sends only the sealed body: no setup_key, no settings in the clear', () => {
  const app = loadApp({config: {setupUrl: SETUP, setupKey: KEY, city: 'Bergen'}});
  app.eval('Settings.set("name", "Ada")');
  pressUpload(app);
  const get = app.request('/api/from-tv/nonce', 'GET');
  assert.equal(get.body, null);
  get.respond(200, {v: 1, nonce: '0123456789abcdef0123456789abcdef'});
  const post = app.request('/api/from-tv', 'POST');
  assert.equal(post.requestHeaders['Content-Type'], 'text/plain');
  const body = JSON.parse(post.body);
  assert.deepEqual(Object.keys(body).sort(), ['c', 'm', 'n', 't', 'v']);
  assert.equal(body.v, 1);
  assert.equal(body.n, '0123456789abcdef0123456789abcdef');
  assert.ok(post.body.indexOf(KEY) < 0 && post.body.indexOf('Ada') < 0, 'neither the key nor a value in the clear');
  post.respond(200, {ok: true});
  assert.equal(toast(app), SENT);
});

test('the TV says the same things as before: refused, unreachable, and a nonce the Mac refuses', () => {
  const cases = [
    [(app) => app.request('/api/from-tv/nonce').respond(403, {}), REFUSED],
    [(app) => app.request('/api/from-tv/nonce').fail(), UNREACHABLE],
    [(app) => app.request('/api/from-tv/nonce').respond(200, 'not json'), UNREACHABLE],
    [(app) => { app.request('/api/from-tv/nonce').respond(200, {nonce: 'old'}); app.request('/api/from-tv').respond(400, {}); }, UNREACHABLE],
    [(app) => { app.request('/api/from-tv/nonce').respond(200, {nonce: 'a'.repeat(32)}); app.request('/api/from-tv').respond(410, {}); }, UNREACHABLE],
    [(app) => { app.request('/api/from-tv/nonce').respond(200, {nonce: 'a'.repeat(32)}); app.request('/api/from-tv').respond(403, {}); }, REFUSED],
    [(app) => { app.request('/api/from-tv/nonce').expire(); }, UNREACHABLE]
  ];
  for (const [answer, said] of cases) {
    const app = loadApp({config: {setupUrl: SETUP, setupKey: KEY}});
    pressUpload(app);
    answer(app);
    assert.equal(toast(app), said);
    assert.equal(app.pending().filter((r) => r.url.indexOf(SETUP) === 0).length, 0, 'nothing more is sent');
  }
});

/** What the TV seals: the plaintext of its last upload, opened with the same code (web/seal.js) the other way. */
function plaintextOf(app, key) {
  const body = JSON.parse(app.requests.filter((r) => r.method === 'POST' && /from-tv$/.test(r.url)).pop().body);
  const Seal = sealJs();
  const k = Seal.keys(key);
  const c = Seal.unhex(body.c), s = Seal.keystream(k.enc, body.n, body.t, c.length);
  return JSON.parse(Buffer.from(c.map((b, i) => b ^ s[i])).toString('utf8'));
}

function upload(app) {
  pressUpload(app);
  app.request('/api/from-tv/nonce').respond(200, {nonce: 'b'.repeat(32)});
  app.request('/api/from-tv').respond(200, {});
}

test('a token goes only with the address it belongs to (AUG-1787), so the Mac can tell a new address from an old token', () => {
  const HA = {setupUrl: SETUP, setupKey: KEY, homeAssistant: true, homeAssistantUrl: 'http://ha.test:8123',
    homeAssistantToken: 'DUMMY-HA-1786'};
  // The address moved on the TV, the token not typed again: the address goes, the old token doesn't.
  let app = loadApp({config: HA});
  app.eval('Settings.set("homeAssistantUrl", "http://10.9.9.9:8123")');
  upload(app);
  let sent = plaintextOf(app, KEY).settings;
  assert.equal(sent.homeAssistantUrl, 'http://10.9.9.9:8123');
  assert.equal(sent.homeAssistantToken, undefined);
  // A token typed for the new address goes with it.
  app = loadApp({config: HA});
  app.eval('Settings.set("homeAssistantUrl", "http://10.9.9.9:8123"); Settings.set("homeAssistantToken", "DUMMY-NEW-1786")');
  upload(app);
  sent = plaintextOf(app, KEY).settings;
  assert.equal(sent.homeAssistantToken, 'DUMMY-NEW-1786');
  // A token removed on the TV goes as ''.
  app = loadApp({config: HA});
  app.eval('Settings.set("homeAssistantToken", "")');
  upload(app);
  assert.equal(plaintextOf(app, KEY).settings.homeAssistantToken, '');
});

// MARK: - The round trip, with the real setup.py

/** setup.py's two servers on 127.0.0.1 (fromtv_live.py), with a config of fake values. */
async function live(values, nonceSeconds) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aug1786-'));
  const config = path.join(dir, 'config.properties');
  fs.writeFileSync(config, Object.keys(values).map((k) => k + '=' + values[k]).join('\n') + '\n', {mode: 0o600});
  const args = ['-B', '-I', path.join(__dirname, 'fromtv_live.py'), config].concat(nonceSeconds ? [String(nonceSeconds)] : []);
  const child = spawn('python3', args, {stdio: ['pipe', 'pipe', 'inherit']});
  const ports = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (out.indexOf('\n') >= 0) resolve(JSON.parse(out.split('\n')[0])); });
    child.on('exit', (code) => reject(new Error('fromtv_live.py ended: ' + code)));
  });
  child.stdout.resume();
  return {
    ports, config,
    file: () => fs.readFileSync(config, 'utf8'),
    url: 'http://127.0.0.1:' + ports.tv,
    stop() { child.stdin.end(); child.kill(); fs.rmSync(dir, {recursive: true, force: true}); },
    /** The page's API, with its key. */
    page(method, p, body) { return send(ports.page, method, p, body === undefined ? undefined : JSON.stringify(body), {'X-Setup': ports.key, 'Content-Type': 'application/json'}); },
    tv(method, p, body) { return send(ports.tv, method, p, body, {'Content-Type': 'text/plain'}); }
  };
}

function send(port, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request({host: '127.0.0.1', port, method, path: p, headers: Object.assign({}, headers,
      body === undefined ? {} : {'Content-Length': Buffer.byteLength(body)})}, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({status: res.statusCode, text, json: text ? JSON.parse(text) : {}}));
    });
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

/** Passes the app's requests to the setup page to the real one until none is left; gives what went across. */
async function bridge(app, server) {
  const went = [];
  for (let i = 0; i < 10; i++) {
    const x = app.pending().filter((r) => r.url.indexOf(SETUP) === 0)[0];
    if (!x) break;
    const got = await send(server.ports.tv, x.method, x.url.slice(SETUP.length), x.body === null ? undefined : x.body,
      x.body === null ? {} : x.requestHeaders);
    went.push({method: x.method, path: x.url.slice(SETUP.length), body: x.body, status: got.status, answer: got.text});
    note('TV  -> ' + x.method + ' ' + x.url.slice(SETUP.length) + (x.body ? ' ' + x.body.slice(0, 120) + (x.body.length > 120 ? '…' : '') : ''));
    note('Mac <- ' + got.status + ' ' + got.text);
    x.respond(got.status, got.text);
  }
  return went;
}

test('round trip: the TV\'s own upload code to the real setup.py, accepted on the page, in the file', async (t) => {
  const server = await live({setup_key: KEY, home_assistant_url: 'http://ha.local:8123', home_assistant_token: 'DUMMY-OLD-ab12', city: 'Oslo'});
  t.after(() => server.stop());
  note('# AUG-1786 round trip: web/home.js uploadConfig() + web/seal.js in the harness, tools/setup.py on 127.0.0.1');
  const app = loadApp({config: {setupUrl: SETUP, setupKey: KEY, homeAssistant: true,
    homeAssistantUrl: 'http://ha.local:8123', homeAssistantToken: 'DUMMY-OLD-ab12'}});
  app.eval('Settings.set("city", "Bergen"); Settings.set("homeAssistantUrl", "http://10.9.9.9:8123")');
  pressUpload(app);
  const went = await bridge(app, server);
  assert.deepEqual(went.map((w) => w.method + ' ' + w.status), ['GET 200', 'POST 200']);
  assert.equal(toast(app), SENT);
  note('TV shows: ' + toast(app));

  const shown = (await server.page('GET', '/api/from-tv')).json;
  note('Page GET /api/from-tv -> ' + JSON.stringify(shown));
  const rows = {};
  for (const c of shown.changes) rows[c.key] = c;
  assert.equal(rows.city.tv, 'Bergen');
  assert.equal(rows.home_assistant_url.tv, 'http://10.9.9.9:8123');
  assert.deepEqual([rows.home_assistant_token.file, rows.home_assistant_token.tv, rows.home_assistant_token.token],
    ['••••ab12', REMOVED, 'removed']);
  assert.ok(JSON.stringify(shown).indexOf('DUMMY-OLD') < 0, 'the page gets only the last four');

  // Replaying the very same body: the nonce is used.
  const post = went[1].body;
  const replay = await server.tv('POST', '/api/from-tv', post);
  note('Replay of the same body -> ' + replay.status + ' ' + replay.text);
  assert.equal(replay.status, 410);

  const accepted = await server.page('POST', '/api/from-tv/accept', {upload: shown.upload, id: shown.id});
  note('Page POST /api/from-tv/accept -> ' + accepted.status + ' ' + accepted.text);
  assert.equal(accepted.status, 200);
  const file = server.file();
  note('config.properties now:\n' + file.replace(/^setup_key=.*$/m, 'setup_key=(the fake key)').trim());
  assert.match(file, /^city=Bergen$/m);
  assert.match(file, /^home_assistant_url=http:\/\/10\.9\.9\.9:8123$/m);
  assert.match(file, /^home_assistant_token=$/m, 'the old token did not stay for the new address');
});

test('round trip: changed ciphertext, changed MAC, a wrong key and a stale nonce are refused, and nothing is pending', async (t) => {
  const server = await live({setup_key: KEY, city: 'Oslo'}, 0.3);
  t.after(() => server.stop());
  note('');
  note('# AUG-1786 rejections, against the same real setup.py (nonce lifetime 0.3 s here)');
  async function sealed(key) {
    const app = loadApp({config: {setupUrl: SETUP, setupKey: key}});
    app.eval('Settings.set("city", "Bergen")');
    pressUpload(app);
    const x = app.request('/api/from-tv/nonce');
    const got = await send(server.ports.tv, 'GET', '/api/from-tv/nonce', undefined, {});
    x.respond(got.status, got.text);
    return {app, post: app.request('/api/from-tv')};
  }
  function flip(hex, at) { return hex.slice(0, at) + (hex[at] === '0' ? '1' : '0') + hex.slice(at + 1); }

  for (const [name, change] of [['ciphertext', (b) => { b.c = flip(b.c, 4); }], ['MAC', (b) => { b.m = flip(b.m, 10); }],
    ['TV value', (b) => { b.t = b.t + 'x'; }]]) {
    const {post} = await sealed(KEY);
    const body = JSON.parse(post.body);
    change(body);
    const got = await server.tv('POST', '/api/from-tv', JSON.stringify(body));
    note('Changed ' + name + ' -> ' + got.status + ' ' + got.text);
    assert.equal(got.status, 403, name);
  }

  const wrong = await sealed('FAKE-OLD-INSTALL-1786');
  const got = await send(server.ports.tv, 'POST', '/api/from-tv', wrong.post.body, {'Content-Type': 'text/plain'});
  wrong.post.respond(got.status, got.text);
  note('Wrong key (an app from an earlier install) -> ' + got.status + ' ' + got.text + '; the TV shows: ' + toast(wrong.app));
  assert.equal(toast(wrong.app), REFUSED);

  const stale = await sealed(KEY);
  await new Promise((r) => setTimeout(r, 600));
  const late = await send(server.ports.tv, 'POST', '/api/from-tv', stale.post.body, {'Content-Type': 'text/plain'});
  stale.post.respond(late.status, late.text);
  note('Stale nonce (posted after 0.6 s) -> ' + late.status + ' ' + late.text + '; the TV shows: ' + toast(stale.app));
  assert.equal(late.status, 410);
  assert.equal(toast(stale.app), UNREACHABLE);

  assert.deepEqual((await server.page('GET', '/api/from-tv')).json, {}, 'nothing reached the page');
  assert.doesNotMatch(server.file(), /Bergen/);
});

// MARK: - The setup page (tools/setup.html, with a fake setup.py)

const PAGE_KEY = 'FAKE-KEY-1786';
const HTML = fs.readFileSync(path.join(ROOT, 'tools', 'setup.html'), 'utf8');
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(HTML)[1];

function fakeSetup() {
  const srv = {
    requests: [], list: null, accepts: [],
    answer(url, method, body) {
      srv.requests.push({url, method, body});
      if (url === '/api/config' && method === 'GET') {
        return [200, {path: '/fake/config.properties', exists: true, problems: [], sections: [{title: 'Installing', note: '',
          keys: [{key: 'tv_ip', kind: 'text', help: '', example: '', value: '192.0.2.10'},
            {key: 'setup_key', kind: 'fixed', text: 'New at every install', help: '', example: '', value: ''}]}]}];
      }
      if (url === '/api/config') return [200, {ok: true}];
      if (url === '/api/status') return [200, {running: null, ok: null}];
      if (url === '/api/from-tv') return [200, srv.list || {}];
      if (url === '/api/from-tv/accept') {
        srv.accepts.push(body);
        if (body.upload !== srv.list.upload) return [409, {error: AGAIN}];
        return [200, {ok: true}];
      }
      if (url === '/api/from-tv/discard') return [200, {ok: true}];
      return [404, {}];
    }
  };
  return srv;
}

async function openPage(srv) {
  const doc = documentFrom(HTML);
  const timers = [];
  const win = {
    document: doc, console, TextDecoder, URL,
    location: {hash: '#key=' + PAGE_KEY, pathname: '/', search: ''},
    history: {replaceState() { win.location.hash = ''; }},
    sessionStorage: {getItem: () => null, setItem() {}},
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    clearInterval() {}, setTimeout: () => 0, addEventListener() {}, confirm: () => true, open() {},
    async fetch(url, o) {
      const [status, body] = srv.answer(url, o.method || 'GET', o.body ? JSON.parse(o.body) : null);
      return {ok: status < 400, status, json: async () => body};
    }
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SCRIPT, win);
  await settle();
  return {
    doc,
    status: () => doc.getElementById('status').textContent,
    rows: () => doc.getElementById('fromtv').querySelectorAll('tbody tr').map((tr) => ({
      cls: tr.className, cells: tr.querySelectorAll('td').map((td) => ({text: td.textContent.replace(/Show$/, ''), cls: td.className}))})),
    async tick() { for (const fn of timers) if (fn) fn(); await settle(); },
    async click(id) { await doc.getElementById(id).onclick(); await settle(); }
  };
}

async function settle() { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); }

const LIST_A = {at: 1, upload: 'u-a', id: 'id-a', changes: [
  {key: 'home_assistant_url', file: 'http://ha.local:8123', tv: 'http://10.9.9.9:8123', secret: false},
  {key: 'home_assistant_token', file: '••••ab12', tv: REMOVED, secret: true, token: 'removed'},
  {key: 'art_key', file: '••••cd34', tv: '••••ef56', secret: true, token: 'kept'}]};

test('page: a token a new address leaves behind is a warning row with its last four; one the TV sent shows its own', async () => {
  const srv = fakeSetup();
  srv.list = LIST_A;
  const page = await openPage(srv);
  await page.tick();
  const rows = page.rows();
  assert.deepEqual(rows[1].cells.map((c) => c.text), ['home_assistant_token', '••••ab12', REMOVED]);
  assert.equal(rows[1].cls, 'warn');
  assert.equal(rows[1].cells[2].cls, 'warn');
  assert.deepEqual(rows[2].cells.map((c) => c.text), ['art_key', '••••cd34', '••••ef56']);
  assert.equal(rows[2].cls, '');
});

test('page: Accept names the list it showed; when the TV sent again meanwhile, nothing is accepted and the new list is shown', async () => {
  const srv = fakeSetup();
  srv.list = LIST_A;
  const page = await openPage(srv);
  await page.tick();
  srv.list = {at: 2, upload: 'u-b', id: 'id-b', changes: [{key: 'city', file: 'Oslo', tv: 'Bergen', secret: false}]};
  await page.click('accept');   // before the next poll: the page still shows A
  assert.deepEqual(srv.accepts[0], {upload: 'u-a', id: 'id-a'});
  assert.equal(page.status(), AGAIN);
  assert.deepEqual(page.rows().map((r) => r.cells[0].text), ['city'], 'the new list is shown');
  await page.click('accept');
  assert.deepEqual(srv.accepts[1], {upload: 'u-b', id: 'id-b'});
  assert.equal(page.status(), 'Saved what the TV sent into the file.');
});

test('page: setup_key is read-only, says it is new at every install, and is never saved from the page', async () => {
  const srv = fakeSetup();
  const page = await openPage(srv);
  const label = page.doc.querySelectorAll('label').filter((l) => l.textContent === 'setup_key')[0];
  const control = label.parentNode.querySelector('.control');
  assert.equal(control.textContent, 'New at every install');
  assert.equal(control.querySelector('input'), null);
  await page.click('save');
  const saved = srv.requests.filter((r) => r.url === '/api/config' && r.method === 'POST');
  assert.ok(saved.every((r) => !('setup_key' in r.body.values)));
});
