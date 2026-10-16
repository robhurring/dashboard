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

#[tokio::test]
async fn the_say_hook_pushes_a_message_in_from_outside() {
    // SAFETY: the only test in this binary that touches the environment.
    unsafe { std::env::set_var("HOOKS_TOKEN", "k"); }
    let dir = tempfile::tempdir().unwrap();
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    std::fs::create_dir_all(dir.path().join("modules/echo")).unwrap();
    std::fs::copy(repo.join("modules/echo/module.lua"), dir.path().join("modules/echo/module.lua")).unwrap();
    std::fs::write(dir.path().join("application.lua"), r#"return { instances = { { id = "echo" } } }"#).unwrap();
    std::fs::create_dir_all(dir.path().join("static")).unwrap();
    std::fs::write(dir.path().join("static/index.html"), "x").unwrap();
    let root = dir.path().to_path_buf();
    let cfg = dashboard::config::Config::from_lookup(|k| match k {
        "MODULES_DIR" => Some(root.join("modules").display().to_string()),
        "APPLICATION_FILE" => Some(root.join("application.lua").display().to_string()),
        "STATIC_DIR" => Some(root.join("static").display().to_string()),
        _ => None,
    }).unwrap();
    let s = dashboard::app::serve_for_test(cfg).await.unwrap();
    for _ in 0..50 { if s.supervisor.instance("echo").await.and_then(|i| i.def()).is_some() { break; } tokio::time::sleep(Duration::from_millis(20)).await; }

    let say = |body: serde_json::Value, token: &'static str| {
        let url = format!("http://{}/hooks/echo/say", s.addr);
        async move { reqwest::Client::new().post(url).bearer_auth(token).json(&body).send().await.unwrap().status().as_u16() }
    };
    assert_eq!(say(json!({ "text": "from cron" }), "wrong").await, 401);
    assert_eq!(say(json!({ "text": "from cron" }), "k").await, 204);
    assert_eq!(say(json!({ "text": "and again" }), "k").await, 204);
    let state = s.hub.get("echo").await.unwrap().state;
    let texts: Vec<&str> = state["messages"].as_array().unwrap().iter().map(|m| m["text"].as_str().unwrap()).collect();
    assert_eq!(texts, vec!["and again", "from cron"]);
    assert_eq!(say(json!({ "nope": 1 }), "k").await, 500);

    let contract: serde_json::Value = reqwest::get(format!("http://{}/hooks/echo/say", s.addr)).await.unwrap().json().await.unwrap();
    assert_eq!(contract["example"], json!({ "text": "Backup finished" }));
}
