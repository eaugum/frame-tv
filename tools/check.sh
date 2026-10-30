#!/usr/bin/env bash
# What CI runs (.github/workflows/check.yml). Run it before you push: the catalogues, the Samsung package and ES5 in
# web/ (needs Python 3 and Node).
set -euo pipefail
cd "$(dirname "$0")/.."

python3 tools/translate.py --check

# The check builds without config.properties; keep your own package (your city, your Stasera) and put it back after.
kept="$(mktemp -d)"
if [ -f FrameTV.wgt ]; then cp FrameTV.wgt "$kept/"; fi
trap 'if [ -f "$kept/FrameTV.wgt" ]; then mv "$kept/FrameTV.wgt" FrameTV.wgt; else rm -f FrameTV.wgt; fi; rm -rf "$kept"' EXIT
python3 tizen/build.py --generic

# Tizen 3 runs a Chromium from 2017: web/ has to be ES5, in syntax...
for f in web/*.js; do npx --yes acorn@8.14.0 --ecma5 --silent "$f"; done
# ...and in what it calls. These parse fine but don't exist there (wrap a feature check in try, as strings.js does).
if grep -nE '\.(includes|startsWith|endsWith|padStart|padEnd|repeat|find|findIndex|closest)\(|Object\.(assign|entries|values)\(|Array\.from\(|\bPromise\b|\bfetch\(|new (Map|Set|WeakMap)\b' web/*.js; then
  echo "web/ calls something older TVs don't have (above)." >&2
  exit 1
fi

echo "All checks passed."
