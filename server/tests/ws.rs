use dashboard::app::{TestServer, serve_for_test};
use dashboard::config::Config;
use futures::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::time::Duration;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async, tungstenite::Message};

type Ws = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

const COUNTER: &str = r#"return { name = "counter", every = "1m",
  fetch = function(ctx) return { n = ((ctx.state and ctx.state.n) or 0) + 1 } end,
  view = function(s) return ui.stat { value = tostring(s.n) } end,
  commands = { set = function(ctx, a) return { n = a.n } end } }"#;

async fn server(dashboard: &str) -> (tempfile::TempDir, TestServer) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("modules/counter")).unwrap();
    std::fs::write(dir.path().join("modules/counter/module.lua"), COUNTER).unwrap();
    std::fs::write(dir.path().join("application.lua"), dashboard).unwrap();
    std::fs::create_dir_all(dir.path().join("static")).unwrap();
    std::fs::write(dir.path().join("static/index.html"), "<p>app</p>").unwrap();
    let root = dir.path().to_path_buf();
    let cfg = Config::from_lookup(|k| match k {
        "MODULES_DIR" => Some(root.join("modules").display().to_string()),
        "APPLICATION_FILE" => Some(root.join("application.lua").display().to_string()),
        "STATIC_DIR" => Some(root.join("static").display().to_string()),
        _ => None,
    })
    .unwrap();
    let s = serve_for_test(cfg).await.unwrap();
    (dir, s)
}

const ONE: &str = r#"return { instances = { { id = "counter" } } }"#;

async fn connect(s: &TestServer) -> Ws {
    connect_async(format!("ws://{}/ws", s.addr)).await.unwrap().0
}
async fn send(ws: &mut Ws, v: Value) {
    ws.send(Message::text(v.to_string())).await.unwrap();
}
/// Next non-ping message, or None if nothing arrives within `wait`.
async fn next(ws: &mut Ws, wait: Duration) -> Option<Value> {
    loop {
        match tokio::time::timeout(wait, ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => {
                let v: Value = serde_json::from_str(t.as_str()).unwrap();
                if v["type"] != "ping" { return Some(v); }
            }
            Ok(Some(Ok(_))) => {}
            _ => return None,
        }
    }
}
async fn until(ws: &mut Ws, kind: &str) -> Value {
    loop {
        let v = next(ws, Duration::from_secs(5)).await.unwrap_or_else(|| panic!("no {kind} message"));
        if v["type"] == kind { return v; }
    }
}

#[tokio::test]
async fn hello_welcome_watch_snapshot() {
    let (_d, s) = server(ONE).await;
    let mut ws = connect(&s).await;
    send(&mut ws, json!({ "type": "hello", "protocol": 1, "screen": "test" })).await;
    let welcome = until(&mut ws, "welcome").await;
    assert_eq!(welcome["instances"], json!([{ "id": "counter", "module": "counter", "kind": "view", "component": null, "title": null, "icon": null, "push_only": false }]));
    send(&mut ws, json!({ "type": "watch", "slots": [{ "id": "counter", "module": "counter" }] })).await;
    let snap = until(&mut ws, "snapshot").await;
    assert_eq!(snap["instance"], "counter");
    assert_eq!(snap["rev"], 1);
    assert_eq!(snap["view"]["props"]["value"], "1");
    assert_eq!(snap["state"]["n"], 1, "state travels with the view");
}

#[tokio::test]
async fn reconnect_with_current_revs_gets_no_snapshots() {
    let (_d, s) = server(ONE).await;
    let mut a = connect(&s).await;
    send(&mut a, json!({ "type": "hello", "protocol": 1, "screen": "a" })).await;
    until(&mut a, "welcome").await;
    send(&mut a, json!({ "type": "watch", "slots": [{ "id": "counter", "module": "counter" }] })).await;
    let rev = until(&mut a, "snapshot").await["rev"].as_u64().unwrap();
    drop(a);

    let mut b = connect(&s).await;
    send(&mut b, json!({ "type": "hello", "protocol": 1, "screen": "b", "have": { "counter": rev } })).await;
    until(&mut b, "welcome").await;
    send(&mut b, json!({ "type": "watch", "slots": [{ "id": "counter", "module": "counter" }] })).await;
    assert!(next(&mut b, Duration::from_millis(500)).await.is_none(), "nothing to send: client is current");
    assert_eq!(s.hub.get("counter").await.unwrap().rev, rev, "no refetch on reconnect");
}

