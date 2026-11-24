'use strict';
/*
 * Loads web/ the way index.html does, in one vm context, for tests on the Mac (Node's built-ins only):
 *
 *   const {loadApp} = require('./harness');
 *   const app = loadApp({
 *     config: {art: true, artUrl: 'http://art.test'},            // over the generic build's config.js
 *     storage: {'fmtv.prefs': {theme: 'dark'}},                   // localStorage before the scripts run
 *     xhr: [{url: /open-meteo/, status: 200, body: {...}},        // answered after `delay` ms (default 0)
 *           {url: /stasera/, throwOn: 'send'}],                   // or 'open' / 'setRequestHeader'; error: 'network'
 *     now: Date.UTC(2026, 10, 24, 11), hidden: false, language: 'en-US', tizen: undefined,
 *     after: {'data.js': "Data.refresh = function () {}"}        // code run in the page right after a script
 *   });
 *   app.advance(0);                       // runs due timers, so scripted answers arrive
 *   app.request(/open-meteo/).respond(200, {...});   // or answer a pending request by hand (.fail(), .expire())
 *   app.xhr({url: /open-meteo/, status: 500});           // a new answer from now on, before the earlier rules
 *   app.storage.getItem('fmtv.weather');  // what web/ saved
 *   app.eval('Data.weather.temp');        // anything in the page's scope
 *   app.key('left');                      // a remote key (TV.keys) on the document
 *
 * A script that throws while loading makes loadApp throw "web/<file> threw while loading: ...", with the half-loaded
 * app as the error's .app (its storage, requests and eval work as above). An exception in a timer, an XHR handler or
 * an event listener reaches the test from advance(), respond() or dispatch(). No real timers or network: nothing runs
 * unless the test advances the clock or answers a request.
 *
 * xhr rules: the first that matches a request's method and url decides; rules added later with app.xhr(rule) go
 * first, so a test can change an answer between refreshes. A request with x.timeout above 0 and no answer expires
 * when advance() passes its timeout (readyState 4, status 0, then ontimeout), as in a browser; one without stays
 * pending until the test answers it.
 *
 * config.js and i18n.js are not read from disk: the config is tools/webapp.py's --generic one (never
 * config.properties) and the catalogues come from i18n/, both through python3. Objects from the page are of its own
 * realm: compare them with app.json(expr) or JSON, not deepStrictEqual on the objects themselves.
 *
 * Run: node --test tools/tests/*.test.js (tools/check.sh does).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const dom = require('./dom');

// The TV is in Oslo: dates, the time zone's city (zones.js) and Intl all follow TZ.
process.env.TZ = 'Europe/Oslo';

const ROOT = path.resolve(__dirname, '..', '..');
const WEB = path.join(ROOT, 'web');
const DEFAULT_NOW = Date.UTC(2026, 10, 24, 11, 0, 0);   // 12:00 in Oslo

/** The scripts in index.html's order. */
function scripts() {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  return Array.from(html.matchAll(/<script\s+src="([^"]+)"/g), (m) => m[1]);
}

let built = null;
/** {config, catalogues}: tools/webapp.py's generic config (no config.properties) and the catalogues of i18n/. */
function generic() {
  if (built) return built;
  const code = [
    'import json, sys',
    'sys.path.insert(0, sys.argv[1])',
    'import webapp',
    "print(json.dumps({'config': webapp.config_from_args(['--generic']), 'catalogues': webapp.catalogues()}))"
  ].join('\n');
  // -B: no __pycache__ in the repo; -I: nothing from the environment or the current folder.
  const out = execFileSync('python3', ['-B', '-I', '-c', code, path.join(ROOT, 'tools')], {encoding: 'utf8'});
  built = JSON.parse(out);
  // The generic build has no secrets; anything else means a real config got in.
  for (const [k, v] of Object.entries(built.config)) {
    if (/token|key|secret/i.test(k) && v) throw new Error('harness: the generic config has a value for ' + k);
  }
  return built;
}

// MARK: - Timers on a fake clock

const MAX_SAME_INSTANT = 10000;

