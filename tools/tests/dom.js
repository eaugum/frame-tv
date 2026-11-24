'use strict';
// A small fake DOM for the harness: enough of what web/ touches (elements built with createElement, innerHTML only
// to clear, querySelector with simple selectors, events, canvas and img that never load). Plain objects, so a script
// may set any property on a node, as in a browser.

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

class Node {
  constructor(doc) {
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
    this._listeners = {};
  }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get nextSibling() { return sibling(this, 1); }
  get previousSibling() { return sibling(this, -1); }
  get nextElementSibling() { let n = this.nextSibling; while (n && n.nodeType !== 1) n = n.nextSibling; return n; }
  get previousElementSibling() { let n = this.previousSibling; while (n && n.nodeType !== 1) n = n.previousSibling; return n; }

  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, ref) {
    if (!(child instanceof Node)) throw new TypeError('fake DOM: appendChild/insertBefore needs a node');
    if (child === this || child.contains(this)) throw new Error('fake DOM: HierarchyRequestError');
    if (child.parentNode) child.parentNode.removeChild(child);
    const i = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    if (i < 0) throw new Error('fake DOM: NotFoundError (the reference node is not a child)');
    this.childNodes.splice(i, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i < 0) throw new Error('fake DOM: NotFoundError (not a child)');
    this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  replaceChild(child, old) {
    this.insertBefore(child, old);
    return this.removeChild(old);
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(other) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  addEventListener(type, fn) {
    if (typeof fn !== 'function') return;
    const list = this._listeners[type] || (this._listeners[type] = []);
    if (list.indexOf(fn) < 0) list.push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners[type];
    if (list && list.indexOf(fn) >= 0) list.splice(list.indexOf(fn), 1);
  }
  /** Bubbles to the document and the window; a listener's exception goes to the caller (the test). */
  dispatchEvent(event) { return dispatch(this, event); }

  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this.childNodes.forEach((c) => { c.parentNode = null; });
    this.childNodes = [];
    v = v === null || v === undefined ? '' : String(v);
    if (v) this.appendChild(this.ownerDocument.createTextNode(v));
  }
}

function sibling(node, step) {
  const p = node.parentNode;
  if (!p) return null;
  return p.childNodes[p.childNodes.indexOf(node) + step] || null;
}

class Text extends Node {
  constructor(doc, data) {
    super(doc);
    this.nodeType = 3;
    this.nodeName = '#text';
    this.data = String(data);
  }
  get nodeValue() { return this.data; }
  set nodeValue(v) { this.data = String(v); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  cloneNode() { return new Text(this.ownerDocument, this.data); }
}

class Element extends Node {
  constructor(doc, tag, ns) {
    super(doc);
    this.nodeType = 1;
    this.namespaceURI = ns || HTML_NS;
    this.localName = ns === SVG_NS ? tag : tag.toLowerCase();
    this.tagName = this.nodeName = ns === SVG_NS ? tag : tag.toUpperCase();
    this._attrs = {};
    this.style = makeStyle();
    this.dataset = {};
    this.scrollTop = 0;
    this.scrollLeft = 0;
    if (this.localName === 'canvas') { this.width = 300; this.height = 150; }
    if (this.localName === 'img') { this.naturalWidth = 0; this.naturalHeight = 0; this.complete = false; }
  }

