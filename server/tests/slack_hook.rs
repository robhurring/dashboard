//! The real slack module, pushed to over HTTP.
use dashboard::app::serve_for_test;
use dashboard::config::Config;
use serde_json::{Value, json};
use std::{path::Path, time::Duration};

#[tokio::test]
async fn slack_push_replaces_the_stats_and_describes_itself() {
    // SAFETY: single test in this binary.
    unsafe { std::env::set_var("HOOKS_TOKEN", "k"); }
    let dir = tempfile::tempdir().unwrap();
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    std::fs::create_dir_all(dir.path().join("modules/slack")).unwrap();
    std::fs::copy(repo.join("modules/slack/module.lua"), dir.path().join("modules/slack/module.lua")).unwrap();
    // No application.lua entry: a push-only module brings its own always-on instance.
    std::fs::write(dir.path().join("application.lua"), r#"return { instances = {} }"#).unwrap();
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
    for _ in 0..50 { if s.supervisor.instance("slack").await.and_then(|i| i.def()).is_some() { break; } tokio::time::sleep(Duration::from_millis(20)).await; }
    assert!(s.supervisor.instance("slack").await.unwrap().def().unwrap().push_only());

    let push = |body: Value| {
        let body = body.to_string();
        let url = format!("http://{}/hooks/slack/push", s.addr);
        async move { reqwest::Client::new().post(url).bearer_auth("k").body(body).send().await.unwrap().status().as_u16() }
    };

    // A screen with the Slack panel on a hidden page still gets pushes live.
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{}/ws", s.addr)).await.unwrap();
    use futures::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;
    ws.send(Message::text(json!({ "type": "hello", "protocol": 1, "screen": "t" }).to_string())).await.unwrap();
    ws.send(Message::text(json!({ "type": "watch", "slots": [{ "id": "slack", "module": "slack", "visible": false }] }).to_string())).await.unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(push(json!({ "Unread": { "number": 1 } })).await, 204);
    let pushed = tokio::time::timeout(Duration::from_secs(3), async {
        while let Some(Ok(m)) = ws.next().await {
            let Ok(text) = m.into_text() else { continue };
            let v: Value = serde_json::from_str(&text).unwrap();
            if v["type"] == "snapshot" && v["instance"] == "slack" && v["state"]["items"][0]["number"] == 1 { return true; }
        }
        false
    }).await.unwrap_or(false);
    assert!(pushed, "a hidden slack panel must still receive the push");

    assert_eq!(push(json!({ "Unread": { "number": 12 }, "Urgent": { "number": 1, "tone": "bad", "icon": "bell", "order": 0, "sub": "#incident" }, "Mentions": { "number": 3, "tone": "nonsense" } })).await, 204);
    let state = s.hub.get("slack").await.unwrap().state;
    let labels: Vec<&str> = state["items"].as_array().unwrap().iter().map(|i| i["label"].as_str().unwrap()).collect();
    assert_eq!(labels, vec!["Urgent", "Mentions", "Unread"]); // order first, then label
    assert_eq!(state["items"][0]["tone"], "bad");
    assert!(state["items"][1].get("tone").is_none(), "unknown tones are dropped");
    assert!(state["pushed_at"].as_i64().unwrap() > 0);
    // A push is a successful update: the instance is healthy and records when it was pushed.
    let status = s.hub.get("slack").await.unwrap().status;
    assert!(status.ok && status.error.is_none() && status.pushed_at.is_some(), "{status:?}");

    // The next push replaces everything; bad shapes are refused and keep the last state.
    assert_eq!(push(json!({ "Unread": { "number": 0 } })).await, 204);
    assert_eq!(s.hub.get("slack").await.unwrap().state["items"].as_array().unwrap().len(), 1);
    assert_eq!(push(json!({ "Unread": { "count": 4 } })).await, 500);
    assert_eq!(push(json!([1, 2])).await, 500);
    assert_eq!(s.hub.get("slack").await.unwrap().state["items"][0]["number"], 0);

    // The contract is discoverable, with an example that is itself a valid push.
    let doc: Value = reqwest::get(format!("http://{}/hooks/slack/push", s.addr)).await.unwrap().json().await.unwrap();
    assert_eq!(doc["auth"]["type"], "bearer");
    // Without the token: refused.
    let url = format!("http://{}/hooks/slack/push", s.addr);
    assert_eq!(reqwest::Client::new().post(url).body("{}").send().await.unwrap().status().as_u16(), 401);
    assert_eq!(doc["schema"]["additionalProperties"]["required"], json!(["number"]));
    assert_eq!(push(doc["example"].clone()).await, 204);
}
