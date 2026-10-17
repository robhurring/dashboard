//! The calendar module's own iCalendar parser (modules/calendar/ics.lua), run in a real VM against the host's
//! `ctx.instant`. Host zone: America/New_York.
use dashboard::host_api::{CallContext, build_ctx};
use dashboard::lua_vm::Vm;
use serde_json::{Value, json};
use std::{path::Path, sync::{Arc, Once, atomic::AtomicBool}, time::Duration};

static TZ: Once = Once::new();

async fn events(ics: &str, from: &str, to: &str) -> Result<Vec<(String, String, String, bool)>, String> {
    // SAFETY: set once, before any test reads it, to the same value for every test in this binary.
    TZ.call_once(|| unsafe { std::env::set_var("TZ", "America/New_York") });
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../modules/calendar/ics.lua");
    let vm = Vm::new().unwrap();
    let cc = CallContext { instance: "calendar".into(), state: json!(null), config: json!({}), http: reqwest::Client::new(), refresh: Arc::new(AtomicBool::new(false)), sys: None, persist: None };
    let ctx = build_ctx(&vm.lua, &cc).unwrap();
    let ics_lib: mlua::Table = vm.lua.load(std::fs::read_to_string(&path).unwrap()).set_name("ics.lua").eval().unwrap();
    let f: mlua::Function = ics_lib.get("events").unwrap();
    let window = vm.lua.create_table().unwrap();
    window.set("from", from).unwrap();
    window.set("to", to).unwrap();
    let v: mlua::Value = vm.run(Duration::from_secs(5), f.call_async((ics.to_string(), window, ctx))).await?;
    let json = vm.to_json(v)?.unwrap_or(Value::Null);
    Ok(json.as_array().unwrap().iter().map(|e| (
        e["title"].as_str().unwrap().to_string(), e["start"].as_str().unwrap().to_string(), e["end"].as_str().unwrap().to_string(), e["all_day"].as_bool().unwrap(),
    )).collect())
}

fn ev(title: &str, start: &str, end: &str, all_day: bool) -> (String, String, String, bool) {
    (title.into(), start.into(), end.into(), all_day)
}

const ICS: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Family\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART;TZID=America/New_York:20261015T090000\r\nDTEND;TZID=America/New_York:20261015T093000\r\nSUMMARY:Standup\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\nEXDATE;TZID=America/New_York:20261016T090000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:2\r\nDTSTART;VALUE=DATE:20261017\r\nDTEND;VALUE=DATE:20261018\r\nSUMMARY:Trip\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:3\r\nDTSTART:20261020T150000Z\r\nDTEND:20261020T160000Z\r\nSUMMARY:Call with\r\n  a folded line\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:4\r\nDTSTART;VALUE=DATE:20260101\r\nSUMMARY:Old\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

#[tokio::test]
async fn expands_recurrences_in_the_window_with_exceptions_and_all_day_events() {
    assert_eq!(events(ICS, "2026-10-15", "2026-10-19").await.unwrap(), vec![
        ev("Standup", "2026-10-15T09:00:00-04:00", "2026-10-15T09:30:00-04:00", false),
        ev("Trip", "2026-10-17", "2026-10-18", true),
    ]);
}

#[tokio::test]
async fn a_wider_window_includes_later_occurrences_and_converts_utc_to_the_host_zone() {
    assert_eq!(events(ICS, "2026-10-19", "2026-10-21").await.unwrap(), vec![
        ev("Standup", "2026-10-19T09:00:00-04:00", "2026-10-19T09:30:00-04:00", false),
        ev("Standup", "2026-10-20T09:00:00-04:00", "2026-10-20T09:30:00-04:00", false),
        ev("Call with a folded line", "2026-10-20T11:00:00-04:00", "2026-10-20T12:00:00-04:00", false),
    ]);
}

