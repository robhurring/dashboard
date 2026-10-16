use axum::{Json, Router, extract::Query, http::StatusCode, routing::{get, post}};
use dashboard::host_api::{CallContext, build_ctx, redact_url};
use dashboard::lua_vm::Vm;
use serde_json::{Value, json};
use std::{collections::HashMap, sync::{Arc, atomic::{AtomicBool, Ordering}}, time::Duration};

async fn stub() -> String {
    let app = Router::new()
        .route("/echo", get(|Query(q): Query<HashMap<String, String>>| async move { Json(json!(q)) }))
        .route("/echo", post(|Json(body): Json<Value>| async move { Json(body) }))
        .route("/text", get(|| async { "hello" }))
        .route("/fail", get(|| async { (StatusCode::INTERNAL_SERVER_ERROR, "upstream exploded") }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

fn context() -> CallContext {
    CallContext {
        instance: "test".into(),
        state: json!({ "n": 1 }),
        config: json!({ "zip": "10001" }),
        http: reqwest::Client::new(),
        refresh: Arc::new(AtomicBool::new(false)),
        sys: None,
        persist: None,
    }
}

async fn run(vm: &Vm, cc: &CallContext, src: &str) -> Result<Option<Value>, String> {
    let ctx = build_ctx(&vm.lua, cc).unwrap();
    let v: mlua::Value = vm.run(Duration::from_secs(5), vm.lua.load(src).call_async(ctx)).await?;
    vm.to_json(v)
}

#[tokio::test]
async fn http_get_decodes_json_and_text() {
    let base = stub().await;
    let vm = Vm::new().unwrap();
    let cc = context();
    let v = run(&vm, &cc, &format!(r#"local ctx = ... return ctx.http.get("{base}/echo", {{ query = {{ zip = ctx.config.zip, n = 5 }} }})"#)).await.unwrap();
    assert_eq!(v, Some(json!({ "zip": "10001", "n": "5" })));
    let v = run(&vm, &cc, &format!(r#"local ctx = ... return ctx.http.get("{base}/text")"#)).await.unwrap();
    assert_eq!(v, Some(json!("hello")));
}

#[tokio::test]
async fn http_post_sends_json() {
    let base = stub().await;
    let vm = Vm::new().unwrap();
    let v = run(&vm, &context(), &format!(r#"local ctx = ... return ctx.http.post("{base}/echo", {{ json = {{ a = 1 }} }})"#)).await.unwrap();
    assert_eq!(v, Some(json!({ "a": 1 })));
}

#[tokio::test]
async fn http_errors_never_include_the_query_string() {
    let base = stub().await;
    let vm = Vm::new().unwrap();
    let err = run(&vm, &context(), &format!(r#"local ctx = ... return ctx.http.get("{base}/fail", {{ query = {{ token = "SECRET-KEY" }} }})"#))
        .await
        .unwrap_err();
    assert!(err.contains("http 500"), "{err}");
    assert!(err.contains("/fail"), "{err}");
    assert!(err.contains("upstream exploded"), "{err}");
    assert!(!err.contains("SECRET-KEY"), "{err}");
    let err = run(&vm, &context(), r#"local ctx = ... return ctx.http.get("http://127.0.0.1:1/x?token=SECRET-KEY")"#).await.unwrap_err();
    assert!(!err.contains("SECRET-KEY"), "{err}");
}

#[tokio::test]
async fn env_reads_the_process_environment_and_raises_when_unset() {
    let vm = Vm::new().unwrap();
    let cc = context();
    let path = run(&vm, &cc, r#"local ctx = ... return ctx.env("PATH")"#).await.unwrap();
    assert_eq!(path, Some(json!(std::env::var("PATH").unwrap())));
    let err = run(&vm, &cc, r#"local ctx = ... return ctx.env("DASHBOARD_TEST_SURELY_UNSET")"#).await.unwrap_err();
    assert!(err.contains("DASHBOARD_TEST_SURELY_UNSET is not set"), "{err}");
}

#[tokio::test]
async fn state_config_now_and_refresh() {
    let vm = Vm::new().unwrap();
    let cc = context();
    let v = run(&vm, &cc, r#"local ctx = ... ctx.refresh() ctx.log("info", "hi") return { n = ctx.state.n, zip = ctx.config.zip, recent = ctx.now() > 1700000000 }"#).await.unwrap();
    assert_eq!(v, Some(json!({ "n": 1, "zip": "10001", "recent": true })));
    assert!(cc.refresh.load(Ordering::SeqCst));
}

#[tokio::test]
async fn today_is_a_calendar_date_in_the_host_zone() {
    let vm = Vm::new().unwrap();
    let cc = context();
    let today = run(&vm, &cc, r#"local ctx = ... return ctx.today()"#).await.unwrap().unwrap();
    let s = today.as_str().unwrap();
    assert!(s.len() == 10 && &s[4..5] == "-" && &s[7..8] == "-", "{s}");
    let utc = chrono::Utc::now().format("%Y-%m-%d").to_string();
    // Without TZ set, today is the UTC date.
    if std::env::var("TZ").is_err() { assert_eq!(s, utc); }
}

#[tokio::test]
async fn ical_events_expand_a_calendar_for_a_date_window() {
    let vm = Vm::new().unwrap();
    let cc = context();
    let ics = "BEGIN:VCALENDAR\r\nX-WR-CALNAME:Home\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART:20261015T130000Z\r\nDTEND:20261015T140000Z\r\nSUMMARY:Dentist\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    let src = format!(r#"local ctx = ... return ctx.ical.events({ics:?}, {{ from = "2026-10-15", to = "2026-10-17" }})"#);
    let v = run(&vm, &cc, &src).await.unwrap().unwrap();
    let titles: Vec<&str> = v.as_array().unwrap().iter().map(|e| e["title"].as_str().unwrap()).collect();
    assert_eq!(titles, vec!["Dentist", "Dentist"]);
    assert_eq!(v[0]["calendar"], "Home");
    assert_eq!(v[0]["all_day"], false);
    assert!(v[0]["start"].as_str().unwrap().starts_with("2026-10-15T"), "{}", v[0]["start"]);
    let err = run(&vm, &cc, r#"local ctx = ... return ctx.ical.events("nope", { from = "2026-10-15", to = "2026-10-16" })"#).await.unwrap_err();
    assert!(err.contains("iCalendar"), "{err}");
}

#[test]
fn redaction_strips_query_and_fragment() {
    assert_eq!(redact_url("https://finnhub.io/api/v1/quote?symbol=X&token=abc#frag"), "https://finnhub.io/api/v1/quote");
}


#[tokio::test]
async fn sys_stats_are_available_and_sane() {
    let vm = Vm::new().unwrap();
    let mut cc = context();
    cc.sys = Some(dashboard::sysstats::Sampler::start());
    tokio::time::sleep(Duration::from_millis(600)).await;
    let v = run(&vm, &cc, r#"local ctx = ... local s = ctx.sys.stats() return { ok = s.mem_total_mb > 0 and s.cpu_pct >= 0 and s.uptime_secs > 0 }"#).await.unwrap();
    assert_eq!(v, Some(json!({ "ok": true })));
    assert!(run(&vm, &context(), r#"local ctx = ... return ctx.sys.stats()"#).await.unwrap_err().contains("not available"));
}

#[tokio::test]
async fn redis_info_raises_without_redis_and_reports_with_it() {
    let vm = Vm::new().unwrap();
    let mut cc = context();
    cc.persist = Some(dashboard::persist::Persist::memory());
    let err = run(&vm, &cc, r#"local ctx = ... return ctx.redis.info()"#).await.unwrap_err();
    assert!(err.contains("not using Redis"), "{err}");
    let Ok(url) = std::env::var("TEST_REDIS_URL") else { return };
    cc.persist = Some(dashboard::persist::Persist::redis(&url, "test:").await.unwrap());
    let v = run(&vm, &cc, r#"local ctx = ... local i = ctx.redis.info() return { ok = i.used_mb > 0 and i.keys >= 0 and #i.version > 0 }"#).await.unwrap();
    assert_eq!(v, Some(json!({ "ok": true })));
}
