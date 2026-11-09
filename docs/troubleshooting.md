# Troubleshooting

Each module's messages on the TV are explained in [modules.md](modules.md) and [home-assistant.md](home-assistant.md).
Problems with what's on the wall in Art Mode are in
[Frame Art's documentation](https://github.com/eaugum/frame-art/blob/main/frame_art/DOCS.md#troubleshooting).

## Where to look

The app has no log of its own on the TV. These are the places to look:

- **The gear → Connections** says how each module stands.
- **`tizen/install.py`** prints what the TV answered.
- **The preview on the Mac** (`python3 tizen/build.py --preview`) has the browser's developer tools. It also shows
  whether a problem is in the app or with the TV.
- **Frame Art's Debug tab**, with the Art Mode module on: Frame TV sends its errors, what it opened and when it was
  hidden there, marked "Frame TV".
- **Home Assistant's log** (Settings → System → Logs) for tokens and events.
- **`sensor.frame_tv`** in Home Assistant, for what the TV says it's doing.

The TV refuses Web Inspector for apps signed with a Tizen certificate, so you can't attach developer tools to the
running app.

## Building and installing

| What you see | What's wrong | What to do |
|---|---|---|
| `This needs Java 17` | `tizen/get-tools.sh` can't find Homebrew's Java | `brew install openjdk@17`, then run it again |
| `Signing needs Samsung's Tizen tools` | The `tizen` tool isn't found | Run `tizen/get-tools.sh`, or set `TIZEN_STUDIO` to where the tools are |
| `Bad CPU type in executable` | Samsung's own installer needs Rosetta | Use `tizen/get-tools.sh` instead |
| `` `tizen package` didn't sign it `` | The profile is missing, or its password | Check the profile name; after the folder has moved, run `tizen/add-profile.sh` |
| `config.properties: … must be …` | A switch or number has another value | Fix the line the message names |
| `Couldn't reach the TV on port 26101` | The TV is off, not in Developer Mode, or doesn't have this computer as Host PC IP | On the TV: Apps, 1 2 3 4 5, Developer mode on with the Mac's IP, then restart the TV. Do it again whenever the Mac gets a new address |
| `The Frame TV app on the TV was signed with another certificate` | The update has to use the certificate of the app that's there | Use the same certificate. If that one is gone, remove the app (Apps, Settings, Frame TV, Delete), but run [Upload config](modules.md#upload-config) first |
| `FrameTV.wgt isn't signed` | It was built without `--sign` | Build with `--sign`; `build.py` must end with `signed with "…"` |
| `The TV didn't finish installing` | The TV refused it for another reason | Read what the TV said |
| "Save, build and install" asks for `tv_ip` and `sign_profile` | They haven't been saved | Fill in both on the setup page |

Keep `tizen-studio-data/keystore/author/*.p12` and its password in a safe place. Without them, every update means
removing the app, and with that what was set on the TV.

**The TV stopped answering on port 26101 after one of its own updates.** A software update can turn Developer Mode off.
Go through [step 2 of the installation](install.md#2-turn-on-developer-mode-on-the-tv) again. If Developer Mode is on
with the right address and it still doesn't answer, pull the TV's power cable for a minute.

## On the TV

**The Home button opens Smart Hub, not Frame TV.** That is how Samsung sets the TV up, and the app can't catch the
button: it isn't in `tizen.tvinputdevice.getSupportedKeys()`, and a press never arrives as a `keydown`. Without root,
turn on *Autorun Last App* in Settings → General → Smart Features and keep Frame TV first in the app row; then Home → OK
opens it. Home Assistant can also start the app through the remote control API.

With temporary root ([Root on the TV](root.md); tested on a 2022 Frame, Tizen 6.5, firmware build 20260225), the Home button can
open Frame TV:

- Samsung's `app_operation_set_current_app` points `http://tizen.org/appcontrol/operation/main` at
  `FrameTVapp.FrameTV`, and `db/appfw/home_appid` is set to the same. On that firmware the call also moves
  `db/appfw/startup_appid` and `db/appfw/booting_appid_backup`; `db/first_screen/type` stays Smart Hub. The TV still
  turns on in Art Mode, and Source, Multi View and the apps work as before.
- Save the four old values first (all `com.samsung.tv.csfs` there). Undoing it means writing them back, as root again.
- Undo it before `tizen/install.py --uninstall`, or Home points at an app that's gone. A firmware update can reset it,
  or close the way to root.

The app needs nothing set for this. Back on the first screen opens Smart Hub, so there is always a way there. A Home
press inside the app sends it no event either; Tizen only relaunches it quietly (`entry_point=smarthub_key`,
`SkipReload=Yes`), so the app looks at its requested app control while it's showing and goes to the Home tab.

**A module doesn't show up.** Look under the gear → Connections. "On · Missing …" names what's lacking. A setting
changed on the TV wins over the file until the file changes; see [How settings work](modules.md#how-settings-work).

**A change in `config.properties` didn't happen.** The file goes into the app when it's built, so build and install
again. If the TV has its own value and the file's line didn't change, the TV's value stays.

**A token doesn't work.** A new token typed on the TV is tried on its service before it's saved. "{service} turned it
down." means the token is wrong. "Couldn't reach {service} to check it" means the TV has no connection to that service.
Tokens are much easier to paste on the Mac.

**Everything set on the TV is gone.** The app was uninstalled. Tokens and picks come back from `config.properties` if
you ran [Upload config](modules.md#upload-config) earlier; otherwise, set them again.

**"Upload config" isn't there.** The app wasn't built by the setup page: only "Save, build and install" puts the Mac's
address and the key in it, and `tizen/build.py` on its own leaves them out. It's also missing if port 8890 was taken
during that install.

**"Couldn't reach the setup page. Is it running?"** Start `python3 tools/setup.py`, with `tv_ip` set, and have the Mac
on the same network as the TV. If the Mac has a new address, install from the setup page again. If the terminal running
`setup.py` says `"Upload config" is off`, port 8890 is taken.

**"The setup page didn't accept this TV: install the app from it again."** `setup_key` has changed since the app was
installed.

**The screensaver isn't Art Mode.** Frame TV shows its own when the add-on doesn't answer, refuses the key, or can't get
the TV into Art Mode; that can take up to a minute. With `switch.frame_art_screensaver` off there's no screensaver at
all, and the gear says "Off in Home Assistant".

**No weather.** "No weather data right now." means Open-Meteo didn't answer. It keeps asking, every 30 seconds.

## Frame TV and Frame Art together

**Buttons say "Couldn't reach Art Mode on the Pi."**

1. Open `http://<Home Assistant>:8099/status?key=<art_key>` in a browser on the same network.
2. If it answers `wrong or no key`, `art_key` doesn't match the add-on's `api_key`.
3. If nothing answers, the add-on isn't running, or port 8099 is turned off under Network on the add-on's Configuration
   tab.
4. If it answers, but the buttons still fail, the add-on can't reach the TV. Look at the add-on's log.

**Art Mode works from Home Assistant, but not from Frame TV**: the same steps; Home Assistant uses MQTT, not the key.
