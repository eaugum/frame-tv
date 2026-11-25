# Development

How Frame TV is built.

It's developed on The Frame (2022, Tizen 6.5). Art Mode and the remote control API only answer from the TV's own network.
Installing over SDB also works from another network that can reach it.

## Build and install

What you need: Python 3, and Samsung's `tizen` tool in `tizen-studio/` (`tizen/get-tools.sh` fetches it, runs without
Rosetta). The certificate and its profile are in `tizen-studio-data/`. Both folders are gitignored. To start
from nothing, follow [install.md](install.md).

```bash
python3 tizen/build.py --sign frametv    # → FrameTV.wgt
python3 tizen/install.py <the TV's IP>    # installs over Wi-Fi and opens the app
```

`python3 tools/setup.py` does the same from its page, with `sign_profile` and `tv_ip`. `--config other.properties` builds
with another file.

The first time, `python3 tizen/build.py` makes `config.properties` (gitignored) from `config.example.properties`.

### The service beside Frame TV

A web app can't read the TV's own settings, so `tizen/service/` is a small .NET service, `FrameTVService.tpk`
(`org.frametv.service`), that can: ECO, power (when and why the TV last went off, panel time), HDMI-CEC and Art
Mode's learned brightness. These keys need only the privilege every app has, so no root. Frame TV launches it when it
starts and every hour (`web/art.js`), gets the values back as the launch's reply, and sends them to Frame Art with the
rest of its report (`POST /tv/report`, `settings`) for the TV tab.

`build.py --sign` builds and signs it with the same profile when .NET 6 is in `dotnet/` (`tizen/get-tools.sh` fetches
it); `install.py` installs it first, and `--uninstall` removes it too. Without it, Frame TV works as before.

### The certificate

Keep `tizen-studio-data/keystore/author/frametv.p12` and its password safe (in a password manager). Updates must be
signed with the same certificate. After the folder has moved, run `tizen/add-profile.sh` once (it asks for the
password). A new certificate: `tizen/make-certificate.sh`, which makes the profile `frametv` unless you name another.

Samsung's own CLI installer stops on a Mac without Rosetta, since it brings an Intel Java, and still exits with 0.
`tizen/get-tools.sh` therefore takes the four packages from the same server and uses Homebrew's Java 17.

### Preview on the Mac

`python3 tizen/build.py --preview` and open `out/tizen/index.html` in the browser (arrow keys, Enter and Esc). The
browser shows every module switched on with `true`, with sample data where something is missing (GitHub without
`github_token` and `vercel_token`, Home Assistant, Spotify, YouTube before signing in, Art Mode). YouTube can be signed in
from the browser too (with `--preview-tokens`, for the client secret). The Stasera tab needs the browser to be linked to
Stasera.

The preview leaves out every token, key and secret, so it shows the sample data. `--preview-tokens` puts your real ones
in. Open that one as a file and don't serve `out/tizen`: then any page in the browser, or anyone on the network, could
load `config.js`. A link or sign-in made in the preview stays in the browser's storage, which Chrome shares with every
local HTML file. The tools write `config.properties` (at each save), `FrameTV.wgt` and `out/tizen` so that only your
account can read them.

### Before you push

`tools/check.sh` (the translations, the package and ES5 in `web/`).

## How it's built

| Folder | What |
|---|---|
| `web/` | The home screen: plain ES5 JavaScript and CSS, drawn on a 1920 × 1080 stage |
| `web/home.js` | The tab bar, Home, the TV, YouTube, Stats, GitHub and HA tabs, the app library, the settings and the screensaver |
| `web/tv.js` | The TV's side: the apps, settings, the Back button |
| `web/stasera.js` | Stasera: linking with a QR code, `/tv/home` (watching, want to start, movies, friends, stats and the greeting), `/tv/search`, `/tv/title`, `/tv/want`, `/tv/watched` and `/tv/unwatched` for the title page, and `/tv/person` for the person page |
| `web/github.js` | GitHub and Vercel: commits per day, the latest commit per project and the deploys every half hour, the languages once a day |
| `web/ha.js` | Home Assistant over the WebSocket API: `subscribe_entities`, `call_service`, `frametv_notify` in and `frametv_state` out |
| `web/spotify.js` | Spotify: what's playing and the controls, from the Web API |
| `web/art.js` | The buttons to the Frame Art add-on, and Frame TV's events for its log |
| `web/youtube.js` | YouTube: the sign-in (device flow), the playlist and the subscriptions from the YouTube Data API, with the quota in mind |
| `web/data.js` | The weather (Open-Meteo), the streaming services' apps, the modules and the settings |
| `i18n/` | The text in English and Norwegian |
| `tizen/` | Building, signing and installing over SDB (without Samsung's `sdb`) |
| `homeassistant/` | The HA package: `sensor.frame_tv`, and automations that notify on the TV and dim the lights when a movie starts |
| `tools/` | Translations, the check, the setup page and helper scripts |

The Stasera API lives in the Stasera repo (`convex/tv.ts`, `convex/tvHttp.ts`).

## Good to know

Convex Auth reads `?code=` in a URL as a sign-in code, so the linking link uses `?pair=`.
