use dashboard::app::serve_for_test;
use dashboard::config::Config;
use futures::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::time::Duration;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async, tungstenite::Message};

type Ws = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

async fn wait_for(ws: &mut Ws, pred: impl Fn(&Value) -> bool) -> Value {
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(10), ws.next()).await.expect("timed out").unwrap().unwrap();
        if let Message::Text(t) = msg {
            let v: Value = serde_json::from_str(t.as_str()).unwrap();
            if pred(&v) {
                return v;
            }
        }
    }
}

const V1: &str = r#"return { name = "counter", every = "1m",
  fetch = function(ctx) return { n = 1 } end,
  view = function(s) return ui.stat { value = "v1" } end }"#;

#[tokio::test]
async fn saving_files_updates_connected_clients() {
    let dir = tempfile::tempdir().unwrap();
    let module = dir.path().join("modules/counter/module.lua");
    std::fs::create_dir_all(module.parent().unwrap()).unwrap();
    std::fs::write(&module, V1).unwrap();
    let dash = dir.path().join("application.lua");
    std::fs::write(&dash, r#"return { instances = { { id = "counter" } } }"#).unwrap();
    std::fs::create_dir_all(dir.path().join("static")).unwrap();
    std::fs::write(dir.path().join("static/index.html"), "").unwrap();
    let root = dir.path().to_path_buf();
    let cfg = Config::from_lookup(|k| match k {
        "MODULES_DIR" => Some(root.join("modules").display().to_string()),
        "APPLICATION_FILE" => Some(root.join("application.lua").display().to_string()),
        "STATIC_DIR" => Some(root.join("static").display().to_string()),
        "DASHBOARD_WATCH" => Some("1".into()),
        _ => None,
    })
    .unwrap();
    let s = serve_for_test(cfg).await.unwrap();

    let (mut ws, _) = connect_async(format!("ws://{}/ws", s.addr)).await.unwrap();
    ws.send(Message::text(json!({ "type": "hello", "protocol": 1, "screen": "t" }).to_string())).await.unwrap();
    ws.send(Message::text(json!({ "type": "watch", "slots": [{ "id": "counter", "module": "counter" }] }).to_string())).await.unwrap();

    wait_for(&mut ws, |v| v["type"] == "snapshot" && v["view"]["props"]["value"] == "v1").await;

    // Edit the view: the new tree arrives without a fetch.
    std::fs::write(&module, V1.replace("\"v1\"", "\"v2\"")).unwrap();
    wait_for(&mut ws, |v| v["type"] == "snapshot" && v["view"]["props"]["value"] == "v2").await;

    // Break the module: the old version keeps running and the error is reported.
    std::fs::write(&module, "return {").unwrap();
    wait_for(&mut ws, |v| v["type"] == "status" && v["status"]["load_error"].is_string()).await;

    // Fix it: the error clears.
    std::fs::write(&module, V1.replace("\"v1\"", "\"v3\"")).unwrap();
    wait_for(&mut ws, |v| v["type"] == "snapshot" && v["view"]["props"]["value"] == "v3").await;

    // Add an instance in application.lua: clients get a new welcome listing it.
    std::fs::write(&dash, r#"return { instances = { { id = "counter" }, { id = "counter:two", module = "counter" } } }"#).unwrap();
    wait_for(&mut ws, |v| v["type"] == "welcome" && v["instances"].as_array().unwrap().len() == 2).await;
}
