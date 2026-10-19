//! Inbound webhooks: POST /hooks/<instance>/<hook>, verified before any Lua runs.
use dashboard::app::{TestServer, serve_for_test};
use dashboard::config::Config;
use hmac::{Hmac, Mac};
use serde_json::{Value, json};
use sha2::Sha256;
use std::time::Duration;

const PUSHER: &str = r#"
return {
  name = "pusher",
  hooks = {
    push = {
      description = "Counts pushes",
      schema = { type = "object", properties = { mentions = { type = "integer" } } },
      example = { mentions = 2 },
      auth = { hmac = "sha256", header = "X-Signature", secret = "PUSHER_SECRET", encoding = "hex" },
      handle = function(ctx, req)
        local n = ((ctx.state and ctx.state.n) or 0) + 1
        return { n = n, last = req.body, agent = req.headers["user-agent"] }
      end,
    },
    open = { auth = { public = true }, handle = function(ctx, req) return { raw = req.body } end },
    tok = { auth = { token = "PUSHER_TOKEN" }, handle = function(ctx, req) return { tok = true } end },
    devtok = { auth = { token = "PUSHER_TOKEN_UNSET" }, handle = function(ctx, req) return { dev = true } end },
    boom = { auth = { public = true }, handle = function(ctx, req) error("handler blew up") end },
  },
  view = function(state) return ui.stat { value = tostring(state.n or 0) } end,
}"#;

const NO_AUTH: &str = r#"return { name = "noauth", hooks = { x = { handle = function() end } }, view = function() return ui.stat {} end }"#;

