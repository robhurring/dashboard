//! The calendar module against a stub of its upstream.
use axum::{Router, routing::get};
use dashboard::hub::Hub;
use dashboard::instance::{FetchOutcome, InstanceEvent, InstanceSpec, Limits, spawn};
use dashboard::module_def::ModuleDef;
use dashboard::persist::Persist;
use serde_json::{Value, json};
use std::{path::Path, sync::Arc, time::Duration};

async fn stub() -> String {
    let app = Router::new()
        .route("/work.ics", get(|| async {
            "BEGIN:VCALENDAR\r\nX-WR-CALNAME:Work\r\nBEGIN:VEVENT\r\nUID:w\r\nDTSTART:20000101T150000Z\r\nDTEND:20000101T153000Z\r\nSUMMARY:Standup\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
        }))
        .route("/cal.ics", get(|| async {
            "BEGIN:VCALENDAR\r\nX-WR-CALNAME:Home\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART:20000101T130000Z\r\nDTEND:20000101T140000Z\r\nSUMMARY:Daily\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
        }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

async fn fetch(module: &str, config: Value) -> (Value, Option<Value>) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../modules").join(module).join("module.lua");
    let def = ModuleDef::load(&path).await.map(Arc::new);
    assert!(def.is_ok(), "{module}: {:?}", def.as_ref().err());
    let hub = Hub::new(Persist::memory()).await.unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let services = dashboard::instance::HostServices { sys: dashboard::sysstats::Sampler::start(), persist: Persist::memory() };
    let h = spawn(InstanceSpec { id: module.into(), def, config }, hub.clone(), reqwest::Client::new(), Limits::default(), services, tx);
    h.request_fetch();
    match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap() {
        InstanceEvent::FetchFinished { outcome, .. } => assert_eq!(outcome, FetchOutcome::Updated, "{module}"),
        other => panic!("{other:?}"),
    }
    let stored = hub.get(module).await.unwrap();
    (stored.state, stored.view)
}

#[tokio::test]
async fn calendar_module_fetches_and_renders() {
    let base = stub().await;
    // SAFETY: this binary runs a single test; nothing else reads the environment concurrently.
    unsafe {
        std::env::set_var("GOOGLE_CALENDAR_ICS_URL", format!(" {base}/cal.ics , {base}/cal.ics, {base}/gone.ics"));
        std::env::set_var("CALENDAR_WORK", format!("{base}/work.ics"));
        std::env::set_var("CALENDAR_ONCALL", format!("{base}/cal.ics"));
    }

    // Two good feeds (with sloppy spacing) and one that 404s, three days: the daily event appears 3 times per good feed,
    // and the dead feed is counted, not fatal.
    let (state, view) = fetch("calendar", json!({ "days": 3 })).await;
    assert!(view.is_none(), "calendar is a custom component");
    assert_eq!(state["days"], 3);
    assert_eq!(state["failed"], 1);
    let events = state["events"].as_array().unwrap();
    assert_eq!(events.len(), 8, "{events:?}"); // days + 1 per feed
    assert!(events.iter().all(|e| e["title"] == "Daily" && e["calendar"] == "Home" && e["all_day"] == false));
    assert!(events[0]["start"].as_str().unwrap().starts_with(state["from"].as_str().unwrap()));

    // Each panel can name its own feeds: `feeds = "work,oncall"` reads CALENDAR_WORK and CALENDAR_ONCALL.
    let (state, _) = fetch("calendar", json!({ "days": 1, "feeds": "work, oncall" })).await;
    let titles: Vec<&str> = state["events"].as_array().unwrap().iter().map(|e| e["title"].as_str().unwrap()).collect();
    assert_eq!(titles.iter().filter(|t| **t == "Standup").count(), 2, "{titles:?}");
    assert_eq!(titles.iter().filter(|t| **t == "Daily").count(), 2, "{titles:?}");
    assert_eq!(state["failed"], 0);
}

#[tokio::test]
async fn a_calendar_feed_name_only_reaches_calendar_variables() {
    // Config comes from screens, so it may name a feed, never an arbitrary environment variable.
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../modules/calendar/module.lua");
    let def = Arc::new(ModuleDef::load(&path).await.unwrap());
    let hub = Hub::new(Persist::memory()).await.unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let services = dashboard::instance::HostServices { sys: dashboard::sysstats::Sampler::start(), persist: Persist::memory() };
    let h = spawn(InstanceSpec { id: "calendar:x".into(), def: Ok(def), config: json!({ "feeds": "../HOOKS_TOKEN" }) }, hub.clone(), reqwest::Client::new(), Limits::default(), services, tx);
    h.request_fetch();
    match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap() {
        InstanceEvent::FetchFinished { outcome, .. } => assert!(matches!(outcome, FetchOutcome::Failed(ref e) if e.contains("feed names")), "{outcome:?}"),
        other => panic!("{other:?}"),
    }
}
