# Registry records, preferences and stop markers: apply | restore | status. (frame.sh comes in front of this.)
# apply changes a record only while it still has its recorded original values, restore only while it still has ours:
# anything Samsung changed in between is left alone and reported.
action=${1:-status}
test -s "$ORIGINAL" || { echo 'No original values recorded; run apply through root.sh.' >&2; exit 1; }
fail=0

registry() {   # $1: apply or restore
    sql="BEGIN IMMEDIATE;"
    for id in $APPS; do
        set -- "$1" $(original app "$id")
        [ $# = 4 ] || continue   # missing on this TV, or not recorded
        for v in "$2" "$3" "$4"; do case "$v" in true|false) ;; *) continue 2;; esac; done
        if [ "$1" = apply ]; then f1=$2 f2=$3 f3=$4 t1=true t2=false t3=false
        else f1=true f2=false f3=false t1=$2 t2=$3 t3=$4; fi
        sql="$sql UPDATE package_app_info SET app_disable='$t1',app_onboot='$t2',app_autorestart='$t3'
             WHERE app_id='$id' AND app_disable IS '$f1' AND app_onboot IS '$f2' AND app_autorestart IS '$f3';"
    done
    test "$(sqlite3 -readonly "$REGISTRY" 'PRAGMA quick_check;')" = ok
    printf '%s COMMIT;\n' "$sql" | sqlite3 -bail "$REGISTRY"
    test "$(sqlite3 -readonly "$REGISTRY" 'PRAGMA quick_check;')" = ok
}

registry_report() {
    off=0; on=0; other=''
    for id in $APPS; do
        now=$(sqlite3 -readonly -separator ' ' "$REGISTRY" \
            "SELECT app_disable,app_onboot,app_autorestart FROM package_app_info WHERE app_id='$id';")
        was=$(original app "$id")
        if [ -z "$now" ]; then other="$other $id(missing)"
        elif [ "$now" = 'true false false' ]; then off=$((off + 1))
        elif [ "$now" = "$was" ]; then on=$((on + 1))
        else other="$other $id($now)"; fi
    done
    echo "apps: $off off, $on as originally${other:+, changed by someone else:$other}"
    [ -z "$other" ] || return 1
}

prefs() {   # $1: apply or restore
    echo "$PREFS" | while read -r key type off; do
        [ -n "$key" ] || continue
        if [ "$1" = apply ]; then value=$off; else
            value=$(original pref "$key")
            case "$type:$value" in bool:True) value=1;; bool:False) value=0;; esac
        fi
        [ -n "$value" ] && vconftool set -f -t "$type" "$key" "$value" >/dev/null || echo "pref failed: $key" >&2
    done
    if [ "$1" = apply ]; then want=false; else want=$(original preload -); fi
    case "$want" in true|false) ;; *) echo 'No usable preloadByCountry recorded.' >&2; return 1;; esac
    if [ "$(preload)" != "$want" ]; then
        sqlite3 -bail "$WAS" "BEGIN IMMEDIATE; UPDATE WASConfigTable SET value=json_set(value,'\$.rsp.preloadByCountry','$want')
            WHERE name='RESERVED_18' AND json_valid(value); COMMIT;"
        test "$(sqlite3 -readonly "$WAS" 'PRAGMA quick_check;')" = ok
    fi
}

stops() {   # $1: apply or restore
    echo "$STOPS" | while read -r unit marker; do
        [ -n "$unit" ] || continue
        path=$MARKERS/$marker
        # Only Samsung's own negated condition for exactly this file counts.
        systemctl cat "$unit" 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -Fqx "ConditionPathExists=!$path" ||
            { echo "skipped $unit: no stop condition for $path" >&2; continue; }
        set -- "$1" $(original stop "$unit")   # marker present|absent active-state
        if [ "$1" = apply ]; then
            touch "$path" && systemctl stop --no-block "$unit"
        else
            [ "$3" = present ] || rm -f "$path"
            systemctl reset-failed "$unit" 2>/dev/null
            [ "$4" = active ] && systemctl start --no-block "$unit"
        fi
    done
}

case "$action" in
apply) registry apply || fail=1; prefs apply || fail=1; stops apply;;
restore) registry restore || fail=1; prefs restore || fail=1; stops restore;;
status) ;;
*) echo 'Use apply, restore or status.' >&2; exit 1;;
esac
registry_report || fail=1
echo "$PREFS" | while read -r key type off; do [ -n "$key" ] && echo "pref $key: $(vconf_value "$key")"; done
echo "preloadByCountry: $(preload)"
echo "$STOPS" | while read -r unit marker; do
    [ -n "$unit" ] || continue
    if [ -e "$MARKERS/$marker" ]; then m=marker; else m='no marker'; fi
    echo "stop $unit: $m, $(systemctl is-active "$unit")"
done
[ "$fail" = 0 ] || { echo "NOT OK: privacy $action" >&2; exit 1; }
echo "OK: privacy $action"
