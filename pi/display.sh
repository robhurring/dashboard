#!/bin/bash
# The kiosk's display power, in two states that each apply during cron ranges:
#   dim:   during KIOSK_DIM_WHEN, after KIOSK_DIM_AFTER idle minutes, the backlight drops to KIOSK_DIM_LEVEL%
#   sleep: during KIOSK_SLEEP_WHEN, after KIOSK_SLEEP_AFTER idle minutes, the panel turns off
# A touch brings it back to full brightness. Where both ranges match, sleep wins; outside both the
# screen stays bright. The browser keeps running throughout, so the dashboard is current on wake.
#
#   display.sh idle dim|sleep   swayidle calls these as each idle time passes (see kiosk.sh)
#   display.sh active           ... and this on the next touch
#   display.sh loop             re-applies every minute, so ranges start and end on time
#   display.sh desired <reached> "<min hour day month weekday>"   prints bright, dim or off (for tests)
#
# Settings come from ~/.config/dashboard-kiosk.env (written by bin/pi from your .env). Ranges are cron
# expressions (minute hour day-of-month month day-of-week; * , - / supported, 0 or 7 = Sunday);
# separate several with ";".
set -euo pipefail

ENV_FILE="$HOME/.config/dashboard-kiosk.env"
# shellcheck source=/dev/null
if [[ -f "$ENV_FILE" && "${1:-}" != desired ]]; then . "$ENV_FILE"; fi
KIOSK_DIM_WHEN="${KIOSK_DIM_WHEN:-}"
KIOSK_DIM_LEVEL="${KIOSK_DIM_LEVEL:-15}"
KIOSK_SLEEP_WHEN="${KIOSK_SLEEP_WHEN:-}"
RUN="${XDG_RUNTIME_DIR:-/tmp}"
STATE_FILE="$RUN/dashboard-kiosk.state"      # the idle thresholds reached: "active", "dim", "dim sleep"
APPLIED_FILE="$RUN/dashboard-kiosk.applied"  # what the display is set to now

# Whether a value matches one cron field: * , a-b and /step.
field_matches() {  # field_matches <value> <field> <min> <max>
  local v=$((10#$1)) item range step from to
  IFS=',' read -r -a items <<<"$2"
  for item in "${items[@]}"; do
    step=1; range="$item"
    [[ "$item" == */* ]] && { step="${item#*/}"; range="${item%/*}"; }
    if [[ "$range" == "*" ]]; then from=$3; to=$4
    elif [[ "$range" == *-* ]]; then from=$((10#${range%-*})); to=$((10#${range#*-}))
    else from=$((10#$range)); to=$from; [[ "$item" == */* ]] && to=$4
    fi
    (( v >= from && v <= to && (v - from) % step == 0 )) && return 0
  done
  return 1
}

# Whether "<min hour day month weekday>" matches a cron expression. Like cron, when both day fields are
# restricted, either one matching is enough.
cron_matches() {  # cron_matches "<now>" "<expression>"
  local -a now f
  read -r -a now <<<"$1"
  read -r -a f <<<"$2"
  (( ${#f[@]} == 5 )) || { echo "display.sh: a cron range needs 5 fields, got '$2'" >&2; return 1; }
  local wd=$((10#${now[4]} % 7)) dow="${f[4]}"
  field_matches "${now[0]}" "${f[0]}" 0 59 || return 1
  field_matches "${now[1]}" "${f[1]}" 0 23 || return 1
  field_matches "${now[3]}" "${f[3]}" 1 12 || return 1
  if [[ "${f[2]}" != "*" && "$dow" != "*" ]]; then
    field_matches "${now[2]}" "${f[2]}" 1 31 || weekday_matches "$wd" "$dow" || return 1
  else
    field_matches "${now[2]}" "${f[2]}" 1 31 || return 1
    weekday_matches "$wd" "$dow" || return 1
  fi
}

# Sunday is 0 or 7 in cron.
weekday_matches() {  # weekday_matches <0-6> <field>
  field_matches "$1" "$2" 0 7 || { (( $1 == 0 )) && field_matches 7 "$2" 0 7; }
}

# Whether now falls in any of the ";"-separated ranges.
in_ranges() {  # in_ranges "<now>" "<ranges>"
  local expr
  IFS=';' read -r -a exprs <<<"$2"
  for expr in "${exprs[@]}"; do
    expr="$(echo "$expr" | xargs)"
    [[ -n "$expr" ]] && cron_matches "$1" "$expr" && return 0
  done
  return 1
}

desired() {  # desired <reached> "<now>"
  if [[ " $1 " == *" sleep "* ]] && in_ranges "$2" "$KIOSK_SLEEP_WHEN"; then echo off
  elif [[ " $1 " == *" dim "* ]] && in_ranges "$2" "$KIOSK_DIM_WHEN"; then echo dim
  else echo bright
  fi
}

backlight() { ls -d /sys/class/backlight/* 2>/dev/null | head -1; }

set_level() {  # set_level <percent>
  local bl max
  bl=$(backlight || true)
  [[ -n "$bl" ]] || return 0
  max=$(cat "$bl/max_brightness")
  echo $(( (max * $1 + 99) / 100 )) > "$bl/brightness"
}

panel() {  # panel on|off: the whole output, which saves the most power
  WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-$(ls "$RUN" | grep -m1 '^wayland-[0-9]*$' || true)}" wlopm --"$1" '*' >/dev/null 2>&1 || true
}

apply() {
  local reached want
  reached=$(cat "$STATE_FILE" 2>/dev/null || echo active)
  want=$(desired "$reached" "$(date '+%M %H %d %m %w')")
  [[ "$want" == "$(cat "$APPLIED_FILE" 2>/dev/null || true)" ]] && return 0
  case "$want" in
    bright) panel on; set_level 100 ;;
    dim)    panel on; set_level "$KIOSK_DIM_LEVEL" ;;
    off)    set_level 0; panel off ;;
  esac
  echo "$want" > "$APPLIED_FILE"
}

case "${1:-}" in
  idle)
    [[ "${2:-}" == dim || "${2:-}" == sleep ]] || { echo "usage: display.sh idle dim|sleep" >&2; exit 1; }
    reached=$(cat "$STATE_FILE" 2>/dev/null || echo active)
    reached="${reached/active/}"
    [[ " $reached " == *" $2 "* ]] || reached="$reached $2"
    echo "$reached" | xargs > "$STATE_FILE"
    apply ;;
  active) echo active > "$STATE_FILE"; apply ;;
  loop) echo active > "$STATE_FILE"; rm -f "$APPLIED_FILE"; apply; while sleep 60; do apply; done ;;
  desired) desired "$2" "$3" ;;
  *) echo "usage: display.sh idle dim|sleep | active | loop | desired <reached> <now>" >&2; exit 1 ;;
esac
