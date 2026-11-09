# What tools/root/root.sh changes on the TV, in one place. root.sh puts this in front of each TV script.
# Tested on a 2022 Frame (Tizen 6.5, firmware build 20260225); the app ids come from frame-privacy's profile for it.
# Kept on: SmartThings, the screen reader and text-to-speech, HbbTV and screen mirroring (Frame Art uses 8001/8002).

STATE=/opt/usr/share/frame-tv-root
ORIGINAL=$STATE/original.txt
REGISTRY=/opt/dbspace/.pkgmgr_parser.db
WAS=/opt/dbspace/.webappservice.db
MARKERS=/opt/usr/share/systemd/system
FRAME_TV=FrameTVapp.FrameTV

# Apps whose registry record is turned off (app_disable true, app_onboot and app_autorestart false).
APPS='
com.samsung.tizen.samsung-analytics
com.samsung.tv.acr
com.samsung.tv.canalysis-service
com.samsung.tv.contents-recognition-dbmgr
com.samsung.tv.adagent-service
com.samsung.tv.pisa-service
org.tizen.pisa-control-service
com.samsung.tv.targeted-ad-service
com.samsung.tv.farfieldvoice
com.samsung.tv.google-assistant
com.samsung.tv.iacr
com.samsung.tv.coba.adagent
com.samsung.tv.context-aware-agent
com.samsung.tv.context-aware-agent-toast-view
com.samsung.tv.context-aware-grab-control
com.samsung.tv.context-aware-server-requester
com.samsung.tv.context-aware-service
com.samsung.tv.vif
content-grab-service
com.samsung.tv.alexa-client
com.samsung.tv.alexa-fullscreen-app
com.samsung.tv.bixby-context-client
com.samsung.tv.bixby-prov
com.samsung.tv.bixbycapsuleviewer
com.samsung.tv.mybixby
com.samsung.tv.ondevice-voice
com.samsung.tv.utterance-recommender-app
com.samsung.tv.utterance-recommender-core
com.samsung.tv.voice-instant-app
com.samsung.tv.voiceassistant-music
com.samsung.tv.wakeup-engine-alexa
com.samsung.tv.wakeup-engine-bixby
org.tizen.voice-app
org.tizen.voice-app-service
org.tizen.voice-client
org.tizen.voice-onboarding
com.samsung.tv.tvplus
com.samsung.tv.adplayer
com.samsung.tv.aov-dashboard
com.samsung.tv.ghdaemon
com.samsung.tv.ghservice
samsunghealth-service-tv
'

# Preferences turned off: key, type, value when off.
PREFS='
db/si_service/voice_recog_enable bool 0
db/multi-assistant/prelaunch_mode bool 0
db/menu/autorun_tv_plus bool 0
db/was/preload_by_country string false
'

# Services kept from starting by Samsung's own stop-file condition: unit, marker file in $MARKERS.
STOPS='
pisa-service.service pisa-service
canalysis-service.service canalysis-daemon
com.samsung.tv.context-aware-service.service com.samsung.tv.context-aware-service
com.samsung.tv.context-aware-agent.service com.samsung.tv.context-aware-agent
slive-provider-daemon.service slive-provider-daemon
'

# Home and startup keys; setting the main operation moves the last two with it on this firmware.
HOME_KEYS='db/appfw/home_appid db/appfw/startup_appid db/appfw/booting_appid_backup'

# Step C: masked in /run, so gone after every restart (not standby).
MASKS='wifi-presence.service kpi-logging.service contents-recognition-service.service com.samsung.tv.activity-inference-service.service'

set -u
test "$(id -u)" = 0 || { echo 'Needs root.' >&2; exit 1; }

# The recorded original value: original KIND NAME -> the rest of the line.
original() { sed -n "s#^$1 $2 ##p" "$ORIGINAL" | head -1; }
vconf_value() { vconftool get "$1" 2>/dev/null | sed -n 's/.*value = \(.*\) ([A-Za-z0-9]*)$/\1/p'; }
main_operation() { /usr/bin/dotnet "$STATE/Probe.dll" | sed -n 's/^home_result=0 home=//p'; }
preload() { sqlite3 -readonly "$WAS" "SELECT json_extract(value,'\$.rsp.preloadByCountry') FROM WASConfigTable WHERE name='RESERVED_18' AND json_valid(value);"; }
