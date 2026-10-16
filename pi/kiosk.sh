#!/bin/bash
# The dashboard URL comes from ~/.config/dashboard-kiosk.env, written by setup.sh.
# shellcheck source=/dev/null
. "$HOME/.config/dashboard-kiosk.env"
: "${DASHBOARD_URL:?DASHBOARD_URL missing from ~/.config/dashboard-kiosk.env; re-run bin/pi setup}"

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
