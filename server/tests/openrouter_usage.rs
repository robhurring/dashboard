//! modules/openrouter: balance, spend and key limit, through lib/openrouter.lua against a stub.
use axum::{Json, Router, http::HeaderMap, routing::get};
use dashboard::hub::Hub;
use dashboard::instance::{FetchOutcome, InstanceEvent, InstanceSpec, Limits, spawn};
use dashboard::module_def::ModuleDef;
use dashboard::persist::Persist;
use serde_json::{Value, json};
use std::{path::Path, sync::Arc, time::Duration};

/// Both tests swap the shared libraries and the environment, so they take turns.
static TURN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn stub(limit: Value, reset: &'static str) -> String {
    let app = Router::new()
        .route("/api/v1/credits", get(|headers: HeaderMap| async move {
            assert_eq!(headers["authorization"], "Bearer or-test-key");
            Json(json!({ "data": { "total_credits": 10, "total_usage": 2.5 } }))
        }))
        .route("/api/v1/key", get(move || { let limit = limit.clone(); async move {
            Json(json!({ "data": { "usage": 2.5, "usage_daily": 0.042, "usage_weekly": 0.9, "usage_monthly": 2.5,
                "limit": limit, "limit_remaining": if limit.is_null() { Value::Null } else { json!(47.5) }, "limit_reset": reset } }))
        }}))
        .route("/api/v1/activity", get(|headers: HeaderMap| async move {
            // Only the management key may read activity.
            assert_eq!(headers["authorization"], "Bearer or-management-key");
            Json(json!({ "data": [
                { "date": "2026-10-15", "model": "anthropic/claude-haiku-4.5", "usage": 0.30, "requests": 12 },
                { "date": "2026-10-15", "model": "google/gemini-2.5-flash-image", "usage": 0.20, "requests": 2 },
                { "date": "2026-10-16", "model": "anthropic/claude-haiku-4.5", "usage": 0.10, "requests": 4 },
                { "date": "2026-10-16", "model": "typesafe/jev-1.14-20261014", "usage": 0.05, "requests": 30 },
            ] }))
        }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

async fn fetch(base: &str) -> (Value, Value) {
    let lib = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../lib/openrouter.lua")).unwrap();
    let mut shared = std::collections::BTreeMap::new();
    shared.insert("openrouter".to_string(), Arc::from(lib.replace("https://openrouter.ai", base)));
    dashboard::lua_vm::set_shared_libs(shared);
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../modules/openrouter/module.lua");
    let def = ModuleDef::load(&path).await.map(Arc::new);
    assert!(def.is_ok(), "{:?}", def.as_ref().err());
    let hub = Hub::new(Persist::memory()).await.unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let services = dashboard::instance::HostServices { sys: dashboard::sysstats::Sampler::start(), persist: Persist::memory() };
    let h = spawn(InstanceSpec { id: "openrouter".into(), def, config: json!({}) }, hub.clone(), reqwest::Client::new(), Limits::default(), services, tx);
    h.request_fetch();
    match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap() {
        InstanceEvent::FetchFinished { outcome, .. } => assert_eq!(outcome, FetchOutcome::Updated),
        other => panic!("{other:?}"),
    }
    let stored = hub.get("openrouter").await.unwrap();
    (stored.state, stored.view.unwrap())
}

fn texts(v: &Value, out: &mut Vec<String>) {
    for key in ["label", "value", "sub", "text", "title", "meta", "badge"] {
        if let Some(s) = v["props"][key].as_str() { out.push(s.to_string()); }
    }
    if let Some(n) = v["props"]["value"].as_f64() { out.push(format!("{n}")); }
    for c in v["children"].as_array().into_iter().flatten() { texts(c, out); }
}

#[tokio::test]
async fn shows_balance_spend_and_the_keys_limit() {
    let _turn = TURN.lock().await;
    // SAFETY: the only test in this binary that sets the environment.
    unsafe { std::env::set_var("OPENROUTER_API_KEY", "or-test-key"); }
    let base = stub(json!(50), "weekly").await;
    let (state, view) = fetch(&base).await;
    assert_eq!(state["credits"], 10.0);
    assert_eq!(state["spent"], 2.5);
    assert_eq!(state["left"], 7.5);
    let mut t = Vec::new();
    texts(&view, &mut t);
    let all = t.join(" | ");
    assert!(all.contains("$7.50 left of $10.00"), "balance: {all}");
    assert!(view.to_string().contains("\"type\":\"progress\""), "balance bar: {view}");
    assert!(all.contains("Today") && all.contains("$0.04"), "{all}");
    assert!(all.contains("This week") && all.contains("$0.90"), "{all}");
    assert!(all.contains("This month") && all.contains("$2.50"), "{all}");
    assert!(all.contains("$47.50 of $50.00 left this week"), "key limit: {all}");

    let base = stub(json!(50), "daily").await;
    let (_, view) = fetch(&base).await;
    let mut t = Vec::new();
    texts(&view, &mut t);
    assert!(t.join(" | ").contains("$47.50 of $50.00 left today"), "{t:?}");

    // A key without a limit shows no limit line.
    let base = stub(Value::Null, "weekly").await;
    let (_, view) = fetch(&base).await;
    let mut t = Vec::new();
    texts(&view, &mut t);
    assert!(!t.join(" | ").contains("left this"), "{t:?}");
}

#[tokio::test]
async fn with_a_management_key_it_lists_spend_by_model() {
    let _turn = TURN.lock().await;
    unsafe { std::env::set_var("OPENROUTER_API_KEY", "or-test-key"); }
    let base = stub(json!(50), "weekly").await;
    let (state, _) = fetch(&base).await;
    assert!(state.get("models").is_none() || state["models"].is_null(), "no management key, no breakdown: {state}");

    unsafe { std::env::set_var("OPENROUTER_MANAGEMENT_KEY", "or-management-key"); }
    let (state, view) = fetch(&base).await;
    unsafe { std::env::remove_var("OPENROUTER_MANAGEMENT_KEY"); }
    let models: Vec<&str> = state["models"].as_array().unwrap().iter().map(|m| m["model"].as_str().unwrap()).collect();
    assert_eq!(models, vec!["anthropic/claude-haiku-4.5", "google/gemini-2.5-flash-image", "typesafe/jev-1.14-20261014"]);
    assert_eq!(state["models"][0]["usage"], 0.4);
    assert_eq!(state["models"][0]["requests"], 16);
    let mut t = Vec::new();
    texts(&view, &mut t);
    assert!(t.join(" | ").contains("claude-haiku-4.5"), "{t:?}");
}