function makeClock(start) {
  let now = start, seq = 0;
  const timers = new Map();
  function add(fn, ms, args, repeat) {
    if (typeof fn !== 'function') throw new Error('harness: setTimeout/setInterval with a string is not supported');
    const id = ++seq;
    const delay = Math.max(0, Number(ms) || 0);
    timers.set(id, {id, fn, args, at: now + delay, every: repeat ? Math.max(1, delay) : 0});
    return id;
  }
  const clock = {
    now: () => now,
    setTimeout: (fn, ms, ...args) => add(fn, ms, args, false),
    setInterval: (fn, ms, ...args) => add(fn, ms, args, true),
    clearTimeout: (id) => { timers.delete(id); },
    clearInterval: (id) => { timers.delete(id); },
    /**
     * Moves the clock ms forward, running each timer due on the way, in order; their exceptions reach the caller (the
     * clock then stays at that timer's time). Days are fine; a timer that keeps scheduling itself without the clock
     * moving (a zero-delay loop) stops it.
     */
    advance(ms) {
      const end = now + Math.max(0, ms || 0);
      let sameInstant = 0;
      for (;;) {
        let next = null;
        for (const t of timers.values()) if (t.at <= end && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
        if (!next) break;
        sameInstant = next.at > now ? 0 : sameInstant + 1;
        if (sameInstant > MAX_SAME_INSTANT) {
          throw new Error('harness: more than ' + MAX_SAME_INSTANT + ' timers at ' + new Date(now).toISOString() +
            ' without the clock moving (a zero-delay loop?)');
        }
        now = Math.max(now, next.at);
        if (next.every) next.at += next.every; else timers.delete(next.id);
        next.fn.apply(null, next.args);
      }
      now = end;
    },
    /** The timers waiting: [{at, every}]. */
    pending: () => Array.from(timers.values(), (t) => ({at: t.at, every: t.every}))
  };
  return clock;
}

// MARK: - localStorage

function makeStorage(initial) {
  const items = new Map();
  for (const [k, v] of Object.entries(initial || {})) items.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  return {
    getItem: (k) => (items.has(String(k)) ? items.get(String(k)) : null),
    setItem: (k, v) => { items.set(String(k), String(v)); },
    removeItem: (k) => { items.delete(String(k)); },
    clear: () => { items.clear(); },
    key: (i) => Array.from(items.keys())[i] ?? null,
    get length() { return items.size; },
    /** Everything in it, {key: string} (for tests). */
    dump: () => Object.fromEntries(items)
  };
}

// MARK: - XMLHttpRequest

function matches(rule, url, method) {
  if (rule.method && String(rule.method).toUpperCase() !== String(method).toUpperCase()) return false;
  const u = rule.url;
  if (u === undefined) return true;
  if (u instanceof RegExp) return u.test(url);
  if (typeof u === 'function') return !!u(url, method);
  return String(url).indexOf(u) >= 0;
}

function makeXHR(clock, rules, requests) {
  function thrown(what, xhr) {
    const e = new Error('fake XHR: ' + what + ' threw (scripted by the test) for ' + xhr.method + ' ' + xhr.url);
    e.name = 'NetworkError';
    return e;
  }
  class FakeXMLHttpRequest {
    constructor() {
      this.readyState = 0;
      this.status = 0;
      this.statusText = '';
      this.responseText = '';
      this.response = '';
      this.timeout = 0;
      this.withCredentials = false;
      this.method = null;
      this.url = null;
      this.requestHeaders = {};
      this.body = undefined;
      this.sent = false;
      this.done = false;
      this.aborted = false;
      this._responseHeaders = {};
      this._listeners = {};
      this._rule = null;
      this._timer = 0;
    }
    static get UNSENT() { return 0; }
    static get OPENED() { return 1; }
    static get DONE() { return 4; }

    open(method, url) {
      this.method = String(method).toUpperCase();
      this.url = String(url);
      this._rule = rules.find((r) => matches(r, this.url, this.method)) || null;
      if (this._rule && this._rule.throwOn === 'open') throw thrown('open', this);
      this.readyState = 1;
      this._fire('readystatechange');
    }
    setRequestHeader(name, value) {
      if (this.readyState !== 1 || this.sent) throw new Error('fake XHR: setRequestHeader before open() or after send()');
      const r = this._rule;
      if (r && r.throwOn === 'setRequestHeader' && (!r.header || r.header.toLowerCase() === String(name).toLowerCase())) {
        throw thrown('setRequestHeader(' + name + ')', this);
      }
      this.requestHeaders[String(name)] = String(value);
    }
    send(body) {
      if (this.readyState !== 1 || this.sent) throw new Error('fake XHR: send() before open() or twice');
      const r = this._rule;
      if (r && r.throwOn === 'send') throw thrown('send', this);
      this.body = body === undefined ? null : body;
      this.sent = true;
      requests.push(this);
      // As a browser: with a timeout and no answer by then, it expires.
      if (this.timeout > 0) this._timer = clock.setTimeout(() => { if (!this.done) this.expire(); }, this.timeout);
      if (!r || r.throwOn) return;
      clock.setTimeout(() => {
        if (this.done) return;
        if (r.error === 'network') this.fail();
        else if (r.error === 'timeout') this.expire();
        else {
          const answer = typeof r.respond === 'function' ? r.respond(this) : r;
          this.respond(answer.status === undefined ? 200 : answer.status, answer.body, answer.headers);
        }
      }, r.delay || 0);
    }
    abort() {
      if (this.done || !this.sent) return;
      this.aborted = true;
      this._finish(0, '', ['abort']);
    }
    getResponseHeader(name) {
      const k = Object.keys(this._responseHeaders).find((h) => h.toLowerCase() === String(name).toLowerCase());
      return k === undefined ? null : this._responseHeaders[k];
    }
    getAllResponseHeaders() {
      return Object.entries(this._responseHeaders).map(([k, v]) => k + ': ' + v + '\r\n').join('');
    }
    overrideMimeType() {}
    addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn); }
    removeEventListener(type, fn) {
      const l = this._listeners[type];
      if (l && l.indexOf(fn) >= 0) l.splice(l.indexOf(fn), 1);
    }

    /** Answers: body a string, or anything else as JSON. Runs the page's handlers now. */
    respond(status, body, headers) {
      this._assertPending();
      this._responseHeaders = Object.assign({}, headers || {});
      const text = body === undefined || body === null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
      this._finish(status, text, ['load']);
    }
    /** No connection: as a browser does, readystatechange (4, status 0), then error. */
    fail() { this._assertPending(); this._finish(0, '', ['error']); }
    /** The request's timeout ran out: readystatechange (4, status 0), then timeout. advance() does this by itself
     * once the clock passes x.timeout (when it is above 0). */
    expire() { this._assertPending(); this._finish(0, '', ['timeout']); }

    _assertPending() {
      if (!this.sent) throw new Error('fake XHR: answering a request that was never sent: ' + this.url);
      if (this.done) throw new Error('fake XHR: answering a request twice: ' + this.url);
    }
    _finish(status, text, events) {
      this.done = true;
      if (this._timer) clock.clearTimeout(this._timer);
      this.status = status;
      this.statusText = status ? String(status) : '';
      this.responseText = this.response = text;
      this.readyState = 4;
      this._fire('readystatechange');
      for (const e of events) this._fire(e);
      this._fire('loadend');
    }
    _fire(type) {
      const event = {type, target: this, currentTarget: this};
      const handler = this['on' + type];
      if (typeof handler === 'function') handler.call(this, event);
      for (const fn of (this._listeners[type] || []).slice()) fn.call(this, event);
    }
  }
  return FakeXMLHttpRequest;
}

