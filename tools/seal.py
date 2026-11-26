"""The sealed "Upload config" from the TV to tools/setup.py (AUG-1786): encrypted and authenticated with setup_key,
HMAC-SHA256 only (Python's standard library here, web/seal.js on the TV, the same vectors in tools/tests/).

Wire format, version 1:

    GET  /api/from-tv/nonce  ->  {"v": 1, "nonce": N}        N: 32 hex, from the Mac, used once, for NONCE_SECONDS
    POST /api/from-tv  (text/plain)
         {"v": 1, "n": N, "t": T, "c": C, "m": M}
         T: the TV's own value, 1-64 of [0-9a-z.]: unique, not secret (no randomness needed on the TV)
         C: hex of the UTF-8 JSON {"settings": {...}} XOR the keystream
         M: hex of HMAC(mac key, "frame-tv upload v1\\nPOST /api/from-tv\\n" N "\\n" T "\\n" C)

    key         = setup_key as UTF-8, new at every install
    enc key     = HMAC(key, "frame-tv upload v1 enc")
    mac key     = HMAC(key, "frame-tv upload v1 mac")
    keystream   = block 0, block 1, ...: HMAC(enc key, "frame-tv upload v1 stream tv->mac\\n" N "\\n" T "\\n" i)

Encrypt, then MAC over the version, the endpoint, both nonces and the ciphertext. T keeps the keystream unique even
when someone between the TV and the Mac hands the TV the same N twice.
"""
import hashlib
import hmac
import json
import re

VERSION = 1
LABEL = 'frame-tv upload v1'
PURPOSE = 'POST /api/from-tv'
NONCE = re.compile(r'[0-9a-f]{32}')
TV_NONCE = re.compile(r'[0-9a-z.]{1,64}')
HEX = re.compile(r'(?:[0-9a-f]{2})*')
MAC = re.compile(r'[0-9a-f]{64}')


class Refused(Exception):
    """Not a sealed upload this key made: status is 400 (not the format) or 403 (the MAC)."""

    def __init__(self, status, why):
        super().__init__(why)
        self.status = status


def _hmac(key, text):
    return hmac.new(key, text if isinstance(text, bytes) else text.encode('utf-8'), hashlib.sha256).digest()


def keys(setup_key):
    """(enc key, mac key), derived from setup_key."""
    key = setup_key.encode('utf-8')
    return _hmac(key, LABEL + ' enc'), _hmac(key, LABEL + ' mac')


def keystream(enc, nonce, tv, size):
    out = b''
    i = 0
    while len(out) < size:
        out += _hmac(enc, '%s stream tv->mac\n%s\n%s\n%d' % (LABEL, nonce, tv, i))
        i += 1
    return out[:size]


def mac_of(mac, nonce, tv, cipher):
    return _hmac(mac, '%s\n%s\n%s\n%s\n%s' % (LABEL, PURPOSE, nonce, tv, cipher)).hex()


def seal(setup_key, nonce, tv, plain):
    """The body the TV sends for plain (bytes): what web/seal.js does, for the tests."""
    enc, mac = keys(setup_key)
    cipher = bytes(a ^ b for a, b in zip(plain, keystream(enc, nonce, tv, len(plain)))).hex()
    return {'v': VERSION, 'n': nonce, 't': tv, 'c': cipher, 'm': mac_of(mac, nonce, tv, cipher)}


def check(body):
    """The body's fields when it has the format, else Refused(400). Nothing here needs the key."""
    if not isinstance(body, dict) or body.get('v') != VERSION or isinstance(body.get('v'), bool):
        raise Refused(400, 'not a version %d upload' % VERSION)
    for name, form in (('n', NONCE), ('t', TV_NONCE), ('c', HEX), ('m', MAC)):
        if not isinstance(body.get(name), str) or not form.fullmatch(body[name]):
            raise Refused(400, 'bad %s' % name)
    return body['n'], body['t'], body['c'], body['m']


def open_sealed(setup_key, body):
    """The plain bytes of a sealed body, or Refused: 400 for the format, 403 when the MAC is wrong (another key, or
    changed on the way). The MAC is compared in constant time, before anything is decrypted."""
    nonce, tv, cipher, sent = check(body)
    enc, mac = keys(setup_key)
    if not hmac.compare_digest(mac_of(mac, nonce, tv, cipher).encode(), sent.encode()):
        raise Refused(403, 'wrong MAC')
    data = bytes.fromhex(cipher)
    return bytes(a ^ b for a, b in zip(data, keystream(enc, nonce, tv, len(data))))


def settings_of(plain):
    """The {"settings": {...}} inside, or Refused(400)."""
    try:
        got = json.loads(plain.decode('utf-8'))
    except (ValueError, RecursionError):   # RecursionError: nested too deep
        raise Refused(400, 'not JSON')
    if not isinstance(got, dict) or not isinstance(got.get('settings'), dict):
        raise Refused(400, 'no settings')
    return got['settings']
