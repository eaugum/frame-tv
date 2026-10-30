# Frame TV: notes for Claude

The home screen on The Frame in the living room (Samsung, Tizen 6.5): a web app in `web/`, packed and signed by
`tizen/build.py` and installed by `tizen/install.py`. README.md is the overview, `docs/` has the rest
(`docs/install.md`: from nothing to the TV; `docs/development.md`: the build; `docs/modules.md`: every setting); `TASKS.md` (local, gitignored) and the Linear
project **Frame TV** (team AUG) have the tasks.

**Language:** answer the owner in Norwegian, in the chat and in Linear (titles there may stay Norwegian). Code,
comments, documentation, new commits and new CHANGELOG lines are in English, here and in Frame Art. On screen the text
is in English or Norwegian.

Before you push: `tools/check.sh` (catalogues, the package without `config.properties`, ES5 in `web/`).
After a change: `python3 tizen/build.py --sign freemytv` must end with `Built FrameTV.wgt (..., signed with "freemytv")`.

## The code

- `web/`: plain ES5 JavaScript and CSS without variables, grid or backdrop-filter, since Tizen 3 runs a Chromium from
  2017; only transform and opacity are animated. `tools/check.sh` stops syntax and calls that are missing there
  (`includes`, `Promise`, `fetch`...). Keep it that way even though The Frame is newer: it costs little and keeps the
  app fast.
- `web/tv.js` is the TV's side: `tizen.application` (`getAppsInfo`, `launch`). The inputs (HDMI, live TV) were removed
  in AUG-1472. Samsung's own data is unreliable: some `iconPath`s are a placeholder, so logos are in `web/icons/` with
  the app id in `SAMSUNG_ICONS`; names that are missing or long are in `SAMSUNG_TITLES`. In an ordinary browser it gives
  a stand-in with sample apps, for the preview.
- `web/home.js` is the home screen, `web/home.css` the look, `web/data.js` weather and settings (`Prefs`, in
  localStorage, wins over `config.properties`), `web/stasera.js` Stasera.
- Settings come from `config.properties` (gitignored) through the generated `config.js`. Without it (`--generic`) the
  TV's time zone gives the city (`web/zones.js`, from `tools/make_zones.py`).
- Text on screen: `tr('Live TV')`, `trf('{n} min ago', {n: 12})`, `plural('plural|one:…|other:…', n)` and
  `formatDate('format|h:mm a', at)`, looked up in `i18n/<lang>.json` (the key is the English text). After text changes:
  `python3 tools/translate.py` rebuilds `en.json` and says what `nb.json` lacks; translate by hand. `--check` validates
  without writing.
- Comments in English, short, only where the why isn't obvious.

## The TV

- Installing: `tizen/install.py` speaks SDB itself (port 26101), pushes the package and installs with
  `0 vd_appinstall`; it reports success only when the TV says `install completed`. `--uninstall` removes the app.
- An update must be signed with the same certificate (`tizen-studio-data/keystore/author/freemytv.p12`); otherwise the
  TV refuses, and then the app has to be removed first. The owner types certificate passwords in their own terminal,
  never in the chat.
- Looking inside the running app: the TV rejects `0 debug` (Web Inspector) for apps signed with the Tizen certificate.
  Use a temporary build that fetches JavaScript from the Mac and sends the answer back (AUG-1433), and never commit it.
  `0 was_execute FrameTVapp.FrameTV` over SDB brings the app back up.
- Art Mode is run by the Frame Art add-on in HA, in its own public repo `eaugum/frame-art` (`~/Utvikling/frame-art`); a
  change there is a version in `config.yaml`, a line in `CHANGELOG.md` and a push, then "Update" in HA. It and the
  remote control API only answer from the TV's own network.

## Always

- Never commit `config.properties`, certificates, tokens or keys.
- Don't change the TV's picture, sound, network or account settings.
- Say what you're going to do on the TV before you do it.
