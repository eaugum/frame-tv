# Record the TV's own values once, before the first change; tools/root/root.sh restore puts them back.
# Never overwritten: a second run only shows what's there. (frame.sh comes in front of this.)
mkdir -p "$STATE" && chmod 700 "$STATE"
if [ -s "$ORIGINAL" ]; then
    echo "Original values already recorded ($(grep -c . "$ORIGINAL") lines, $(date -r "$ORIGINAL" '+%Y-%m-%d %H:%M'))."
    exit 0
fi
test -s "$STATE/Probe.dll" || { echo "Probe.dll is missing in $STATE." >&2; exit 1; }
tmp=$ORIGINAL.tmp
{
    for id in $APPS; do
        row=$(sqlite3 -readonly -separator ' ' "$REGISTRY" \
            "SELECT app_disable,app_onboot,app_autorestart FROM package_app_info WHERE app_id='$id';")
        echo "app $id ${row:-missing}"
    done
    echo "$PREFS" | while read -r key type off; do
        [ -n "$key" ] && echo "pref $key $(vconf_value "$key")"
    done
    echo "preload - $(preload)"
    echo "$STOPS" | while read -r unit marker; do
        [ -n "$unit" ] || continue
        if [ -e "$MARKERS/$marker" ]; then m=present; else m=absent; fi
        echo "stop $unit $marker $m $(systemctl is-active "$unit")"
    done
    echo "home main $(main_operation)"
    for key in $HOME_KEYS; do echo "home $key $(vconf_value "$key")"; done
} > "$tmp"
grep -q '^home main ..*' "$tmp" && grep -q '^home db/appfw/home_appid ..*' "$tmp" || {
    rm -f "$tmp"; echo 'Could not read the Home values; nothing recorded.' >&2; exit 1; }
chmod 600 "$tmp" && mv "$tmp" "$ORIGINAL"
echo "Recorded the original values in $ORIGINAL:"
cat "$ORIGINAL"
