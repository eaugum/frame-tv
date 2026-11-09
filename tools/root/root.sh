#!/bin/sh
# Temporary root on a Frame, from nothing, through frame-privacy and quiet-tizen (see docs/root.md).
# Reads the TV from tools/root/root.local.env (gitignored; start from root.example.env) and keeps everything it
# fetches in tools/root/work/ (gitignored). What it changes on the TV is listed in tools/root/tv/frame.sh.
#   tools/root/root.sh prepare             Get the tools ready on the Mac; doesn't touch the TV.
#   tools/root/root.sh check               Preflight, root as `id`, and compare the TV's firmware build.
#   tools/root/root.sh status              What's on: apps, preferences, stop markers, Home, step C.
#   tools/root/root.sh apply               Backup, then everything: apps off, preferences, markers, Home, step C.
#                                          Again after a restart: a restart (not standby) undoes step C only.
#   tools/root/root.sh restore             Undo everything: the TV's original values back.
#   tools/root/root.sh dns                 Check the DNS block from the TV (frame-privacy tv/dns-check.sh).
#   tools/root/root.sh exec|pull|push ...  Passed on to quiet-tizen's tools/tv.py.
# Developer Mode on the TV must have this Mac's current IP as Host PC IP, or SDB won't connect.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
CONFIG=$HERE/root.local.env
test -f "$CONFIG" || { echo "Missing $CONFIG: copy root.example.env and fill it in." >&2; exit 1; }
. "$CONFIG"

FP_URL=https://github.com/OsloSwede88/frame-privacy.git
FP_COMMIT=dd6a31b663b9063fbeb5a2a2174d4a9be78c475c
SDB_ZIP=sdb_4.2.36_macos-64.zip
SDB_SHA256=0bd307ac8382c857be5c2106dd5b8587b10c1c91ac1e504de8432c8276bc28c5

WORK=$HERE/work
FP=$WORK/frame-privacy
QT=$FP/quiet-tizen
PROFILE=.local/frame-profile.json
export SDB="$WORK/sdb-zip/data/tools/sdb"
export DOTNET="$WORK/dotnet/dotnet"
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

prepare() {
    # Samsung's sdb is Intel only. Rosetta needs the owner to accept Apple's licence, so it isn't automatic.
    if ! arch -x86_64 /usr/bin/true 2>/dev/null; then
        echo 'Rosetta is missing. Run this yourself, then try again: softwareupdate --install-rosetta' >&2
        exit 1
    fi
    mkdir -p "$WORK"
    if [ ! -x "$SDB" ]; then
        echo 'Fetching sdb...'
        curl -fsS "https://download.tizen.org/sdk/tizenstudio/official/binary/$SDB_ZIP" -o "$WORK/sdb.zip"
        test "$(shasum -a 256 "$WORK/sdb.zip" | cut -d' ' -f1)" = "$SDB_SHA256" || {
            echo 'sdb did not match its checksum.' >&2; exit 1; }
        unzip -qo "$WORK/sdb.zip" -d "$WORK/sdb-zip"
        chmod +x "$SDB"
    fi
    if [ ! -x "$DOTNET" ]; then
        echo 'Fetching .NET 6...'
        curl -fsSL https://dot.net/v1/dotnet-install.sh -o "$WORK/dotnet-install.sh"
        bash "$WORK/dotnet-install.sh" --channel 6.0 --install-dir "$WORK/dotnet" --no-path
    fi
    if [ ! -d "$FP/.git" ]; then
        git clone --quiet "$FP_URL" "$FP"
        git -C "$FP" checkout --quiet "$FP_COMMIT"
    fi
    test "$(git -C "$FP" rev-parse HEAD)" = "$FP_COMMIT" || {
        echo "$FP is not at the pinned commit $FP_COMMIT." >&2; exit 1; }
    if [ ! -d "$QT/.git" ] || ! grep -q DEFAULT_PROFILE "$QT/tools/tv.py"; then
        (cd "$FP" && ./setup.sh)
    fi
    cd "$QT"
    # On this firmware a staged script file fails, so the runtime check has to stay inline.
    if ! git apply --reverse --check "$HERE/runtime-check.patch" 2>/dev/null; then
        git apply "$HERE/runtime-check.patch"
    fi
    if [ ! -f "$PROFILE" ]; then
        # A copy of frame-privacy's profile for its 43-inch model, with our model and firmware; its app ids are
        # not verified on other models.
        python3 - "$PROFILE" "$TV_MODEL" "$TV_FIRMWARE" <<'EOF'
import json, sys
path, model, firmware = sys.argv[1:]
profile = json.load(open('profiles/tq43ls03bguxxc-1720.7.json'))
profile.update(model=model, firmware=firmware)
profile.pop('build', None)
profile['qualification'] = {'status': 'copy of the 43-inch profile; app ids not verified on this TV'}
json.dump(profile, open(path, 'w'), indent=2)
EOF
    fi
    if [ ! -f .local/build/payloads/SamsungTvRootAgent.dll ]; then
        python3 tools/build.py payloads --target-framework netcoreapp3.1
    fi
    # Probe reads and sets the Home app through Samsung's native API; the TV runs .NET Core 3.1.
    if [ ! -f "$WORK/probe/Probe.dll" ]; then
        mkdir -p "$WORK/probe-src"
        cp launcher/probe/Probe.cs "$WORK/probe-src/"
        sed 's#<TargetFramework>net6.0</TargetFramework>#<TargetFramework>netcoreapp3.1</TargetFramework>#' \
            launcher/probe/Probe.csproj > "$WORK/probe-src/Probe.csproj"
        "$DOTNET" build "$WORK/probe-src/Probe.csproj" -c Release -o "$WORK/probe" >/dev/null
    fi
    echo 'The Mac is ready.'
}

