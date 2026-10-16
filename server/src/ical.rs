//! ICS calendars → the events in a date window, recurrences expanded, in the host time zone.
//! Parsing is `icalendar`; recurrence expansion is `rrule`. Overridden occurrences
//! (RECURRENCE-ID) replace their generated instance.
use chrono::{DateTime, Duration, NaiveDate, SecondsFormat, TimeZone};
use chrono_tz::Tz;
use icalendar::{Calendar, CalendarDateTime, Component, DatePerhapsTime, Event as IcalEvent};
use rrule::RRuleSet;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Event {
    pub title: String,
    /// RFC 3339 in the host zone for timed events, `YYYY-MM-DD` for all-day ones.
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub calendar: String,
}

#[derive(Clone, Copy)]
enum When {
    Day(NaiveDate),
    At(DateTime<Tz>),
}

fn resolve(dpt: &DatePerhapsTime, tz: Tz) -> Option<When> {
    match dpt {
        DatePerhapsTime::Date(d) => Some(When::Day(*d)),
        DatePerhapsTime::DateTime(cdt) => match cdt {
            CalendarDateTime::Utc(u) => Some(When::At(u.with_timezone(&tz))),
            CalendarDateTime::Floating(n) => tz.from_local_datetime(n).earliest().map(When::At),
            CalendarDateTime::WithTimezone { date_time, tzid } => {
                let zone: Tz = tzid.parse().unwrap_or(tz);
                zone.from_local_datetime(date_time).earliest().map(|d| When::At(d.with_timezone(&tz)))
            }
        },
    }
}

fn fmt_at(d: &DateTime<Tz>) -> String {
    d.to_rfc3339_opts(SecondsFormat::Secs, false)
}

/// The window [from, to) as instants in the host zone.
fn window(from: NaiveDate, to: NaiveDate, tz: Tz) -> Option<(DateTime<Tz>, DateTime<Tz>)> {
    let start = tz.from_local_datetime(&from.and_hms_opt(0, 0, 0)?).earliest()?;
    let end = tz.from_local_datetime(&to.and_hms_opt(0, 0, 0)?).earliest()?;
    Some((start, end))
}

