# Step C: apply | restore | status. Four services that systemd starts whatever the registry says; their units have no
# stop condition and /etc is read-only, so the masks live in /run and every restart (not standby) undoes them.
# Left running on purpose: mirroring-recognition-manager (Smart View; Frame Art uses 8001/8002) and user-presence
# (stopping it after a restart was followed by the tested Frame dropping off Wi-Fi). (frame.sh comes in front.)
action=${1:-status}
fail=0
case "$action" in
apply)
    for u in $MASKS; do
        systemctl mask --runtime "$u" >/dev/null 2>&1 || { echo "mask failed: $u" >&2; fail=1; }
        systemctl stop --no-block "$u" || fail=1
    done
    i=0
    while [ $i -lt 15 ]; do
        busy=0
        for u in $MASKS; do [ "$(systemctl is-active "$u")" = inactive ] || busy=1; done
        [ $busy = 0 ] && break
        sleep 1; i=$((i + 1))
    done;;
restore)
    for u in $MASKS; do
        systemctl unmask --runtime "$u" >/dev/null 2>&1 || fail=1
        systemctl start --no-block "$u" || fail=1
    done;;
status) ;;
*) echo 'Use apply, restore or status.' >&2; exit 1;;
esac
echo "uptime: $(cut -d' ' -f1 /proc/uptime) s"
for u in $MASKS; do
    a=$(systemctl is-active "$u"); e=$(systemctl is-enabled "$u" 2>/dev/null)
    echo "mask $u: $a, $e"
    if [ "$action" = apply ] && { [ "$a" != inactive ] || [ "$e" != masked-runtime ]; }; then fail=1; fi
done
if [ "$action" = status ]; then
    for u in $MASKS; do
        [ "$(systemctl is-enabled "$u" 2>/dev/null)" = masked-runtime ] || { echo 'Step C is off (the TV restarted): press Apply everything.'; break; }
    done
fi
[ "$fail" = 0 ] || { echo "NOT OK: masks $action" >&2; exit 1; }
echo "OK: masks $action"
