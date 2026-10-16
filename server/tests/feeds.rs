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
}
