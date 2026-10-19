//! The stats module: numbers pushed in by any number of sources, each replacing only its own.
use dashboard::app::serve_for_test;
use dashboard::config::Config;
use serde_json::{Value, json};
use std::{path::Path, time::Duration};

#[tokio::test]
async fn each_source_replaces_only_its_own_stats() {
    // SAFETY: single test in this binary.
    unsafe { std::env::set_var("HOOKS_TOKEN", "k"); }
    let dir = tempfile::tempdir().unwrap();
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    std::fs::create_dir_all(dir.path().join("modules/stats")).unwrap();
    std::fs::copy(repo.join("modules/stats/module.lua"), dir.path().join("modules/stats/module.lua")).unwrap();
    // A named instance, as a home might declare one per panel ("work"); the bare "stats" comes on its own.
    std::fs::write(dir.path().join("application.lua"), r#"return { instances = { { id = "stats:work" } } }"#).unwrap();
    std::fs::create_dir_all(dir.path().join("static")).unwrap();
    std::fs::write(dir.path().join("static/index.html"), "x").unwrap();
    let root = dir.path().to_path_buf();
    let cfg = Config::from_lookup(|k| match k {
        "MODULES_DIR" => Some(root.join("modules").display().to_string()),
        "APPLICATION_FILE" => Some(root.join("application.lua").display().to_string()),
        "STATIC_DIR" => Some(root.join("static").display().to_string()),
        _ => None,
    }).unwrap();
    let s = serve_for_test(cfg).await.unwrap();
    for _ in 0..50 {
        if s.supervisor.instance("stats:work").await.and_then(|i| i.def()).is_some() && s.supervisor.instance("stats").await.is_some() { break; }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(s.supervisor.instance("stats").await.is_some(), "the bare instance runs without any entry");

    let push = |body: Value| {
        let body = body.to_string();
        let url = format!("http://{}/hooks/stats:work/push", s.addr);
        async move { reqwest::Client::new().post(url).bearer_auth("k").body(body).send().await.unwrap().status().as_u16() }
    };
    let state = || async { s.hub.get("stats:work").await.unwrap().state };
    let tiles = |state: &Value| -> Vec<String> {
        state["items"].as_array().unwrap().iter().map(|i| format!("{}/{}={}", i["source"].as_str().unwrap(), i["label"].as_str().unwrap(), i["number"])).collect()
    };

    assert_eq!(push(json!({ "source": "slack", "stats": { "Unread": { "number": 12 }, "Mentions": { "number": 3, "tone": "warn", "icon": "at-sign" } } })).await, 204);
    assert_eq!(push(json!({ "source": "email", "stats": { "Unread": { "number": 4 }, "Flagged": { "number": 1, "tone": "bad", "order": 0, "sub": "from the CEO" } } })).await, 204);
    // Ordered by `order`, then label, then source; both "Unread"s live side by side.
    assert_eq!(tiles(&state().await), vec!["email/Flagged=1", "slack/Mentions=3", "email/Unread=4", "slack/Unread=12"]);
    let st = state().await;
    assert_eq!(st["items"][0]["tone"], "bad");
    assert_eq!(st["items"][0]["sub"], "from the CEO");
    assert_eq!(st["items"][1]["icon"], "at-sign");
    assert!(st["pushed_at"].as_i64().unwrap() > 0);

    // A source's next push replaces only that source.
    assert_eq!(push(json!({ "source": "slack", "stats": { "Unread": { "number": 2 } } })).await, 204);
    assert_eq!(tiles(&state().await), vec!["email/Flagged=1", "email/Unread=4", "slack/Unread=2"]);
    // An empty set clears a source; no source means "default".
    assert_eq!(push(json!({ "source": "email", "stats": {} })).await, 204);
    assert_eq!(push(json!({ "stats": { "Docs": { "number": 5, "icon": "file-text" } } })).await, 204);
    assert_eq!(tiles(&state().await), vec!["default/Docs=5", "slack/Unread=2"]);

    // Bad shapes are refused and keep the last state; unknown tones are dropped.
    assert_eq!(push(json!({ "source": "slack", "stats": { "Unread": { "count": 4 } } })).await, 500);
    assert_eq!(push(json!({ "source": "slack", "stats": [1, 2] })).await, 500);
    assert_eq!(push(json!([1])).await, 500);
    assert_eq!(tiles(&state().await), vec!["default/Docs=5", "slack/Unread=2"]);
    assert_eq!(push(json!({ "source": "slack", "stats": { "Unread": { "number": 2, "tone": "nonsense" } } })).await, 204);
    assert!(state().await["items"][1].get("tone").is_none());

    // The bare instance is separate.
    assert!(s.hub.get("stats").await.map(|e| e.state.is_null()).unwrap_or(true));

    // Discoverable, token-protected, and the example is itself a valid push.
    let url = format!("http://{}/hooks/stats:work/push", s.addr);
    let doc: Value = reqwest::get(&url).await.unwrap().json().await.unwrap();
    assert_eq!(doc["auth"]["type"], "bearer");
    assert_eq!(reqwest::Client::new().post(&url).body("{}").send().await.unwrap().status().as_u16(), 401);
    assert_eq!(push(doc["example"].clone()).await, 204);
}