#[tokio::test]
async fn until_without_a_zone_is_accepted_and_a_broken_rule_only_drops_its_own_event() {
    let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART;TZID=America/New_York:20261001T080000\r\nDTEND;TZID=America/New_York:20261001T083000\r\nSUMMARY:Flea meds\r\nRRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261231\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:b\r\nDTSTART;VALUE=DATE:20261001\r\nSUMMARY:Bins\r\nRRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=20261231T050000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:c\r\nDTSTART;TZID=America/New_York:20261015T120000\r\nSUMMARY:Broken\r\nRRULE:FREQ=NONSENSE\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:d\r\nDTSTART;TZID=America/New_York:20261015T170000\r\nSUMMARY:Dinner\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    assert_eq!(events(ics, "2026-10-15", "2026-10-17").await.unwrap(), vec![
        ev("Flea meds", "2026-10-15T08:00:00-04:00", "2026-10-15T08:30:00-04:00", false),
        ev("Dinner", "2026-10-15T17:00:00-04:00", "2026-10-15T17:00:00-04:00", false),
        ev("Bins", "2026-10-16", "2026-10-17", true),
    ]);
}

#[tokio::test]
async fn an_until_in_the_past_ends_the_series() {
    let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261001T130000Z\r\nDTEND:20261001T140000Z\r\nSUMMARY:Done\r\nRRULE:FREQ=DAILY;UNTIL=20261010T130000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    assert_eq!(events(ics, "2026-10-09", "2026-10-13").await.unwrap(), vec![
        ev("Done", "2026-10-09T09:00:00-04:00", "2026-10-09T10:00:00-04:00", false),
        ev("Done", "2026-10-10T09:00:00-04:00", "2026-10-10T10:00:00-04:00", false),
    ]);
}

#[tokio::test]
async fn moved_and_cancelled_occurrences_replace_their_generated_instance() {
    let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:s\r\nDTSTART;TZID=America/New_York:20261012T100000\r\nDTEND;TZID=America/New_York:20261012T110000\r\nSUMMARY:Sync\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:s\r\nRECURRENCE-ID;TZID=America/New_York:20261015T100000\r\nDTSTART;TZID=America/New_York:20261015T140000\r\nDTEND;TZID=America/New_York:20261015T150000\r\nSUMMARY:Sync (moved)\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:s\r\nRECURRENCE-ID;TZID=America/New_York:20261016T100000\r\nDTSTART;TZID=America/New_York:20261016T100000\r\nSTATUS:CANCELLED\r\nSUMMARY:Sync\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    assert_eq!(events(ics, "2026-10-15", "2026-10-18").await.unwrap(), vec![
        ev("Sync (moved)", "2026-10-15T14:00:00-04:00", "2026-10-15T15:00:00-04:00", false),
        ev("Sync", "2026-10-17T10:00:00-04:00", "2026-10-17T11:00:00-04:00", false),
    ]);
}

#[tokio::test]
async fn recurrences_follow_their_own_zone_across_its_daylight_saving_change() {
    // London leaves summer time on 2026-10-25, a week before New York: 09:00 London is 04:00 then 05:00 here.
    let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:l\r\nDTSTART;TZID=Europe/London:20261019T090000\r\nDTEND;TZID=Europe/London:20261019T093000\r\nSUMMARY:London standup\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    assert_eq!(events(ics, "2026-10-19", "2026-10-27").await.unwrap(), vec![
        ev("London standup", "2026-10-19T04:00:00-04:00", "2026-10-19T04:30:00-04:00", false),
        ev("London standup", "2026-10-26T05:00:00-04:00", "2026-10-26T05:30:00-04:00", false),
    ]);
}