  get id() { return this._attrs.id || ''; }
  set id(v) { this._attrs.id = String(v); }
  get className() { return this._attrs.class || ''; }
  set className(v) { this._attrs.class = String(v); }
  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c) => list().indexOf(c) >= 0,
      add: (...cs) => { const l = list(); cs.forEach((c) => { if (l.indexOf(c) < 0) l.push(c); }); el.className = l.join(' '); },
      remove: (...cs) => { el.className = list().filter((c) => cs.indexOf(c) < 0).join(' '); },
      toggle: (c, on) => {
        const has = list().indexOf(c) >= 0, want = on === undefined ? !has : !!on;
        if (want && !has) el.classList.add(c);
        if (!want && has) el.classList.remove(c);
        return want;
      }
    };
  }
  setAttribute(name, value) { this._attrs[String(name)] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name); }
  removeAttribute(name) { delete this._attrs[name]; }
  setAttributeNS(ns, name, value) { this.setAttribute(name, value); }

  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
  get childElementCount() { return this.children.length; }

  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  set innerHTML(html) {
    this.textContent = '';
    parseInto(this, String(html));
  }

  cloneNode(deep) {
    const c = new Element(this.ownerDocument, this.tagName, this.namespaceURI);
    c._attrs = Object.assign({}, this._attrs);
    Object.assign(c.style, this.style);
    Object.assign(c.dataset, this.dataset);
    if (deep) this.childNodes.forEach((n) => c.appendChild(n.cloneNode(true)));
    return c;
  }

  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  getElementsByClassName(c) { return queryAll(this, c.split(/\s+/).filter(Boolean).map((x) => '.' + x).join('')); }
  getElementsByTagName(t) { return queryAll(this, t); }
  matches(sel) { return parseSelector(sel).some((chain) => matchChain(this, chain)); }

  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  click() { this.dispatchEvent(makeEvent('click')); }
  scrollIntoView() {}
  getBoundingClientRect() { return {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0}; }
  get offsetTop() { return 0; }
  get offsetLeft() { return 0; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  get offsetParent() { return this.parentElement; }
  get clientWidth() { return 0; }
  get clientHeight() { return 0; }
  get scrollWidth() { return 0; }
  get scrollHeight() { return 0; }

  /** canvas: a 2d context that draws nothing and reads back transparent pixels. */
  getContext(kind) {
    if (this.localName !== 'canvas' || kind !== '2d') return null;
    const canvas = this;
    return new Proxy({canvas}, {
      get(target, name) {
        if (name in target) return target[name];
        if (name === 'getImageData' || name === 'createImageData') {
          return (...a) => {
            const w = Math.max(1, a.length >= 4 ? a[2] : a[0] || 1), h = Math.max(1, a.length >= 4 ? a[3] : a[1] || 1);
            return {width: w, height: h, data: new Uint8ClampedArray(w * h * 4)};
          };
        }
        if (name === 'measureText') return (t) => ({width: String(t).length * 10});
        if (name === 'createLinearGradient' || name === 'createRadialGradient' || name === 'createPattern') {
          return () => ({addColorStop() {}});
        }
        return () => {};
      },
      set(target, name, value) { target[name] = value; return true; }
    });
  }
  toDataURL() { return 'data:,'; }
}

function makeStyle() {
  const style = {};
  Object.defineProperty(style, 'setProperty', {value(n, v) { style[n] = String(v); }});
  Object.defineProperty(style, 'removeProperty', {value(n) { const v = style[n]; delete style[n]; return v || ''; }});
  Object.defineProperty(style, 'getPropertyValue', {value(n) { return style[n] || ''; }});
  return style;
}

// MARK: - Events

function makeEvent(type, init) {
  const e = Object.assign({
    type, bubbles: true, cancelable: true, defaultPrevented: false, target: null, currentTarget: null,
    keyCode: 0, which: 0, timeStamp: 0
  }, init || {});
  let stopped = false;
  e.preventDefault = () => { e.defaultPrevented = true; };
  e.stopPropagation = () => { stopped = true; };
  e.stopImmediatePropagation = () => { stopped = true; };
  Object.defineProperty(e, '_stopped', {get: () => stopped});
  if (e.keyCode && !e.which) e.which = e.keyCode;
  return e;
}

function dispatch(target, event) {
  if (!('_stopped' in event)) event = makeEvent(event.type, event);
  event.target = target;
  const path = [];
  for (let n = target; n; n = n.parentNode) path.push(n);
  const doc = target.ownerDocument || target;
  if (doc._window && path.indexOf(doc._window) < 0 && (event.bubbles || target === doc._window)) path.push(doc._window);
  for (let i = 0; i < path.length; i++) {
    if (i > 0 && !event.bubbles) break;
    const n = path[i];
    const listeners = (n._listeners && n._listeners[event.type] || []).slice();
    const handler = n['on' + event.type];
    if (typeof handler === 'function') listeners.push(handler);
    event.currentTarget = n;
    for (const fn of listeners) fn.call(n, event);
    if (event._stopped) break;
  }
  return !event.defaultPrevented;
}

// MARK: - Selectors: tag, #id, .class, [attr] and [attr="v"], joined by spaces (descendant) or ">" (child), and lists
// with ","