/// Feeds write UNTIL as a bare date or a local time; the rrule crate wants it in UTC. Rewrite it so.
fn normalize_until(rule: &str, tz: Tz) -> String {
    rule.split(';')
        .map(|part| {
            let Some(value) = part.strip_prefix("UNTIL=") else { return part.to_string() };
            if value.ends_with('Z') { return part.to_string(); }
            let utc = if value.len() == 8 {
                NaiveDate::parse_from_str(value, "%Y%m%d").ok().and_then(|d| d.and_hms_opt(23, 59, 59)).and_then(|n| tz.from_local_datetime(&n).earliest())
            } else {
                chrono::NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%S").ok().and_then(|n| tz.from_local_datetime(&n).earliest())
            };
            match utc {
                Some(dt) => format!("UNTIL={}", dt.with_timezone(&chrono::Utc).format("%Y%m%dT%H%M%SZ")),
                None => part.to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join(";")
}

/// DTSTART and EXDATE lines in the shape the rrule crate parses, all in the host zone.
fn rrule_text(ev: &IcalEvent, start: When, rule: &str, tz: Tz) -> String {
    let stamp = |w: When| match w {
        When::Day(d) => format!("{}T000000", d.format("%Y%m%d")),
        When::At(d) => d.format("%Y%m%dT%H%M%S").to_string(),
    };
    let mut text = format!("DTSTART;TZID={}:{}\nRRULE:{}\n", tz.name(), stamp(start), normalize_until(rule, tz));
    let mut exdates: Vec<&icalendar::Property> = ev.multi_properties().get("EXDATE").map(|v| v.iter().collect()).unwrap_or_default();
    if let Some(p) = ev.properties().get("EXDATE") {
        exdates.push(p);
    }
    for p in exdates {
        for raw in p.value().split(',') {
            let parsed: Option<DatePerhapsTime> = {
                let is_date = p.params().get("VALUE").map(|v| v.value() == "DATE").unwrap_or(false) || raw.len() == 8;
                if is_date {
                    NaiveDate::parse_from_str(raw, "%Y%m%d").ok().map(DatePerhapsTime::Date)
                } else {
                    let tzid = p.params().get("TZID").map(|v| v.value().to_string());
                    let naive = chrono::NaiveDateTime::parse_from_str(raw.trim_end_matches('Z'), "%Y%m%dT%H%M%S").ok();
                    naive.map(|n| {
                        DatePerhapsTime::DateTime(match (raw.ends_with('Z'), tzid) {
                            (true, _) => CalendarDateTime::Utc(chrono::Utc.from_utc_datetime(&n)),
                            (false, Some(tzid)) => CalendarDateTime::WithTimezone { date_time: n, tzid },
                            (false, None) => CalendarDateTime::Floating(n),
                        })
                    })
                }
            };
            if let Some(w) = parsed.and_then(|d| resolve(&d, tz)) {
                text.push_str(&format!("EXDATE;TZID={}:{}\n", tz.name(), stamp(w)));
            }
        }
    }
    text
}

/// Every event occurrence that overlaps `[from, to)`, sorted by start.
pub fn events(text: &str, from: NaiveDate, to: NaiveDate, tz: Tz) -> Result<Vec<Event>, String> {
    let cal: Calendar = text.parse().map_err(|e: String| format!("not an iCalendar: {e}"))?;
    let name = cal.get_name().unwrap_or("Calendar").to_string();
    let (win_start, win_end) = window(from, to, tz).ok_or("bad window")?;

    // Overrides: an event with RECURRENCE-ID replaces that occurrence of its series.
    let mut overridden: HashMap<String, HashSet<String>> = HashMap::new();
    for ev in cal.events() {
        if let (Some(uid), Some(rid)) = (ev.get_uid(), ev.get_recurrence_id().and_then(|r| resolve(&r, tz))) {
            overridden.entry(uid.to_string()).or_default().insert(match rid {
                When::Day(d) => d.to_string(),
                When::At(d) => fmt_at(&d),
            });
        }
    }

    let mut out = Vec::new();
    for ev in cal.events() {
        let title = ev.get_summary().unwrap_or("Untitled").to_string();
        let Some(start) = ev.get_start().and_then(|s| resolve(&s, tz)) else { continue };
        let end = ev.get_end().and_then(|e| resolve(&e, tz));
        let push = |out: &mut Vec<Event>, s: When, e: Option<When>| match (s, e) {
            (When::Day(sd), e) => {
                let ed = match e { Some(When::Day(d)) => d, _ => sd + Duration::days(1) };
                if sd < to && ed > from {
                    out.push(Event { title: title.clone(), start: sd.to_string(), end: ed.to_string(), all_day: true, calendar: name.clone() });
                }
            }
            (When::At(sa), e) => {
                let ea = match e { Some(When::At(d)) => d, _ => sa };
                if sa < win_end && ea >= win_start && (ea > win_start || sa >= win_start) {
                    out.push(Event { title: title.clone(), start: fmt_at(&sa), end: fmt_at(&ea), all_day: false, calendar: name.clone() });
                }
            }
        };

        let rule = ev.property_value("RRULE");
        let is_override = ev.get_recurrence_id().is_some();
        match rule {
            Some(rule) if !is_override => {
                // One unparseable rule drops that event only; the rest of the calendar still shows.
                let set: RRuleSet = match rrule_text(ev, start, rule, tz).parse() {
                    Ok(set) => set,
                    Err(e) => { tracing::warn!(event = %title, error = %e, "skipping event with an unparseable RRULE"); continue; }
                };
                let after = rrule::Tz::Tz(tz).from_utc_datetime(&(win_start - Duration::days(2)).naive_utc());
                let before = rrule::Tz::Tz(tz).from_utc_datetime(&(win_end + Duration::days(1)).naive_utc());
                let length = match (start, end) {
                    (When::At(s), Some(When::At(e))) => e - s,
                    (When::Day(s), Some(When::Day(e))) => e - s,
                    (When::Day(_), _) => Duration::days(1),
                    _ => Duration::zero(),
                };
                let skipped = ev.get_uid().and_then(|u| overridden.get(u));
                for occ in set.after(after).before(before).all(2000).dates {
                    let local = occ.with_timezone(&tz);
                    let s = match start { When::Day(_) => When::Day(local.date_naive()), When::At(_) => When::At(local) };
                    let key = match s { When::Day(d) => d.to_string(), When::At(d) => fmt_at(&d) };
                    if skipped.is_some_and(|k| k.contains(&key)) { continue; }
                    let e = match s { When::Day(d) => When::Day(d + length), When::At(d) => When::At(d + length) };
                    push(&mut out, s, Some(e));
                }
            }
            _ => push(&mut out, start, end),
        }
    }
    out.sort_by(|a, b| a.start.cmp(&b.start).then(a.title.cmp(&b.title)));
    Ok(out)
}