async fn server() -> (tempfile::TempDir, TestServer) {
    let dir = tempfile::tempdir().unwrap();
    for (name, src) in [("pusher", PUSHER), ("noauth", NO_AUTH)] {
        std::fs::create_dir_all(dir.path().join("modules").join(name)).unwrap();
        std::fs::write(dir.path().join("modules").join(name).join("module.lua"), src).unwrap();
    }
    std::fs::write(dir.path().join("application.lua"), r#"return { instances = { { id = "pusher" }, { id = "noauth" } } }"#).unwrap();
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
    // Application instances start asynchronously.
    for _ in 0..50 {
        if s.supervisor.instance("pusher").await.is_some() { break; }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    (dir, s)
}

fn sign(secret: &str, body: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(body);
    hex::encode(mac.finalize().into_bytes())
}

async fn post(s: &TestServer, path: &str, body: &str, sig: Option<String>) -> (u16, String) {
    let mut req = reqwest::Client::new().post(format!("http://{}{path}", s.addr)).header("user-agent", "test-agent").body(body.to_string());
    if let Some(sig) = sig { req = req.header("X-Signature", sig); }
    let res = req.send().await.unwrap();
    let status = res.status().as_u16();
    (status, res.text().await.unwrap())
}

// One test, so the environment variable cannot race another test in this binary.
#[tokio::test]
async fn hooks_verify_then_run_the_handler_and_publish_state() {
    // SAFETY: single test in this binary.
    unsafe {
        std::env::set_var("PUSHER_SECRET", "s3cret");
        std::env::set_var("PUSHER_TOKEN", "6f1c2a9e-tok");
    }
    let (_d, s) = server().await;
    let body = r#"{"mentions":2}"#;

    // Signed correctly: 204, handler ran, state published with the decoded body and allow-listed headers.
    let (status, _) = post(&s, "/hooks/pusher/push", body, Some(sign("s3cret", body.as_bytes()))).await;
    assert_eq!(status, 204);
    let stored = s.hub.get("pusher").await.unwrap();
    assert_eq!(stored.state["n"], 1);
    assert_eq!(stored.state["last"], json!({ "mentions": 2 }));
    assert_eq!(stored.state["agent"], "test-agent");
    assert_eq!(stored.view.unwrap()["props"]["value"], "1");

    // Wrong secret, tampered body, missing header: 401, and the handler never ran.
    assert_eq!(post(&s, "/hooks/pusher/push", body, Some(sign("nope", body.as_bytes()))).await.0, 401);
    assert_eq!(post(&s, "/hooks/pusher/push", r#"{"mentions":9}"#, Some(sign("s3cret", body.as_bytes()))).await.0, 401);
    assert_eq!(post(&s, "/hooks/pusher/push", body, None).await.0, 401);
    assert_eq!(post(&s, "/hooks/pusher/push", body, Some("zz-not-hex".into())).await.0, 401);
    assert_eq!(s.hub.get("pusher").await.unwrap().state["n"], 1);

    // A "sha256=" prefix (GitHub style) is accepted.
    assert_eq!(post(&s, "/hooks/pusher/push", body, Some(format!("sha256={}", sign("s3cret", body.as_bytes())))).await.0, 204);
    assert_eq!(s.hub.get("pusher").await.unwrap().state["n"], 2);

    // Public hooks need no signature; non-JSON bodies arrive as strings.
    assert_eq!(post(&s, "/hooks/pusher/open", "plain text", None).await.0, 204);
    assert_eq!(s.hub.get("pusher").await.unwrap().state["raw"], Value::String("plain text".into()));

    // Token auth: "Authorization: Bearer <token>" or "X-Hook-Token: <token>"; anything else is 401.
    let with = |name: &'static str, value: &'static str| {
        let url = format!("http://{}/hooks/pusher/tok", s.addr);
        async move { reqwest::Client::new().post(url).header(name, value).body("{}").send().await.unwrap().status().as_u16() }
    };
    assert_eq!(with("Authorization", "Bearer 6f1c2a9e-tok").await, 204);
    assert_eq!(with("authorization", "bearer 6f1c2a9e-tok").await, 204);
    assert_eq!(with("X-Hook-Token", "6f1c2a9e-tok").await, 204);
    assert_eq!(with("Authorization", "Bearer wrong").await, 401);
    assert_eq!(with("Authorization", "6f1c2a9e-tok").await, 401); // no Bearer scheme
    assert_eq!(with("X-Other", "6f1c2a9e-tok").await, 401);
    assert_eq!(s.hub.get("pusher").await.unwrap().state["tok"], true);

    // When the token's variable is not set (local development), the hook is open, and says so.
    assert_eq!(post(&s, "/hooks/pusher/devtok", "{}", None).await.0, 204);
    assert_eq!(s.hub.get("pusher").await.unwrap().state["dev"], true);
    let dev: Value = reqwest::get(format!("http://{}/hooks/pusher/devtok", s.addr)).await.unwrap().json().await.unwrap();
    assert_eq!(dev["auth"]["type"], "none");
    assert!(dev["auth"]["note"].as_str().unwrap().contains("PUSHER_TOKEN_UNSET"));

    // Unknown instance or hook: 404. A hook without auth never loads, so it is not served.
    assert_eq!(post(&s, "/hooks/ghost/push", body, None).await.0, 404);
    assert_eq!(post(&s, "/hooks/pusher/nope", body, None).await.0, 404);
    assert_eq!(post(&s, "/hooks/noauth/x", body, None).await.0, 404);

    // Handler errors are a 500 with no detail leaked; the last good state stays.
    let (status, text) = post(&s, "/hooks/pusher/boom", "{}", None).await;
    assert_eq!(status, 500);
    assert!(!text.contains("blew up"), "{text}");

    // Bodies over 64 KiB are refused before anything else.
    let big = "x".repeat(70 * 1024);
    assert_eq!(post(&s, "/hooks/pusher/open", &big, None).await.0, 413);

    // Discovery: GET /hooks lists hooks; GET /hooks/<instance> and /<hook> describe the contract, never the secret.
    let get = |path: String| async move { reqwest::get(format!("http://{}{path}", s.addr)).await.unwrap() };
    let list: Value = get("/hooks".into()).await.json().await.unwrap();
    let paths: Vec<&str> = list["hooks"].as_array().unwrap().iter().map(|h| h["path"].as_str().unwrap()).collect();
    assert_eq!(paths, vec!["/hooks/pusher/boom", "/hooks/pusher/devtok", "/hooks/pusher/open", "/hooks/pusher/push", "/hooks/pusher/tok"]);
    let tok: Value = get("/hooks/pusher/tok".into()).await.json().await.unwrap();
    assert_eq!(tok["auth"], json!({ "type": "bearer", "header": "Authorization", "format": "Bearer <token>", "alternative": "X-Hook-Token: <token>" }));
    let oa: Value = get("/hooks/openapi.json".into()).await.json().await.unwrap();
    assert_eq!(oa["paths"]["/hooks/pusher/tok"]["post"]["security"], json!([{ "hookToken": [] }]));
    assert_eq!(oa["components"]["securitySchemes"]["hookToken"], json!({ "type": "http", "scheme": "bearer" }));
    assert!(!tok.to_string().contains("6f1c2a9e") && !oa.to_string().contains("6f1c2a9e"));
    let inst: Value = get("/hooks/pusher".into()).await.json().await.unwrap();
    let push = inst["hooks"].as_array().unwrap().iter().find(|h| h["hook"] == "push").unwrap().clone();
    assert_eq!(push["auth"], json!({ "type": "hmac-sha256", "header": "X-Signature", "encoding": "hex", "signs": "the raw request body" }));
    assert_eq!(push["description"], "Counts pushes");
    assert_eq!(push["schema"]["type"], "object");
    assert_eq!(push["example"], json!({ "mentions": 2 }));
    assert!(!inst.to_string().contains("s3cret") && !inst.to_string().contains("PUSHER_SECRET"), "{inst}");
    let one: Value = get("/hooks/pusher/push".into()).await.json().await.unwrap();
    assert_eq!(one["path"], "/hooks/pusher/push");
    assert_eq!(get("/hooks/ghost".into()).await.status().as_u16(), 404);

    // The same contracts as one OpenAPI 3.1 document.
    let doc: Value = get("/hooks/openapi.json".into()).await.json().await.unwrap();
    assert_eq!(doc["openapi"], "3.1.0");
    let op = &doc["paths"]["/hooks/pusher/push"]["post"];
    assert_eq!(op["operationId"], "pusher_push");
    assert_eq!(op["summary"], "Counts pushes");
    assert_eq!(op["requestBody"]["content"]["application/json"]["schema"]["type"], "object");
    assert_eq!(op["requestBody"]["content"]["application/json"]["example"], json!({ "mentions": 2 }));
    assert_eq!(op["parameters"][0], json!({ "name": "X-Signature", "in": "header", "required": true, "description": "Hex HMAC-SHA256 of the raw request body with the hook's secret; a `sha256=` prefix is accepted.", "schema": { "type": "string" } }));
    for code in ["204", "401", "404", "413", "429", "500"] { assert!(op["responses"][code].is_object(), "{code}"); }
    // `servers` says where the hooks are reached: the Host it was asked on, or what a relay in front forwarded.
    assert_eq!(doc["servers"], json!([{ "url": format!("http://{}", s.addr) }]));
    let relayed: Value = reqwest::Client::new()
        .get(format!("http://{}/hooks/openapi.json", s.addr))
        .header("X-Forwarded-Host", "d84rv7qbgol14.cloudfront.net")
        .header("X-Forwarded-Proto", "https")
        .header("X-Forwarded-Prefix", "/dashboard")
        .send().await.unwrap().json().await.unwrap();
    assert_eq!(relayed["servers"], json!([{ "url": "https://d84rv7qbgol14.cloudfront.net/dashboard" }]));
    // Forwarded (RFC 7239) wins: a proxy in front of the server (nginx) may overwrite X-Forwarded-Proto.
    let standard: Value = reqwest::Client::new()
        .get(format!("http://{}/hooks/openapi.json", s.addr))
        .header("Forwarded", r#"host="d84rv7qbgol14.cloudfront.net";proto=https"#)
        .header("X-Forwarded-Host", "d84rv7qbgol14.cloudfront.net")
        .header("X-Forwarded-Proto", "http")
        .header("X-Forwarded-Prefix", "/dashboard")
        .send().await.unwrap().json().await.unwrap();
    assert_eq!(standard["servers"], json!([{ "url": "https://d84rv7qbgol14.cloudfront.net/dashboard" }]));
    let odd: Value = reqwest::Client::new()
        .get(format!("http://{}/hooks/openapi.json", s.addr))
        .header("X-Forwarded-Proto", "https")
        .header("X-Forwarded-Prefix", "javascript:alert(1)")
        .send().await.unwrap().json().await.unwrap();
    assert_eq!(odd["servers"], json!([{ "url": format!("https://{}", s.addr) }]), "a prefix that isn't a plain path is ignored");
    let open = &doc["paths"]["/hooks/pusher/open"]["post"];
    assert!(open.get("parameters").is_none(), "public hooks take no signature header");
    assert!(open["responses"].get("401").is_none());
    assert!(!doc.to_string().contains("s3cret") && !doc.to_string().contains("PUSHER_SECRET"));

    // 60 calls a minute per instance, then 429.
    let mut limited = false;
    for _ in 0..70 {
        if post(&s, "/hooks/pusher/open", "{}", None).await.0 == 429 { limited = true; break; }
    }
    assert!(limited, "expected a 429 within 70 calls");
}
