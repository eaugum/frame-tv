# The Home button: apply (Frame TV) | restore (the recorded original) | status. (frame.sh comes in front of this.)
# Samsung's app_operation_set_current_app, through Probe.dll, points the main operation at the app; on the tested
# firmware that also moves startup_appid and booting_appid_backup, which restore puts back too.
action=${1:-status}
test -s "$ORIGINAL" && test -s "$STATE/Probe.dll" || { echo 'Run apply through root.sh first.' >&2; exit 1; }
was_main=$(original home main)
case "$was_main" in ''|*[!A-Za-z0-9_.-]*) echo 'No usable original Home recorded.' >&2; exit 1;; esac
fail=0
case "$action" in
apply)
    test "$(sqlite3 -readonly "$REGISTRY" "SELECT app_disable FROM package_app_info WHERE app_id='$FRAME_TV';")" = false ||
        { echo "$FRAME_TV isn't installed (or is turned off); Home left alone." >&2; exit 1; }
    now=$(main_operation)
    case "$now" in "$was_main"|"$FRAME_TV") ;;
        *) echo "Home is '$now', neither the original '$was_main' nor Frame TV; left alone." >&2; exit 1;; esac
    /usr/bin/dotnet "$STATE/Probe.dll" set-home "$FRAME_TV" >/dev/null || fail=1
    vconftool set -f -t string db/appfw/home_appid "$FRAME_TV" >/dev/null || fail=1;;
restore)
    /usr/bin/dotnet "$STATE/Probe.dll" set-home "$was_main" >/dev/null || fail=1
    for key in $HOME_KEYS; do
        value=$(original home "$key")
        case "$value" in ''|*[!A-Za-z0-9_.-]*) echo "No usable original for $key." >&2; fail=1; continue;; esac
        vconftool set -f -t string "$key" "$value" >/dev/null || fail=1
    done;;
status) ;;
*) echo 'Use apply, restore or status.' >&2; exit 1;;
esac
echo "home main operation: $(main_operation)"
for key in $HOME_KEYS; do echo "home $key: $(vconf_value "$key")"; done
[ "$fail" = 0 ] || { echo "NOT OK: home $action" >&2; exit 1; }
echo "OK: home $action"
