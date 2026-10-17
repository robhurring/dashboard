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
async fn http_errors_show_the_host_but_never_the_path_or_query() {
    let base = stub().await;
    let vm = Vm::new().unwrap();
    let err = run(&vm, &context(), &format!(r#"local ctx = ... return ctx.http.get("{base}/fail", {{ query = {{ token = "SECRET-KEY" }} }})"#))
        .await
        .unwrap_err();
    assert!(err.contains("http 500"), "{err}");
    assert!(err.contains("127.0.0.1"), "{err}");
    assert!(!err.contains("/fail"), "{err}");
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
async fn instant_turns_a_wall_clock_time_in_a_zone_into_epoch_and_host_time() {
    let vm = Vm::new().unwrap();
    let cc = context();
    // 09:30 in Los Angeles on a PDT date is 16:30 UTC.
    let v = run(&vm, &cc, r#"local ctx = ... return ctx.instant("2026-10-16T09:30:00", "America/Los_Angeles")"#).await.unwrap().unwrap();
    assert_eq!(v["epoch"], 1792168200);
    assert!(v["iso"].as_str().unwrap().len() == 25, "{}", v["iso"]);
    let utc = run(&vm, &cc, r#"local ctx = ... return ctx.instant("2026-10-16T16:30:00", "UTC")"#).await.unwrap().unwrap();
    assert_eq!(utc["epoch"], 1792168200);
    // Across the DST change the offset follows the zone: 09:30 in LA in December is 17:30 UTC.
    let winter = run(&vm, &cc, r#"local ctx = ... return ctx.instant("2026-12-16T09:30:00", "America/Los_Angeles").epoch"#).await.unwrap().unwrap();
    assert_eq!(winter, 1797442200);
    // A time that does not exist (spring forward) lands just after the gap instead of failing.
    let gap = run(&vm, &cc, r#"local ctx = ... return ctx.instant("2026-03-08T02:30:00", "America/New_York").epoch"#).await.unwrap().unwrap();
    assert_eq!(gap, 1772955000);
    let err = run(&vm, &cc, r#"local ctx = ... return ctx.instant("2026-10-16T09:30:00", "Mars/Olympus")"#).await.unwrap_err();
    assert!(err.contains("unknown time zone"), "{err}");
    let err = run(&vm, &cc, r#"local ctx = ... return ctx.instant("yesterday", "UTC")"#).await.unwrap_err();
    assert!(err.contains("YYYY-MM-DDTHH:MM:SS"), "{err}");
}

#[test]
fn redaction_keeps_only_the_scheme_and_host() {
    // Secrets live in query strings, and in paths too: a private calendar's token is a path segment.
    assert_eq!(redact_url("https://finnhub.io/api/v1/quote?symbol=X&token=abc#frag"), "https://finnhub.io/…");
    assert_eq!(redact_url("https://calendar.google.com/calendar/ical/me%40x.com/private-abc123/basic.ics"), "https://calendar.google.com/…");
    assert_eq!(redact_url("http://127.0.0.1:4000"), "http://127.0.0.1:4000");
    assert_eq!(redact_url("not a url"), "…");
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
