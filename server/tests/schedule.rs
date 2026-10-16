use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use dashboard::{duration::parse_duration, schedule::Schedule};
use std::time::Duration;

fn ny() -> Tz { chrono_tz::America::New_York }
fn utc(s: &str) -> DateTime<Utc> { s.parse().unwrap() }

#[test]
fn durations_parse_each_unit() {
    assert_eq!(parse_duration("500ms").unwrap(), Duration::from_millis(500));
    assert_eq!(parse_duration("30s").unwrap(), Duration::from_secs(30));
    assert_eq!(parse_duration("15m").unwrap(), Duration::from_secs(900));
    assert_eq!(parse_duration("1h").unwrap(), Duration::from_secs(3600));
    assert_eq!(parse_duration("2d").unwrap(), Duration::from_secs(172_800));
}

#[test]
fn bad_durations_explain_themselves() {
    assert!(parse_duration("15").unwrap_err().contains("unit"));
    assert!(parse_duration("15y").unwrap_err().contains("unknown unit"));
    assert!(parse_duration("0m").unwrap_err().contains("greater than zero"));
    assert!(parse_duration("m").is_err());
}

#[test]
fn every_adds_the_interval() {
    let s = Schedule::every("30m").unwrap();
    assert_eq!(s.next_after(utc("2026-10-14T12:00:00Z"), ny()), utc("2026-10-14T12:30:00Z"));
    assert_eq!(s.default_stale_after(), Duration::from_secs(3600));
    assert_eq!(s.describe(), "every 30m");
}

#[test]
fn cron_market_hours_skips_the_weekend() {
    // Friday 16:30 EDT is the last slot of the week; next is Monday 09:00 EDT.
    let s = Schedule::cron("*/30 9-16 * * 1-5").unwrap();
    assert_eq!(s.next_after(utc("2026-10-16T20:30:00Z"), ny()), utc("2026-10-19T13:00:00Z"));
}

#[test]
fn cron_follows_the_dst_change() {
    // DST ends 2026-11-01; 09:00 local moves from 13:00Z to 14:00Z.
    let s = Schedule::cron("0 9 * * *").unwrap();
    assert_eq!(s.next_after(utc("2026-10-31T13:00:00Z"), ny()), utc("2026-11-01T14:00:00Z"));
}

#[test]
fn bad_cron_is_rejected() {
    assert!(Schedule::cron("every tuesday").is_err());
}
