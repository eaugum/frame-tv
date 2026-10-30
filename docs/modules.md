# Modules and settings

Every setting in `config.example.properties`, with what it does and where the value comes from. For how the parts fit
together, see [overview.md](overview.md). If something doesn't work, see [troubleshooting.md](troubleshooting.md).

## How settings work

- **Where to set them:** `python3 tools/setup.py` opens a page on the Mac with every setting. You can also edit
  `config.properties` by hand, or use the gear on the TV (Connections has a page per service). After a change on the
  Mac, build and install again; "Save, build and install" on the setup page does both.
- **What applies:** whatever was changed last. A value set on the TV wins until the same setting is changed in the file,
  and then the file wins.
- **Switches:** each module has one (`stasera`, `youtube`, `github`, `vercel`, `home_assistant`, `spotify`, `art`).
  `true` turns the module on once it has what it needs. `false`, empty or missing is off. Anything else stops the build.
- **Secrets:** tokens end up in the app on the TV. Give them as little access as you can, and never commit
  `config.properties` (it's gitignored).
- **The backup:** the TV forgets its own changes when the app is uninstalled. See [Upload config](#upload-config).

On the TV, the gear → Connections says how each module stands:

| It says | It means |
|---|---|
| Not set up | The switch is off, and something the module needs is missing |
| Off | The switch is off, and everything is in place |
| On · Missing … | The switch is on, but the named setting is empty, so the module stays off |
| On · Not linked / Not signed in | Stasera or YouTube is on, and the TV hasn't been linked or signed in yet |
| On · Linked / Signed in | It's running |
| On | Everything is in place. The token itself isn't tested here; the tab shows any error |

A switch changed on the TV applies when you close the gear: the app restarts by itself. A switch changed in the file
applies after the next install.

## Stasera

**What it gives:** the greeting, "Continue Watching" and new episodes on Home; the rows Watching, Want to Start, Movies
and Friends in the TV tab; search; the title pages, where you can mark things as watched; and the Stats tab.

**What you need:** an account on [stasera.app](https://www.stasera.app).

| Setting | What | Where it comes from |
|---|---|---|
| `stasera` | The switch | `true` |
| `stasera_url` | The address of Stasera's API | Leave it: empty means `https://www.stasera.app` |
| `stasera_name` | The TV's name in Stasera's list of linked TVs | Your choice; empty means "The Frame" |
| `stasera_token` | The TV's link to Stasera | Filled in by "Upload config"; a new install then starts out linked |

**Getting it working:**

1. Set `stasera=true`, build and install.
2. On the TV, go to the gear → Connections → Stasera. Scan the QR code with your phone and approve the TV.

The linked TVs are listed under Connections on stasera.app, and a TV can be unlinked there.

**When it's missing or wrong:**

- Without the module: Home shows YouTube (when that's on) or the apps, and the TV tab has the clock and the apps.
- Not linked: Home offers "Link this TV to Stasera".
- Unlinked on stasera.app: the TV notices at its next call and goes back to not linked.
- No connection: Home keeps showing the last answer without saying so. Linking, search and the title pages say
  "Couldn't reach Stasera."
- Too many calls: the same places say "Stasera is busy. Try again in a minute."
- Stats is empty ("No stats yet") until Stats has been opened in the Stasera app.

## YouTube

**What it gives:** the YouTube tab with your playlist "Frame TV" and "New from your subscriptions" (at most two per
channel in the last two weeks, no Shorts), and a tile on Home. The TV can only read.

"Watch later" can't be read by apps, since Google closed it in 2016. Save what you want to watch on the TV in a playlist
called **Frame TV** on YouTube. Another playlist can be picked on the TV.

**What you need:** a Google account and a project in Google Cloud.

| Setting | What | Where it comes from |
|---|---|---|
| `youtube` | The switch | `true` |
| `youtube_client_id` | The OAuth client's id | Google Cloud, below |
| `youtube_client_secret` | The OAuth client's secret | Google Cloud, below |
| `youtube_refresh_token` | The TV's sign-in | Filled in by "Upload config"; a new install then starts out signed in |
| `youtube_playlist` | The playlist on Home, by id | Picked on the TV; empty means the one called Frame TV |

**Getting it working:**

1. In [Google Cloud](https://console.cloud.google.com), make a project and turn on **YouTube Data API v3**.
2. Set up **Google Auth Platform**: audience External, with the scope `youtube.readonly`.
3. **Publish** the app. While it's in "Testing", the sign-in expires after 7 days.
4. Make an OAuth client of the type **TVs and Limited Input devices**, and put its id and secret in the settings.
5. Set `youtube=true`, build and install.
6. On the TV, go to the gear → Connections → YouTube, and sign in with the code on `google.com/device`.

**When it's missing or wrong:**

- Without the client id or secret: the module stays off, and Connections says what's missing.
- Not signed in yet, or the sign-in has expired or been revoked: the tab and the tile show made-up videos, marked
  "Sample data: sign in to YouTube in Home Settings", and Connections says "Not signed in". Sign in again, and if it
  happens every 7 days, the app is still in "Testing".
- A wrong client id: "Google turned down the sign-in. Check the OAuth client in config.properties."
- A wrong client secret: the TV stays on "Waiting for Google…" after you've approved the code. Check the secret.
- No connection: "Couldn't reach Google."
- No playlist row in the tab: there's no playlist called Frame TV, it's empty, or you signed in with another account.
  Nothing says so, and Home shows the newest from the subscriptions instead. A new playlist shows up within half an
  hour.

## GitHub

**What it gives:** the GitHub tab: commits over the last six months across your repos, the languages they're written
in, and the newest projects. It's updated every half hour, the languages once a day.

**What you need:** a GitHub account and a token that can only read.

| Setting | What | Where it comes from |
|---|---|---|
| `github` | The switch | `true` |
| `github_token` | A fine-grained token | github.com → Settings → Developer settings → Fine-grained tokens |
| `github_hide` | Repos to leave out, comma-separated, without the owner | Your choice, for example `old-repo,dotfiles` |

**Access the token needs, and no more:** your own repositories, with **Contents: Read-only** and
**Metadata: Read-only**.

**When it's missing or wrong:**

- Without the token: the module stays off.
- A wrong or expired token: "GitHub didn't accept the token (github_token)." Fine-grained tokens expire, so this will
  come sooner or later. The last answer stays on the screen.
- A repo is missing: the token was made for selected repositories, and that one isn't among them. Forks, archived
  repos and repos you don't own are left out too, and so are repos without a push in six months.

## Vercel

**What it gives:** the latest deploys, in the GitHub tab. With only Vercel on, the tab shows only the deploys; with only
GitHub, it shows everything but them.

**What you need:** a Vercel account and a token.

| Setting | What | Where it comes from |
|---|---|---|
| `vercel` | The switch | `true` |
| `vercel_token` | A token | vercel.com → Account Settings → Tokens |
| `vercel_team` | The team, by id (`team_…`) or slug | Vercel's team settings; empty means your own account |

**Access the token needs:** only reading deployments, but Vercel's tokens can't be limited to reading. Limit the token
to the team it's for, and give it an expiry date.

**When it's missing or wrong:**

- Without the token: the module stays off.
- A wrong or expired token: "Vercel didn't accept the token (vercel_token)."
- "No deploys yet.": check `vercel_team`. Without it, you see your own account's deploys, not the team's.

## Home Assistant

The settings and everything else are in [home-assistant.md](home-assistant.md).

## Spotify

**What it gives:** the Spotify tab and a tile on Home: what's playing on any of your devices, with the buttons previous,
play/pause, next, volume, "Play on…" (this TV or another Spotify device) and "Open Spotify". The remote's play/pause
controls Spotify everywhere in Frame TV.

"Play on…" → "This TV" opens the Spotify app on the TV and moves playback there. That app has to be installed, and it
has to stay in front, since it stops playing when Frame TV comes back.

**What you need:**

- A Spotify account with **Premium**. Spotify requires it of whoever owns the app in the next step, and the buttons
  need it too.
- An app at Spotify.
- The Mac with this repo, since the sign-in happens in its browser.

| Setting | What | Where it comes from |
|---|---|---|
| `spotify` | The switch | `true` |
| `spotify_client_id` | The Spotify app's client id | [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) |
| `spotify_refresh_token` | The sign-in | Filled in by the sign-in on the Mac |

**Getting it working:**

1. At [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), make an app. Tick **Web API**, and add
   the redirect URI `http://127.0.0.1:8888/callback` exactly as written.
2. Open the app's settings and copy its **Client ID**. No client secret is needed.
3. Start the setup page (`python3 tools/setup.py`), and paste it into `spotify_client_id` under Spotify.
4. Press **Sign in to Spotify**, by `spotify_refresh_token`. Spotify opens in a new tab; approve, and the page fills in
   the token. Or, with the setup page closed, run `python3 tools/spotify_login.py`, which writes the same token to
   `config.properties`.
5. Turn `spotify` on, and press "Save, build and install".

The Spotify tab is now in the tab bar. It says "Nothing playing" until something plays on one of your devices, and the
gear → Connections says "On". The Home tile comes when there's room for it, and first while something is playing.

While the app is in development mode, it takes at most 5 users. An account other than the one that made the app must be
added under the app's user management first.

**When it's missing or wrong:**

- Without the client id or the token: the module stays off.
- "The Spotify sign-in has run out: run tools/spotify_login.py and install again." Spotify accepts the token for 6
  months. You also get this if the app has been removed from the TV, since Spotify can swap the token along the way,
  and the newest one is only on the TV.
- "Spotify didn't accept spotify_client_id.": the client id is wrong, or the app has been deleted.
- "Spotify only lets Premium accounts control the playing.": what's playing is shown, but the buttons need Premium.
- "Spotify has had too many calls from this app: trying again in a while.": it tries again by itself.
- "Can't reach Spotify.": no connection.

## Art Mode

**What it gives:** a tile on Home with the picture's name and the mode, and a button in the tab bar. OK on the tile turns on
Art Mode, and holding OK gives a new picture. When the screensaver starts, the TV goes into Art Mode. What's on the wall
is decided by Frame Art, and everything else about the pictures is set there.

**What you need:** Home Assistant OS or Supervised, with the Frame Art add-on installed and running. See
[Frame Art's documentation](https://github.com/eaugum/frame-art/blob/main/frame_art/DOCS.md).

| Setting | What | Where it comes from |
|---|---|---|
| `art` | The switch | `true` |
| `art_url` | The add-on's address | Home Assistant's address with port 8099, for example `http://192.168.1.10:8099` |
| `art_key` | The key to the add-on's API | Settings → Add-ons → Frame Art → Configuration → `api_key`; the add-on fills it in at its first start |

**When it's missing or wrong:**

- Without `art_url`: the module stays off.
- Without `art_key`, with the wrong key, or with an add-on that doesn't answer: the module is on, but the buttons say
  "Couldn't reach Art Mode on the Pi." The TV can't tell these apart, so check the key first.
- When the screensaver starts and the add-on doesn't answer, Frame TV shows its own screensaver instead.

To come back to Frame TV when Art Mode is turned off, set the add-on's option `back_app` to `FrameTVapp.FrameTV`.

## General

| Setting | What | Where it comes from |
|---|---|---|
| `city` | The city, for the weather and the sunset that dims the home screen in the evening | Your choice. `Bergen, NO` picks the country. The place is looked up when the app is built. Empty means the main city in the TV's time zone |
| `name` | Your name in the greeting when the TV isn't linked to Stasera | Your choice. Empty gives just "Good afternoon" |
| `language` | `auto` (the TV's language), `nb` or `en` | Your choice |
| `temperature` | `C`, `F` or `auto` (F in the US, C elsewhere) | Your choice |

If the city isn't found when the app is built, the build says so and the TV's time zone picks one. On the TV, the place
is under the gear → Place. An older file may still have `latitude` and `longitude`; they work, and they win over the
lookup.

## Set on the TV

These are picked on the TV. "Upload config" fills them in, so you rarely need to edit them.

| Setting | What | Where on the TV |
|---|---|---|
| `shelf` | The apps on Home, comma-separated app ids, in order. Empty means the default list in [features.md](features.md), those that are installed | The gear → Apps |
| `hide_apps` | Apps left out of Home and All Apps | The gear → Apps |
| `home_assistant_scenes`, `_lights`, `_power`, `_laundry`, `_guest_wifi` | Home Assistant's entities | The gear → Connections → Home Assistant; see [home-assistant.md](home-assistant.md#what-the-tab-shows) |
| `saver_minutes` | Idle minutes before the screensaver: 0 is never, empty is 15 | The gear → Screensaver and Art Mode |
| `saver_every` | Minutes between its pictures; empty is 5 | The gear → Screensaver and Art Mode |
| `youtube_playlist` | See [YouTube](#youtube) | The gear → Connections → YouTube |

## Installing

These are the Mac's own, for "Save, build and install" on the setup page. The app on the TV only gets `setup_key`.

| Setting | What | Where it comes from |
|---|---|---|
| `tv_ip` | The TV's IP address | On the TV: Settings → General → Network → Network Status → IP Settings |
| `sign_profile` | The certificate profile that signs the app. Every update must use the same one | Made by `tizen/make-certificate.sh` (`tizen/add-profile.sh` for a certificate you already have); see [development.md](development.md#the-certificate) |
| `setup_key` | Lets "Upload config" on the TV in | The setup page makes it at the first install; a new one needs a new install |

## Upload config

The TV keeps what you changed on it, and its sign-ins to YouTube, Stasera and Spotify. All of that is gone when the app
is uninstalled, so bring it back to the file:

1. Start the setup page on the Mac: `python3 tools/setup.py`. It must be running, with `tv_ip` set.
2. On the TV, go to the gear and choose **Upload config**, at the bottom.
3. On the setup page, look through what came and accept it.

The button is only there when the app was installed from the setup page, since that build has the Mac's address (port
8890) and `setup_key`. A new install from the file then starts out the same, signed in.
