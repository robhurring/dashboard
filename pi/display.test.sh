#!/usr/bin/env bash
# Tests for the pure part of pi/display.sh: which display state the idle thresholds reached and the
# current minute call for.
set -euo pipefail
cd "$(dirname "$0")"
fail=0
DIM="* 8-18 * * 1-5"
SLEEP="* 0-7,19-23 * * 1-5; * * * * 0,6"
check() {  # check <expected> <reached: active | dim | sleep | "dim sleep"> "<minute hour day month weekday>"
  local got
  got=$(KIOSK_DIM_WHEN="$DIM" KIOSK_SLEEP_WHEN="$SLEEP" bash display.sh desired "$2" "$3")
  if [[ "$got" != "$1" ]]; then echo "FAIL: reached='$2' at '$3': expected $1, got $got"; fail=1; fi
}
check bright active      "30 12 15 10 3"   # Wednesday noon, in use
check dim    dim         "30 12 15 10 3"   # idle past the dim time in working hours
check dim    "dim sleep" "30 12 15 10 3"   # sleep doesn't apply in working hours
check bright dim         "30 21 15 10 3"   # Wednesday night: no dim range, sleep not reached yet
check off    "dim sleep" "30 21 15 10 3"   # ... and once idle long enough, off
check off    sleep       "00 03 15 10 3"
check off    sleep       "00 12 17 10 6"   # Saturday: sleep range all day
check off    sleep       "00 12 18 10 0"   # Sunday
check dim    dim         "00 08 13 10 1"   # Monday 08:00 is working hours
check bright dim         "59 07 13 10 1"   # 07:59 isn't
check dim    dim         "59 18 16 10 5"   # Friday 18:59 is
check bright dim         "00 19 16 10 5"   # 19:00 isn't
check bright active      "00 03 15 10 3"   # touched at night: bright
# Cron syntax: steps, lists, ranges, 7 as Sunday, names are not supported.
DIM="*/15 9 * * 1,3,5"; SLEEP="* * * * 7"
check dim    dim         "30 9 15 10 3"
check bright dim         "31 9 15 10 3"
check off    sleep       "00 12 18 10 0"
DIM="* * * * 1-7"; SLEEP=""
check dim    dim         "00 12 18 10 0"   # 1-7 includes Sunday
check dim    dim         "00 12 13 10 1"   # ... and Monday
DIM=""; SLEEP=""
check bright "dim sleep" "30 12 15 10 3"   # no ranges: never dims or sleeps
[[ $fail == 0 ]] && echo "pi/display.sh: ok"
exit $fail
