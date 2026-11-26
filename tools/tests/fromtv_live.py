"""For aug1786.test.js: the real setup.py servers on 127.0.0.1, for the TV's own upload code to talk to.

    python3 -B -I tools/tests/fromtv_live.py CONFIG [NONCE_SECONDS]

Prints one line of JSON, {"page": port, "tv": port, "key": the page's key}, then serves until stdin closes. Not a
test itself (unittest only picks up test_*.py).
"""
import json
import os
import sys
import threading

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import setup  # noqa: E402

if len(sys.argv) > 2:
    setup.NONCE_SECONDS = float(sys.argv[2])
setup.FROM_TV_PORT = 0
page = setup.Server(0, os.path.abspath(sys.argv[1]))
tv = setup.FromTVServer('127.0.0.1', page)
for s in (page, tv):
    threading.Thread(target=s.serve_forever, daemon=True).start()
print(json.dumps({'page': page.server_address[1], 'tv': tv.server_address[1], 'key': page.key}), flush=True)
sys.stdin.read()
