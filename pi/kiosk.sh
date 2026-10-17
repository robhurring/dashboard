#!/bin/bash
# The dashboard URL comes from ~/.config/dashboard-kiosk.env, written by setup.sh.
# shellcheck source=/dev/null
. "$HOME/.config/dashboard-kiosk.env"
: "${DASHBOARD_URL:?DASHBOARD_URL missing from ~/.config/dashboard-kiosk.env; re-run bin/pi setup}"

# Display power (see display.sh): dim or sleep when idle, per the cron ranges in the settings file.
# Replaces any copies from an earlier launch.
run="${XDG_RUNTIME_DIR:-/tmp}"
for pidfile in "$run/dashboard-display.pid" "$run/dashboard-swayidle.pid"; do
	[ -f "$pidfile" ] && kill "$(cat "$pidfile")" 2>/dev/null
	rm -f "$pidfile"
done
if [ -n "${KIOSK_DIM_WHEN:-}${KIOSK_SLEEP_WHEN:-}" ]; then
	"$HOME/display.sh" loop &
	echo $! > "$run/dashboard-display.pid"
	swayidle \
		timeout $(( ${KIOSK_DIM_AFTER:-10} * 60 )) "$HOME/display.sh idle dim" \
		timeout $(( ${KIOSK_SLEEP_AFTER:-5} * 60 )) "$HOME/display.sh idle sleep" \
		resume "$HOME/display.sh active" &
	echo $! > "$run/dashboard-swayidle.pid"
fi

xset s off
xset -dpms
xset s noblank

unclutter -display :0 -idle 0 -root &

chromium \
	--noerrdialogs \
	--disable-infobars \
	--kiosk \
	--incognito \
	--disable-translate \
	--disable-features=TranslateUI \
	--disable-session-crashed-bubble \
	--disable-restore-session-state \
	--password-store=basic \
	--touch-events=enabled \
	--unsafely-treat-insecure-origin-as-secure="$DASHBOARD_URL" \
	"$DASHBOARD_URL"