tv() {
    python3 tools/tv.py --host "$TV_IP" --firmware "$TV_FIRMWARE" --profile "$PROFILE" "$@"
}

# A TV script with frame.sh (the lists and helpers) in front of it, run as root.
tvscript() {
    script=$1; shift
    tmp=$(mktemp "$WORK/tv-XXXXXX")
    cat "$HERE/tv/frame.sh" "$HERE/tv/$script" > "$tmp"
    args=''
    for a in "$@"; do args="$args --arg $a"; done   # simple words only (apply, restore, status)
    if tv exec --script "$tmp" $args; then status=0; else status=$?; fi
    rm -f "$tmp"
    return $status
}

same_build() {
    build=$(tv exec --command 'cat /proc/target_version')
    case $build in
        *"$TV_BUILD"*) echo "Firmware build $TV_BUILD, as tested.";;
        *) echo "$build" >&2
           echo "The TV is no longer on build $TV_BUILD. Stop: don't write anything until it's checked again." >&2
           exit 1;;
    esac
}

# Probe.dll next to the recorded values on the TV, where Home and restore find it after a restart.
probe_on_tv() {
    tv push "$WORK/probe/Probe.dll" Probe.dll >/dev/null
    tv push "$WORK/probe/Probe.runtimeconfig.json" Probe.runtimeconfig.json >/dev/null
    tv exec --command 'set -e; S=/home/owner/share/tmp/sdk_tools/quiet-tizen; D=/opt/usr/share/frame-tv-root;
        mkdir -p "$D"; chmod 700 "$D"; cp "$S/Probe.dll" "$S/Probe.runtimeconfig.json" "$D/";
        rm -f "$S/Probe.dll" "$S/Probe.runtimeconfig.json"; echo "Probe on the TV."'
}

step() { printf '\n== %s\n' "$1"; }

connect() {
    # Let go of the TV afterwards: tizen/install.py can't reach it while this sdb server holds it.
    trap '"$SDB" kill-server >/dev/null 2>&1' EXIT
    # Just after a restart the TV takes a minute or so before sdb gets in: keep trying for 90 s.
    i=0
    while [ $i -lt 9 ]; do
        if nc -z -G 3 "$TV_IP" 26101 2>/dev/null; then
            # connect exits non-zero when the TV is already connected, so look at the device list instead.
            "$SDB" connect "$TV_IP:26101" >/dev/null 2>&1 || true
            "$SDB" devices | grep -q "^$TV_IP:26101.*device" && return 0
            "$SDB" kill-server >/dev/null 2>&1   # a stale server can hold on to a TV that restarted
        fi
        [ $i = 0 ] && echo 'Waiting for the TV (it may still be starting)...'
        sleep 10; i=$((i + 1))
    done
    echo "Can't reach the TV over sdb on $TV_IP:26101. Is it on, with Developer Mode and this Mac" \
         "($(ipconfig getifaddr en0 2>/dev/null)) as Host PC IP?" >&2
    exit 1
}

case ${1:-} in
prepare)
    prepare;;
check)
    prepare
    connect
    python3 tools/tv.py --host "$TV_IP" --profile "$PROFILE" doctor
    tv root-check
    same_build
    echo 'Root is ready.';;
status)
    prepare >/dev/null
    connect
    step 'Apps, preferences and stop markers'
    tvscript privacy.sh status || true
    step 'Home button'
    tvscript home.sh status || true
    step 'Step C (until the next restart)'
    tvscript masks.sh status || true;;
apply)
    prepare >/dev/null
    connect
    same_build
    step 'Backup'
    # One backup a day, so running apply after every restart doesn't pile them up.
    name=frametv-$(date +%Y%m%d)
    if tv exec --command "test -e /opt/usr/share/quiet-tizen-backups/$name" >/dev/null 2>&1; then
        echo "Today's backup is already there ($name)."
    else
        tv exec --script recipes/snapshot.sh --arg "$name"
    fi
    probe_on_tv
    step 'Original values'
    tvscript originals.sh
    tv pull /opt/usr/share/frame-tv-root/original.txt .local/frame-tv-original.txt >/dev/null &&
        cp .local/frame-tv-original.txt "$WORK/original.txt" && echo "Copy on this Mac: tools/root/work/original.txt"
    step 'Apps, preferences and stop markers'
    tvscript privacy.sh apply
    step 'Home button'
    tvscript home.sh apply
    step 'Step C (until the next restart)'
    tvscript masks.sh apply
    echo; echo 'Done. After a restart, apply again: it puts step C back and leaves the rest as it is.';;
restore)
    prepare >/dev/null
    connect
    same_build
    step 'Step C'
    tvscript masks.sh restore
    step 'Home button'
    tvscript home.sh restore
    step 'Apps, preferences and stop markers'
    tvscript privacy.sh restore
    echo; echo "Done: the TV's own values are back. A restart clears anything still in memory.";;
dns)
    prepare >/dev/null
    connect
    tv exec --script ../tv/dns-check.sh;;
exec|pull|push)
    prepare >/dev/null
    connect
    tv "$@";;
*)
    sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
    exit 2;;
esac