#[tokio::test]
async fn commands_ack_or_fail_and_reach_every_client() {
    let (_d, s) = server(ONE).await;
    let mut a = connect(&s).await;
    let mut b = connect(&s).await;
    for ws in [&mut a, &mut b] {
        send(ws, json!({ "type": "hello", "protocol": 1, "screen": "t" })).await;
        until(ws, "welcome").await;
        send(ws, json!({ "type": "watch", "slots": [{ "id": "counter", "module": "counter" }] })).await;
        until(ws, "snapshot").await;
    }
    send(&mut a, json!({ "type": "command", "id": "c-1", "instance": "counter", "action": "set", "args": { "n": 42 } })).await;
    let mut got_ack = false;
    let mut got_snap = false;
    while !(got_ack && got_snap) {
        let v = next(&mut a, Duration::from_secs(5)).await.unwrap();
        got_ack |= v["type"] == "ack" && v["id"] == "c-1";
        got_snap |= v["type"] == "snapshot" && v["view"]["props"]["value"] == "42";
    }
    assert_eq!(until(&mut b, "snapshot").await["view"]["props"]["value"], "42");

    send(&mut a, json!({ "type": "command", "id": "c-2", "instance": "counter", "action": "nope" })).await;
    let fail = until(&mut a, "fail").await;
    assert_eq!(fail["id"], "c-2");
    assert!(fail["error"].as_str().unwrap().contains("unknown command"));

    send(&mut a, json!({ "type": "command", "id": "c-3", "instance": "ghost", "action": "x" })).await;
    assert!(until(&mut a, "fail").await["error"].as_str().unwrap().contains("unknown instance"));
}

#[tokio::test]
async fn wrong_protocol_is_refused() {
    let (_d, s) = server(ONE).await;
    let mut ws = connect(&s).await;
    send(&mut ws, json!({ "type": "hello", "protocol": 99, "screen": "old" })).await;
    let fail = until(&mut ws, "fail").await;
    assert!(fail["error"].as_str().unwrap().contains("protocol 99"));
    assert!(next(&mut ws, Duration::from_secs(2)).await.is_none(), "connection closes");
}

#[tokio::test]
async fn messages_before_hello_close_the_connection() {
    let (_d, s) = server(ONE).await;
    let mut ws = connect(&s).await;
    send(&mut ws, json!({ "type": "watch", "slots": [{ "id": "counter", "module": "counter" }] })).await;
    assert!(next(&mut ws, Duration::from_secs(2)).await.is_none());
}

#[tokio::test]
async fn broken_instances_arrive_with_their_error() {
    let (_d, s) = server(r#"return { instances = { { id = "ghost" } } }"#).await;
    let mut ws = connect(&s).await;
    send(&mut ws, json!({ "type": "hello", "protocol": 1, "screen": "t" })).await;
    until(&mut ws, "welcome").await;
    let status = until(&mut ws, "status").await;
    assert_eq!(status["instance"], "ghost");
    assert!(status["status"]["load_error"].as_str().unwrap().contains("no module named"));
}


#[tokio::test]
async fn declared_slots_create_instances_and_errors_reach_only_their_session() {
    let (_d, s) = server(r#"return { instances = {} }"#).await;
    let mut a = connect(&s).await;
    send(&mut a, json!({ "type": "hello", "protocol": 1, "screen": "wall" })).await;
    until(&mut a, "welcome").await;
    send(&mut a, json!({ "type": "watch", "slots": [ { "id": "counter", "module": "counter", "props": { "title": "x" } } ] })).await;
    let snap = until(&mut a, "snapshot").await;
    assert_eq!(snap["instance"], "counter");

    let mut b = connect(&s).await;
    send(&mut b, json!({ "type": "hello", "protocol": 1, "screen": "phone" })).await;
    until(&mut b, "welcome").await;
    send(&mut b, json!({ "type": "watch", "slots": [ { "id": "ghost", "module": "ghost" } ] })).await;
    let st = until(&mut b, "status").await;
    assert_eq!(st["instance"], "ghost");
    assert!(st["status"]["load_error"].as_str().unwrap().contains("no module named"), "{st}");
}