/** A WebSocket that never connects (ha.js retries); tests can drive one through app.sockets. */
function makeWebSocket(sockets) {
  return class FakeWebSocket {
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(data) { this.sent.push(data); }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (typeof this.onclose === 'function') this.onclose({code: 1000});
    }
    addEventListener(type, fn) { this['on' + type] = fn; }
  };
}

// MARK: - Loading the page

/** The page's Date, on the fake clock: new Date() and Date.now() are the clock's time. */
const FAKE_DATE = `(function (RealDate, now) {
  function D() {
    if (!new.target) return new RealDate(now()).toString();
    var a = Array.prototype.slice.call(arguments);
    return Reflect.construct(RealDate, a.length ? a : [now()], new.target);
  }
  D.prototype = RealDate.prototype;
  Object.defineProperty(RealDate.prototype, 'constructor', {value: D, writable: true, configurable: true});
  D.now = function () { return now(); };
  D.UTC = RealDate.UTC;
  D.parse = RealDate.parse;
  return D;
})`;

function loadApp(options) {
  const o = options || {};
  const base = generic();
  const config = Object.assign({}, base.config, o.config || {});
  const clock = makeClock(o.now === undefined ? DEFAULT_NOW : o.now);
  const storage = makeStorage(o.storage);
  const rules = (o.xhr || []).slice();
  const requests = [], sockets = [], logs = [];
  const document = dom.documentFrom(fs.readFileSync(path.join(WEB, 'index.html'), 'utf8'));
  document.hidden = !!o.hidden;

  const log = (level) => (...args) => { logs.push({level, text: args.map(String).join(' ')}); };
  const location = {href: 'file:///index.html', protocol: 'file:', host: '', hostname: '', origin: 'null',
    reloads: 0, reload() { location.reloads++; }};
  const sandbox = {
    document,
    navigator: {language: o.language || 'en-US', languages: [o.language || 'en-US'],
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.0 Safari/537.36 (frame-tv tests)',
      onLine: true},
    location,
    screen: {width: 1920, height: 1080},
    innerWidth: 1920,
    innerHeight: 1080,
    devicePixelRatio: 1,
    localStorage: storage,
    sessionStorage: makeStorage(),
    XMLHttpRequest: makeXHR(clock, rules, requests),
    WebSocket: makeWebSocket(sockets),
    Image: function Image(w, h) { const i = document.createElement('img'); if (w) i.width = w; if (h) i.height = h; return i; },
    setTimeout: clock.setTimeout,
    setInterval: clock.setInterval,
    clearTimeout: clock.clearTimeout,
    clearInterval: clock.clearInterval,
    requestAnimationFrame: (fn) => clock.setTimeout(() => fn(clock.now()), 16),
    cancelAnimationFrame: clock.clearTimeout,
    getComputedStyle: (e) => e.style,
    matchMedia: () => ({matches: false, addListener() {}, removeListener() {}}),
    console: {log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug')},
    _listeners: {}
  };
  if (o.tizen !== undefined) sandbox.tizen = o.tizen;
  for (const name of ['addEventListener', 'removeEventListener', 'dispatchEvent']) {
    sandbox[name] = dom.Node.prototype[name];
  }
  const context = vm.createContext(sandbox);
  vm.runInContext('var window = globalThis, self = globalThis;', context);
  const window = vm.runInContext('globalThis', context);
  document._window = window;
  vm.runInContext('(function (make, now) { Date = make(Date, now); })', context)(vm.runInContext(FAKE_DATE, context), clock.now);

  const app = {
    window,
    document,
    storage,
    clock,
    /** Every request the page has sent, in order (FakeXMLHttpRequest: method, url, requestHeaders, body, done). */
    requests,
    sockets,
    logs,
    location,
    config,
    /** Runs code in the page's scope and gives back its value. */
    eval: (code) => vm.runInContext(code, context),
    /** An expression's value through JSON, as plain objects of this realm. */
    json: (code) => JSON.parse(vm.runInContext('JSON.stringify(' + code + ')', context) ?? 'null'),
    advance: (ms) => clock.advance(ms),
    /** Answers to requests from now on, as the xhr option; it goes before every rule so far. */
    xhr: (rule) => { rules.unshift(rule); },
    /** The last request sent to a matching url that has no answer yet. */
    request(url, method) {
      for (let i = requests.length - 1; i >= 0; i--) {
        if (!requests[i].done && matches({url, method}, requests[i].url, requests[i].method)) return requests[i];
      }
      throw new Error('harness: no pending request for ' + url + '; pending: ' +
        (requests.filter((r) => !r.done).map((r) => r.method + ' ' + r.url).join(', ') || 'none'));
    },
    pending: () => requests.filter((r) => !r.done),
    dispatch: (target, type, init) => dom.dispatch(target, dom.makeEvent(type, init)),
    /** A remote key on the document: a name in TV.keys ('left', 'ok', 'back'...) or a key code. */
    key(name, type) {
      const code = typeof name === 'number' ? name : vm.runInContext('TV.keys', context)[name];
      if (typeof code !== 'number') throw new Error('harness: no key called ' + name);
      return dom.dispatch(document, dom.makeEvent(type || 'keydown', {keyCode: code, which: code}));
    },
    /** The TV going off and on (or another app in front): document.hidden and visibilitychange. */
    setHidden(hidden) {
      document.hidden = !!hidden;
      dom.dispatch(document, dom.makeEvent('visibilitychange', {bubbles: false}));
    }
  };

  const generated = {
    'config.js': 'window.CONFIG = ' + JSON.stringify(config) + ';',
    'i18n.js': 'window.I18N_CATALOGUES = ' + JSON.stringify(base.catalogues) + ';'
  };
  const after = o.after || {};
  for (const name of Object.keys(after)) {
    if (scripts().indexOf(name) < 0) throw new Error('harness: after: no script ' + name + ' in index.html');
  }
  function run(source, name, filename) {
    try {
      vm.runInContext(source, context, {filename});
    } catch (e) {
      const error = new Error(name + ' threw while loading: ' + (e && e.stack || e));
      error.app = app;   // what loaded until then: storage, requests, the page's state
      throw error;
    }
  }
  for (const name of scripts()) {
    const file = path.join(WEB, name);
    run(generated[name] !== undefined ? generated[name] : fs.readFileSync(file, 'utf8'), 'web/' + name,
      path.relative(ROOT, file));
    if (after[name] !== undefined) run(after[name], "the test's code after web/" + name, 'after-' + name);
  }

  return app;
}

module.exports = {loadApp, scripts, generic, ROOT};
