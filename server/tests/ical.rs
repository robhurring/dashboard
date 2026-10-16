use chrono::NaiveDate;
use dashboard::ical::{Event, events};

const ICS: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Family\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART;TZID=America/New_York:20261015T090000\r\nDTEND;TZID=America/New_York:20261015T093000\r\nSUMMARY:Standup\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\nEXDATE;TZID=America/New_York:20261016T090000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:2\r\nDTSTART;VALUE=DATE:20261017\r\nDTEND;VALUE=DATE:20261018\r\nSUMMARY:Trip\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:3\r\nDTSTART:20261020T150000Z\r\nDTEND:20261020T160000Z\r\nSUMMARY:Call with\r\n  a folded line\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:4\r\nDTSTART;VALUE=DATE:20260101\r\nSUMMARY:Old\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

fn day(s: &str) -> NaiveDate { NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap() }
fn brief(e: &Event) -> (String, String, String, bool) { (e.title.clone(), e.start.clone(), e.end.clone(), e.all_day) }

#[test]
fn expands_recurrences_in_the_window_with_exceptions_and_all_day_events() {
    let tz: chrono_tz::Tz = "America/New_York".parse().unwrap();
    let got = events(ICS, day("2026-10-15"), day("2026-10-19"), tz).unwrap();
    let briefs: Vec<_> = got.iter().map(brief).collect();
    assert_eq!(briefs, vec![
        ("Standup".into(), "2026-10-15T09:00:00-04:00".into(), "2026-10-15T09:30:00-04:00".into(), false),
        ("Trip".into(), "2026-10-17".into(), "2026-10-18".into(), true),
    ]);
    assert!(got.iter().all(|e| e.calendar == "Family"));
}

#[test]
fn a_wider_window_includes_later_occurrences_and_converts_utc_to_the_host_zone() {
    let tz: chrono_tz::Tz = "America/New_York".parse().unwrap();
    let got = events(ICS, day("2026-10-19"), day("2026-10-21"), tz).unwrap();
    let briefs: Vec<_> = got.iter().map(brief).collect();
    assert_eq!(briefs, vec![
        ("Standup".into(), "2026-10-19T09:00:00-04:00".into(), "2026-10-19T09:30:00-04:00".into(), false),
        ("Standup".into(), "2026-10-20T09:00:00-04:00".into(), "2026-10-20T09:30:00-04:00".into(), false),
        ("Call with a folded line".into(), "2026-10-20T11:00:00-04:00".into(), "2026-10-20T12:00:00-04:00".into(), false),
    ]);
}

#[test]
fn until_without_a_zone_is_accepted_and_a_broken_rule_only_drops_its_own_event() {
    let tz: chrono_tz::Tz = "America/New_York".parse().unwrap();
    let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART;TZID=America/New_York:20261001T080000\r\nDTEND;TZID=America/New_York:20261001T083000\r\nSUMMARY:Flea meds\r\nRRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261231\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:b\r\nDTSTART;VALUE=DATE:20261001\r\nSUMMARY:Bins\r\nRRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=20261231T050000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:c\r\nDTSTART;TZID=America/New_York:20261015T120000\r\nSUMMARY:Broken\r\nRRULE:FREQ=NONSENSE\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:d\r\nDTSTART;TZID=America/New_York:20261015T170000\r\nSUMMARY:Dinner\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    let got = events(ics, day("2026-10-15"), day("2026-10-17"), tz).unwrap();
    let titles: Vec<&str> = got.iter().map(|e| e.title.as_str()).collect();
    assert_eq!(titles, vec!["Flea meds", "Dinner", "Bins"]);
    assert_eq!(got[0].start, "2026-10-15T08:00:00-04:00");
    assert_eq!(got[2].start, "2026-10-16");
}

#[test]
fn garbage_is_an_error_not_a_panic() {
    let tz = chrono_tz::UTC;
    assert!(events("not a calendar", day("2026-10-15"), day("2026-10-16"), tz).is_err());
}
