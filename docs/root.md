# Root on the TV

Optional. `tools/root/` uses temporary root on the TV ([frame-privacy](https://github.com/OsloSwede88/frame-privacy)
and its quiet-tizen tools) to turn off Samsung's tracking and to make the remote's Home button open Frame TV. Tested on
one 2022 Frame (TQ50LS03B, Tizen 6.5, EU firmware 1720.7, build 20260225); other models and firmware may differ, and
the script stops if the build isn't the one in `root.local.env`.

## What it changes

All of it is listed in [`tools/root/tv/frame.sh`](../tools/root/tv/frame.sh):

- **42 apps turned off** in the TV's app registry: ACR and viewing analysis, ads, analytics, voice assistants
  (Bixby, Alexa, Google Assistant, wake words), context suggestions, Samsung TV Plus, Gaming Hub, Samsung Health.
- **Four preferences off:** voice recognition, assistant prelaunch, TV Plus autorun, preloading apps by country.
- **Five services kept from starting** with Samsung's own stop files: PISA, canalysis, the two context-aware services
  and TV Plus's provider.
- **The Home button** opens Frame TV (see [Troubleshooting](troubleshooting.md#on-the-tv)). On the tested firmware this
  also makes the TV start in Frame TV; it still turns on in Art Mode.
- **Step C:** four services that watch the network and report from the TV (`wifi-presence`, `kpi-logging`,
  `contents-recognition-service`, `activity-inference-service`) are stopped. They have no stop file, so this lasts
  until the next restart (standby keeps it).

Kept on purpose: SmartThings, the screen reader and text-to-speech, HbbTV, screen mirroring (Frame Art uses ports 8001
and 8002) and `user-presence` (stopping it after a restart made the tested Frame drop off Wi-Fi).

## Running it

1. Developer Mode on the TV, with this Mac as Host PC IP ([install step 2](install.md#2-turn-on-developer-mode-on-the-tv)).
2. Copy `tools/root/root.example.env` to `root.local.env` (gitignored) and fill in the TV: its IP, the model and
   firmware from Settings → Support → About This TV, and the build date from `/proc/target_version`.
3. `tools/root/root.sh check` fetches what it needs into `tools/root/work/` (sdb, .NET 6, frame-privacy at a pinned
   commit; Samsung's sdb needs Rosetta on Apple Silicon) and checks root and the build. It changes nothing.

Then from the setup page (`python3 tools/setup.py`, "Root on the TV") or the terminal:

| Button | `root.sh` | What it does |
|---|---|---|
| Status | `status` | Reads what's on; changes nothing |
| Apply everything | `apply` | Backup (one a day), the TV's own values recorded once, then everything above |
| Undo everything | `restore` | Puts back the TV's own values: Smart Hub on Home, every app and service on |

Each change checks first: an app record is only changed while it still has the value recorded (or ours), so something
Samsung changed in between is left alone and reported. `apply` can be run again and changes only what isn't done, so
after a restart it puts step C back and leaves the rest.

## Undo and what to watch

- The TV's own values are kept on the TV in `/opt/usr/share/frame-tv-root/original.txt` (and a copy in
  `tools/root/work/`), written on the first `apply` and never overwritten. Backups of the databases are in
  `/opt/usr/share/quiet-tizen-backups/`.
- Undo before uninstalling Frame TV, or Home points at an app that's gone.
- Undoing needs root too. A firmware update can reset some of this, or close the way to root: keep the TV off
  automatic updates while it's applied, and run Status after any update.
- Root sessions are short-lived: nothing keeps running on the TV afterwards.
- `tizen/install.py` can't reach the TV while sdb holds it; `root.sh` lets go when it's done.