#[tokio::test]
async fn monthly_rules_with_an_ordinal_weekday_and_a_count() {
    let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:m\r\nDTSTART;TZID=America/New_York:20260908T180000\r\nDTEND;TZID=America/New_York:20260908T190000\r\nSUMMARY:Book club\r\nRRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:y\r\nDTSTART;VALUE=DATE:20250101\r\nSUMMARY:Last Friday\r\nRRULE:FREQ=MONTHLY;BYDAY=-1FR\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    assert_eq!(events(ics, "2026-10-01", "2027-01-01").await.unwrap(), vec![
        ev("Book club", "2026-10-13T18:00:00-04:00", "2026-10-13T19:00:00-04:00", false),
        ev("Last Friday", "2026-10-30", "2026-10-31", true),
        ev("Book club", "2026-11-10T18:00:00-05:00", "2026-11-10T19:00:00-05:00", false),
        ev("Last Friday", "2026-11-27", "2026-11-28", true),
        ev("Last Friday", "2026-12-25", "2026-12-26", true),
    ]);
}

#[tokio::test]
async fn text_escapes_are_decoded() {
    let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e\r\nDTSTART;VALUE=DATE:20261015\r\nSUMMARY:Pick up milk\\, eggs\\; bread\\\\more\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    assert_eq!(events(ics, "2026-10-15", "2026-10-16").await.unwrap()[0].0, "Pick up milk, eggs; bread\\more");
}

#[tokio::test]
async fn garbage_is_an_error_not_a_panic() {
    let err = events("not a calendar", "2026-10-15", "2026-10-16").await.unwrap_err();
    assert!(err.contains("iCalendar"), "{err}");
}

#[tokio::test]
async fn a_large_feed_fits_in_the_sandbox_fetch_after_fetch() {
    // Google feeds run to a few MB: years of events, each with long descriptions and attendee lists.
    let mut ics = String::from("BEGIN:VCALENDAR\r\nX-WR-CALNAME:Big\r\n");
    let filler = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. ".repeat(4);
    for i in 0..3000 {
        ics.push_str(&format!(
            "BEGIN:VEVENT\r\nUID:e{i}\r\nDTSTART;TZID=America/New_York:2025{:02}{:02}T090000\r\nDTEND;TZID=America/New_York:2025{:02}{:02}T100000\r\nSUMMARY:Event {i}\r\nDESCRIPTION:{filler}\r\n ATTENDEE;CN=\"Someone: Else\";ROLE=REQ-PARTICIPANT:mailto:someone{i}@example.com\r\nLOCATION:Room {i}\r\nEND:VEVENT\r\n",
            i % 12 + 1, i % 28 + 1, i % 12 + 1, i % 28 + 1
        ));
    }
    ics.push_str("BEGIN:VEVENT\r\nUID:today\r\nDTSTART;TZID=America/New_York:20261015T090000\r\nDTEND;TZID=America/New_York:20261015T093000\r\nSUMMARY:Standup\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n");
    assert!(ics.len() > 1_500_000, "{}", ics.len());

    // One VM, as an instance keeps: the second fetch must not run out of memory either.
    TZ.call_once(|| unsafe { std::env::set_var("TZ", "America/New_York") });
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../modules/calendar/ics.lua");
    let vm = Vm::new().unwrap();
    let cc = CallContext { instance: "calendar".into(), state: json!(null), config: json!({}), http: reqwest::Client::new(), refresh: Arc::new(AtomicBool::new(false)), sys: None, persist: None };
    let ctx = build_ctx(&vm.lua, &cc).unwrap();
    let lib: mlua::Table = vm.lua.load(std::fs::read_to_string(&path).unwrap()).eval().unwrap();
    let f: mlua::Function = lib.get("events").unwrap();
    for round in 0..3 {
        let window = vm.lua.create_table().unwrap();
        window.set("from", "2026-10-15").unwrap();
        window.set("to", "2026-10-17").unwrap();
        let v: mlua::Value = vm.run(Duration::from_secs(10), f.call_async((ics.clone(), window, ctx.clone()))).await
            .unwrap_or_else(|e| panic!("round {round}: {e}"));
        let n = vm.to_json(v).unwrap().unwrap().as_array().unwrap().len();
        assert_eq!(n, 2, "round {round}");
    }
}
