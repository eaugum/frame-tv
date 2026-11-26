/*
 * "Upload config" sealed with setup_key (AUG-1786): SHA-256 and HMAC-SHA256 in ES5, since the TV's Chromium may lack
 * WebCrypto. The wire format is described in tools/seal.py, which opens what this seals; tools/tests/seal_vectors.json
 * holds the vectors both pass. Bytes are arrays of numbers 0-255.
 */
var Seal = (function () {
  'use strict';
  var VERSION = 1, LABEL = 'frame-tv upload v1', PURPOSE = 'POST /api/from-tv';
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  /** A string's UTF-8 bytes; a lone surrogate becomes U+FFFD, so Python can always decode it. */
  function utf8(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
        c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
      } else if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63);
      else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
      else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    }
    return out;
  }

  function hex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  function unhex(s) {
    var out = [];
    for (var i = 0; i < s.length; i += 2) out.push(parseInt(s.substr(i, 2), 16));
    return out;
  }

  function sha256(msg) {
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bits = msg.length * 8, m = msg.slice(0), w = new Array(64), i, j;
    m.push(0x80);
    while (m.length % 64 !== 56) m.push(0);
    var high = Math.floor(bits / 0x100000000);
    m.push(high >>> 24 & 255, high >>> 16 & 255, high >>> 8 & 255, high & 255,
      bits >>> 24 & 255, bits >>> 16 & 255, bits >>> 8 & 255, bits & 255);
    for (var off = 0; off < m.length; off += 64) {
      for (i = 0; i < 16; i++) {
        j = off + i * 4;
        w[i] = (m[j] << 24 | m[j + 1] << 16 | m[j + 2] << 8 | m[j + 3]) | 0;
      }
      for (i = 16; i < 64; i++) {
        var a15 = w[i - 15], a2 = w[i - 2];
        var s0 = (a15 >>> 7 | a15 << 25) ^ (a15 >>> 18 | a15 << 14) ^ a15 >>> 3;
        var s1 = (a2 >>> 17 | a2 << 15) ^ (a2 >>> 19 | a2 << 13) ^ a2 >>> 10;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
      for (i = 0; i < 64; i++) {
        var t1 = (k + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + (e & f ^ ~e & g) + K[i] + w[i]) | 0;
        var t2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (a & b ^ a & c ^ b & c)) | 0;
        k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + k) | 0;
    }
    var out = [];
    for (i = 0; i < 8; i++) out.push(h[i] >>> 24 & 255, h[i] >>> 16 & 255, h[i] >>> 8 & 255, h[i] & 255);
    return out;
  }

  function hmac(key, msg) {
    if (key.length > 64) key = sha256(key);
    var inner = [], outer = [];
    for (var i = 0; i < 64; i++) {
      var b = key[i] || 0;
      inner.push(b ^ 0x36);
      outer.push(b ^ 0x5c);
    }
    return sha256(outer.concat(sha256(inner.concat(msg))));
  }

  /** {enc, mac}: the two keys derived from setup_key. */
  function keys(setupKey) {
    var key = utf8(setupKey);
    return {enc: hmac(key, utf8(LABEL + ' enc')), mac: hmac(key, utf8(LABEL + ' mac'))};
  }

  function keystream(enc, nonce, tv, size) {
    var out = [];
    for (var i = 0; out.length < size; i++) {
      var block = hmac(enc, utf8(LABEL + ' stream tv->mac\n' + nonce + '\n' + tv + '\n' + i));
      for (var j = 0; j < block.length; j++) out.push(block[j]);
    }
    return out.slice(0, size);
  }

  /** The body to POST for text (a string) with the Mac's one-time nonce and the TV's own tv value. */
  function seal(setupKey, nonce, tv, text) {
    var k = keys(setupKey), plain = utf8(text), stream = keystream(k.enc, nonce, tv, plain.length), c = [];
    for (var i = 0; i < plain.length; i++) c.push(plain[i] ^ stream[i]);
    var cipher = hex(c);
    var mac = hex(hmac(k.mac, utf8(LABEL + '\n' + PURPOSE + '\n' + nonce + '\n' + tv + '\n' + cipher)));
    return {v: VERSION, n: nonce, t: tv, c: cipher, m: mac};
  }

  /** A value of the TV's own that doesn't repeat (the time, a count, and randomness when there is any): no secret. */
  function unique() {
    var n = 0, extra = '';
    try {
      n = (parseInt(localStorage.getItem('fmtv.seal.count'), 10) || 0) + 1;
      localStorage.setItem('fmtv.seal.count', String(n));
    } catch (e) {}
    try {
      var r = new Uint32Array(2);
      window.crypto.getRandomValues(r);
      extra = r[0].toString(36) + r[1].toString(36);
    } catch (e) {
      extra = Math.floor(Math.random() * 0x100000000).toString(36);
    }
    return Date.now().toString(36) + '.' + n.toString(36) + '.' + extra;
  }

  return {utf8: utf8, hex: hex, unhex: unhex, sha256: sha256, hmac: hmac, keys: keys, keystream: keystream,
    seal: seal, unique: unique};
})();
