//! lib/openrouter.lua, used from a module, against a stub of OpenRouter's chat completions API.
use axum::{Json, Router, http::{HeaderMap, StatusCode}, routing::post};
use dashboard::hub::Hub;
use dashboard::instance::{FetchOutcome, InstanceEvent, InstanceSpec, Limits, spawn};
use dashboard::module_def::ModuleDef;
use dashboard::persist::Persist;
use serde_json::{Value, json};
use std::{path::Path, sync::{Arc, Mutex}, time::Duration};

async fn stub(seen: Arc<Mutex<Vec<Value>>>) -> String {
    let app = Router::new().route("/api/v1/chat/completions", post(move |headers: HeaderMap, Json(body): Json<Value>| {
        let seen = seen.clone();
        async move {
            assert_eq!(headers["authorization"], "Bearer or-test-key");
            // Identifies the app to OpenRouter: defaults unless the environment says otherwise.
            let title = headers["x-openrouter-title"].to_str().unwrap();
            let referer = headers["http-referer"].to_str().unwrap();
            assert!((title, referer) == ("dashboard", "https://github.com/robhurring/dashboard") || (title, referer) == ("Kitchen screen", "https://kitchen.example.com"), "{title} {referer}");
            seen.lock().unwrap().push(body.clone());
            if body["modalities"] == json!(["image", "text"]) {
                return (StatusCode::OK, Json(json!({ "choices": [{ "message": { "role": "assistant", "content": "Here you go", "images": [{ "type": "image_url", "image_url": { "url": "data:image/png;base64,iVBORw0KGgo=" } }] } }] })));
            }
            match body["model"].as_str() {
                Some("broken/model") => (StatusCode::BAD_REQUEST, Json(json!({ "error": { "message": "no such model" } }))),
                Some("empty/model") => (StatusCode::OK, Json(json!({ "error": { "message": "provider overloaded" } }))),
                _ => (StatusCode::OK, Json(json!({ "choices": [{ "message": { "role": "assistant", "content": "  Three meetings, then gym.  " } }], "usage": { "total_tokens": 42 } }))),
            }
        }
    }))
    .route("/api/alpha/decisions", post(|headers: HeaderMap, Json(body): Json<Value>| async move {
        assert_eq!(headers["authorization"], "Bearer or-test-key");
        assert_eq!(body["model"], "jev-latest");
        assert_eq!(headers["x-openrouter-title"], "dashboard");
        assert_eq!(headers["http-referer"], "https://github.com/robhurring/dashboard");
        assert_eq!(body["state"]["subject"], "Invoice overdue");
        assert_eq!(body["questions"]["urgent"]["type"], "noul");
        Json(json!({ "answers": { "urgent": { "type": "noul", "noul": 0.93 }, "team": { "type": "choice", "choice": "billing", "confidence": 0.8, "probabilities": { "billing": 0.9, "support": 0.1 } } }, "model": "typesafe/jev-1.13-20260917", "usage": { "cost": 0.00002 } }))
    }))
    .route("/api/v1/audio/speech", post(|headers: HeaderMap, Json(body): Json<Value>| async move {
        // Set by the test before this call: a deployment can name itself.
        assert_eq!(headers["x-openrouter-title"], "Kitchen screen");
        assert_eq!(headers["http-referer"], "https://kitchen.example.com");
        assert_eq!(body["input"], "Good morning");
        assert_eq!(body["model"], "mistralai/voxtral-mini-tts-2603");
        assert_eq!(body["response_format"], "mp3");
        ([("content-type", "audio/mpeg")], vec![0x49u8, 0x44, 0x33, 0x04, 0x00])
    }))
    .route("/api/v1/embeddings", post(|Json(body): Json<Value>| async move {
        assert_eq!(body["model"], "openai/text-embedding-3-small");
        Json(json!({ "data": [{ "embedding": [0.1, 0.2, 0.3] }] }))
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

async fn run(src: &str) -> (FetchOutcome, Value) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("brief")).unwrap();
    let path = dir.path().join("brief/module.lua");
    std::fs::write(&path, src).unwrap();
    let def = ModuleDef::load(&path).await.map(Arc::new);
    assert!(def.is_ok(), "{:?}", def.as_ref().err());
    let hub = Hub::new(Persist::memory()).await.unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let services = dashboard::instance::HostServices { sys: dashboard::sysstats::Sampler::start(), persist: Persist::memory() };
    let h = spawn(InstanceSpec { id: "brief".into(), def, config: json!({}) }, hub.clone(), reqwest::Client::new(), Limits::default(), services, tx);
    h.request_fetch();
    let outcome = match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap() {
        InstanceEvent::FetchFinished { outcome, .. } => outcome,
        other => panic!("{other:?}"),
    };
    (outcome, hub.get("brief").await.map(|s| s.state).unwrap_or(Value::Null))
}

#[tokio::test]
async fn ask_and_chat_through_openrouter() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let base = stub(seen.clone()).await;
    // SAFETY: the only test in this binary.
    unsafe { std::env::set_var("OPENROUTER_API_KEY", "or-test-key"); }
    let lib = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../lib/openrouter.lua")).unwrap();
    let mut shared = std::collections::BTreeMap::new();
    shared.insert("openrouter".to_string(), Arc::from(lib.replace("https://openrouter.ai", &base)));
    dashboard::lua_vm::set_shared_libs(shared);

    let (outcome, state) = run(r#"
        local openrouter = require("openrouter")
        return { name = "brief", view = function() return ui.stat {} end,
          fetch = function(ctx)
            local text = openrouter.ask(ctx, "Summarize my day", { model = "anthropic/claude-sonnet-4.5", system = "Be brief.", max_tokens = 100 })
            local raw = openrouter.chat(ctx, { model = "openai/gpt-4o", messages = { { role = "user", content = "hi" } } })
            return { text = text, tokens = raw.usage.total_tokens }
          end }"#).await;
    assert_eq!(outcome, FetchOutcome::Updated);
    assert_eq!(state, json!({ "text": "Three meetings, then gym.", "tokens": 42 }));
    let first = seen.lock().unwrap()[0].clone();
    assert_eq!(first["model"], "anthropic/claude-sonnet-4.5");
    assert_eq!(first["max_tokens"], 100);
    assert_eq!(first["messages"], json!([{ "role": "system", "content": "Be brief." }, { "role": "user", "content": "Summarize my day" }]));

    // Jev through the Decisions endpoint, and any other endpoint through request().
    let (outcome, state) = run(r#"
        local openrouter = require("openrouter")
        return { name = "brief", view = function() return ui.stat {} end,
          fetch = function(ctx)
            local answers, response = openrouter.decide(ctx, {
              state = { subject = "Invoice overdue", from = "billing@example.com" },
              questions = {
                urgent = { type = "noul", instructions = "Does this need a reply today?", criteria = { ["true"] = "yes", ["false"] = "no" } },
                team = { type = "choice", instructions = "Who handles it?", criteria = { billing = "money", support = "help" } },
              },
            })
            local embedded = openrouter.request(ctx, "/embeddings", { model = "openai/text-embedding-3-small", input = "hello" })
            return { urgent = answers.urgent.noul, team = answers.team.choice, model = response.model, dims = #embedded.data[1].embedding }
          end }"#).await;
    assert_eq!(outcome, FetchOutcome::Updated);
    assert_eq!(state, json!({ "urgent": 0.93, "team": "billing", "model": "typesafe/jev-1.13-20260917", "dims": 3 }));

    // Speech and images come back as { data = <base64>, type }, ready for ui.audio and ui.image.
    // SAFETY: the only test in this binary.
    unsafe {
        std::env::set_var("OPENROUTER_APP_NAME", "Kitchen screen");
        std::env::set_var("OPENROUTER_APP_URL", "https://kitchen.example.com");
    }
    let (outcome, state) = run(r#"
        local openrouter = require("openrouter")
        return { name = "brief", view = function() return ui.stat {} end,
          fetch = function(ctx)
            local clip = openrouter.speak(ctx, "Good morning")
            local picture = openrouter.image(ctx, "A watercolor garden")
            return { audio = clip, image = picture }
          end }"#).await;
    assert_eq!(outcome, FetchOutcome::Updated);
    assert_eq!(state["audio"], json!({ "data": "SUQzBAA=", "type": "audio/mpeg" }));
    assert_eq!(state["image"], json!({ "data": "iVBORw0KGgo=", "type": "image/png" }));

    for (model, expected) in [("broken/model", "http 400"), ("empty/model", "provider overloaded")] {
        let (outcome, _) = run(&format!(r#"
            local openrouter = require("openrouter")
            return {{ name = "brief", view = function() return ui.stat {{}} end,
              fetch = function(ctx) return {{ text = openrouter.ask(ctx, "x", {{ model = "{model}" }}) }} end }}"#)).await;
        assert!(matches!(outcome, FetchOutcome::Failed(ref e) if e.contains(expected)), "{model}: {outcome:?}");
    }
}
