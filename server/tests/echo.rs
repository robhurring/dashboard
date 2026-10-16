//! The example `echo` module: state from fetch, replaced by what each command returns.
use dashboard::hub::Hub;
use dashboard::instance::{FetchOutcome, InstanceEvent, InstanceSpec, Limits, spawn};
use dashboard::module_def::ModuleDef;
use dashboard::persist::Persist;
use serde_json::json;
use std::{path::Path, sync::Arc, time::Duration};

#[tokio::test]
async fn echo_and_ping_commands_replace_the_state() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../modules/echo/module.lua");
    let def = ModuleDef::load(&path).await.map(Arc::new);
    assert!(def.is_ok(), "{:?}", def.as_ref().err());
    assert_eq!(def.as_ref().unwrap().component.as_deref(), Some("Echo"));
    let hub = Hub::new(Persist::memory()).await.unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let services = dashboard::instance::HostServices { sys: dashboard::sysstats::Sampler::start(), persist: Persist::memory() };
    let h = spawn(InstanceSpec { id: "echo".into(), def, config: json!({ "keep": 2 }) }, hub.clone(), reqwest::Client::new(), Limits::default(), services, tx);
    h.request_fetch();
    match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap() {
        InstanceEvent::FetchFinished { outcome, .. } => assert_eq!(outcome, FetchOutcome::Updated),
        other => panic!("{other:?}"),
    }
    let state = || async { hub.get("echo").await.unwrap().state };
    assert_eq!(state().await, json!({ "messages": [], "pings": 0 }));

    h.command("ping".into(), json!({})).await.unwrap();
    assert_eq!(state().await["pings"], 1);

    for text in ["one", "  two  ", "three"] {
        h.command("echo".into(), json!({ "text": text })).await.unwrap();
    }
    let s = state().await;
    let texts: Vec<&str> = s["messages"].as_array().unwrap().iter().map(|m| m["text"].as_str().unwrap()).collect();
    assert_eq!(texts, vec!["three", "two"], "newest first, trimmed, at most `keep`");
    assert_eq!(s["pings"], 1, "echo keeps the ping count");

    let err = h.command("echo".into(), json!({ "text": "   " })).await.unwrap_err();
    assert!(err.contains("say something"), "{err}");
}