function parseSelector(sel) {
  return String(sel).split(',').map((part) => {
    const tokens = part.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
    const chain = [];
    let combinator = ' ';
    for (const t of tokens) {
      if (t === '>') { combinator = '>'; continue; }
      const c = {combinator, tag: null, id: null, classes: [], attrs: []};
      const re = /([#.]?)([\w-]+)|\[([\w-]+)(?:="?([^"\]]*)"?)?\]|(\*)/g;
      let m, used = 0;
      while ((m = re.exec(t))) {
        if (m.index !== used) throw new Error('fake DOM: selector not supported: ' + sel);
        used = re.lastIndex;
        if (m[5]) continue;
        if (m[3]) c.attrs.push([m[3], m[4]]);
        else if (m[1] === '#') c.id = m[2];
        else if (m[1] === '.') c.classes.push(m[2]);
        else c.tag = m[2].toLowerCase();
      }
      if (used !== t.length) throw new Error('fake DOM: selector not supported: ' + sel);
      chain.push(c);
      combinator = ' ';
    }
    return chain;
  });
}

function matchOne(el, c) {
  if (el.nodeType !== 1) return false;
  if (c.tag && el.localName.toLowerCase() !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  const classes = el.className.split(/\s+/);
  for (const k of c.classes) if (classes.indexOf(k) < 0) return false;
  for (const [name, value] of c.attrs) {
    if (!el.hasAttribute(name) || (value !== undefined && el.getAttribute(name) !== value)) return false;
  }
  return true;
}

function matchChain(el, chain, i = chain.length - 1) {
  if (!matchOne(el, chain[i])) return false;
  if (i === 0) return true;
  if (chain[i].combinator === '>') return !!el.parentElement && matchChain(el.parentElement, chain, i - 1);
  for (let p = el.parentElement; p; p = p.parentElement) if (matchChain(p, chain, i - 1)) return true;
  return false;
}

function queryAll(root, sel) {
  const chains = parseSelector(sel), out = [];
  (function walk(n) {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      if (chains.some((chain) => matchChain(c, chain))) out.push(c);
      walk(c);
    }
  })(root);
  return out;
}

// MARK: - A small HTML reader, for index.html's body (and innerHTML with markup, if web/ ever does that)

const VOID = {br: 1, img: 1, input: 1, meta: 1, link: 1, hr: 1, source: 1};

function parseInto(parent, html) {
  const doc = parent.ownerDocument;
  const re = /<!--[\s\S]*?-->|<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m, cur = parent;
  while ((m = re.exec(html))) {
    if (m[1]) {
      for (let n = cur; n && n !== parent; n = n.parentNode) {
        if (n.localName === m[1].toLowerCase()) { cur = n.parentNode; break; }
      }
    } else if (m[2]) {
      const svg = m[2].toLowerCase() === 'svg' || cur.namespaceURI === SVG_NS;
      const el = svg ? doc.createElementNS(SVG_NS, m[2]) : doc.createElement(m[2]);
      const attrRe = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = attrRe.exec(m[3] || ''))) el.setAttribute(a[1], unescape(a[2] ?? a[3] ?? a[4] ?? ''));
      cur.appendChild(el);
      if (!m[4] && !VOID[el.localName]) cur = el;
    } else if (m[5]) {
      cur.appendChild(doc.createTextNode(unescape(m[5])));
    }
  }
}

function unescape(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function serialize(n) {
  if (n.nodeType === 3) return n.data.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const attrs = Object.keys(n._attrs).map((k) => ' ' + k + '="' + n._attrs[k].replace(/"/g, '&quot;') + '"').join('');
  if (VOID[n.localName]) return '<' + n.localName + attrs + '>';
  return '<' + n.localName + attrs + '>' + n.childNodes.map(serialize).join('') + '</' + n.localName + '>';
}

// MARK: - The document

class Document extends Node {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.nodeType = 9;
    this.nodeName = '#document';
    this.hidden = false;
    this._window = null;
    this.documentElement = this.createElement('html');
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
  }
  get visibilityState() { return this.hidden ? 'hidden' : 'visible'; }
  createElement(tag) { return new Element(this, String(tag)); }
  createElementNS(ns, tag) { return new Element(this, String(tag), ns); }
  createTextNode(data) { return new Text(this, data); }
  createDocumentFragment() { return new Element(this, '#fragment'); }
  getElementById(id) { return queryAll(this, '#' + id)[0] || null; }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  getElementsByClassName(c) { return this.documentElement.getElementsByClassName(c); }
  getElementsByTagName(t) { return queryAll(this, t); }
  hasFocus() { return true; }
}

/** A document with index.html's body (its markup, without the scripts). */
function documentFrom(indexHtml) {
  const doc = new Document();
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(indexHtml);
  if (!body) throw new Error('fake DOM: no <body> in index.html');
  parseInto(doc.body, body[1].replace(/<script\b[\s\S]*?<\/script>/gi, ''));
  return doc;
}

module.exports = {Document, Element, Text, Node, documentFrom, makeEvent, dispatch, SVG_NS};
