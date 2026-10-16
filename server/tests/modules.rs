use axum::{Json, Router, extract::Query, routing::get};
use dashboard::hub::Hub;
use dashboard::instance::{FetchOutcome, InstanceEvent, InstanceSpec, Limits, spawn};
use dashboard::module_def::ModuleDef;
use dashboard::persist::Persist;
use serde_json::{Value, json};
use std::{collections::HashMap, path::Path, sync::Arc, time::Duration};

async fn services() -> dashboard::instance::HostServices {
    let persist = match std::env::var("TEST_REDIS_URL") {
        Ok(url) => dashboard::persist::Persist::redis(&url, "test:").await.unwrap(),
        Err(_) => dashboard::persist::Persist::memory(),
    };
    let sys = dashboard::sysstats::Sampler::start();
    tokio::time::sleep(Duration::from_millis(600)).await; // first sample
    dashboard::instance::HostServices { sys, persist }
}


async fn upstream() -> String {
    let app = Router::new()
        .route("/data/2.5/weather", get(|Query(q): Query<HashMap<String, String>>| async move {
            assert_eq!(q["appid"], "test-weather-key");
            assert_eq!(q["zip"], "96815,us");
            Json(json!({ "name": "Honolulu", "timezone": -36000, "sys": { "sunrise": 1792170000, "sunset": 1792212000 }, "main": { "temp": 81.6, "feels_like": 84.2, "temp_max": 85.1, "temp_min": 77.4, "humidity": 70 }, "wind": { "speed": 12.3 }, "weather": [{ "id": 801, "main": "Clouds", "description": "few clouds" }] }))
        }))
        .route("/data/2.5/forecast", get(|Query(q): Query<HashMap<String, String>>| async move {
            assert_eq!(q["appid"], "test-weather-key");
            assert_eq!(q["zip"], "96815,us");
            assert_eq!(q["cnt"], "5");
            let slot = |dt: i64, temp: f64, id: i64, pop: f64| json!({ "dt": dt, "main": { "temp": temp }, "weather": [{ "id": id }], "pop": pop });
            Json(json!({ "list": [
                slot(1792180800, 80.4, 800, 0.0), slot(1792191600, 82.6, 801, 0.1), slot(1792202400, 79.5, 500, 0.62),
                slot(1792213200, 77.1, 803, 0.2), slot(1792224000, 75.8, 800, 0.0),
            ] }))
        }))
        .route("/api/v1/quote", get(|Query(q): Query<HashMap<String, String>>| async move {
            assert_eq!(q["token"], "test-stock-key");
            let (c, d, dp) = if q["symbol"] == "AAPL" { (231.4, 1.886, 0.8231) } else { (118.07, -1.6134, -1.348) };
            Json(json!({ "c": c, "d": d, "dp": dp }))
        }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

/// Loads the real module with its hardcoded upstream URL pointed at the stub. The host has no override for that:
/// where a module sends its keys is the module's business, not config a screen could change.
async fn fetch_via(module: &str, upstream: &str, config: Value) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../modules").join(module).join("module.lua");
    let source = std::fs::read_to_string(&path).unwrap();
    let patched = source.replace("https://finnhub.io", upstream).replace("https://api.openweathermap.org", upstream);
    let dir = tempfile::tempdir().unwrap();
    let dir_path = dir.path().join(module);
    std::fs::create_dir_all(&dir_path).unwrap();
    let path = dir_path.join("module.lua");
    std::fs::write(&path, patched).unwrap();
    let def = ModuleDef::load(&path).await.map(Arc::new);
    assert!(def.is_ok(), "{module}: {:?}", def.as_ref().err());
    let hub = Hub::new(Persist::memory()).await.unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let h = spawn(InstanceSpec { id: module.into(), def, config }, hub.clone(), reqwest::Client::new(), Limits::default(), services().await, tx);
    h.request_fetch();
    match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap() {
        InstanceEvent::FetchFinished { outcome, .. } => assert_eq!(outcome, FetchOutcome::Updated, "{module}"),
        other => panic!("{other:?}"),
    }
    let stored = hub.get(module).await.unwrap();
    stored.view.unwrap_or(stored.state)
}

async fn fetch(module: &str, config: Value) -> Value {
    fetch_via(module, "https://unused.invalid", config).await
}

// One test, so setting environment variables cannot race another test in this binary.
#[tokio::test]
async fn weather_and_stocks_render_from_upstream_data() {
    // SAFETY: this binary runs a single test; nothing else reads the environment concurrently.
    unsafe {
        std::env::set_var("OPENWEATHERMAP_API_KEY", "test-weather-key");
        std::env::set_var("FINNHUB_API_KEY", "test-stock-key");
    }
    let base = upstream().await;

    let weather = fetch_via("weather", &base, json!({ "zip": "96815" })).await;
    // Weather is a custom component: the fetch produces state, not a widget tree.
    assert_eq!(weather, json!({ "temp": 82, "feels": 84, "hi": 85, "lo": 77, "humidity": 70, "wind": 12, "sky": "Clouds", "description": "few clouds", "icon": "cloud-sun", "place": "Honolulu",
        "tz_offset": -36000, "sunrise": 1792170000, "sunset": 1792212000,
        "forecast": [
            { "at": 1792180800, "temp": 80, "icon": "sun", "pop": 0 },
            { "at": 1792191600, "temp": 83, "icon": "cloud-sun", "pop": 10 },
            { "at": 1792202400, "temp": 80, "icon": "cloud-rain", "pop": 62 },
            { "at": 1792213200, "temp": 77, "icon": "cloud", "pop": 20 },
            { "at": 1792224000, "temp": 76, "icon": "sun", "pop": 0 },
        ] }));

    let stocks = fetch_via("stocks", &base, json!({ "symbols": ["AAPL", "NET"] })).await;
    assert_eq!(stocks["type"], "ticker");
    assert_eq!(stocks["props"]["items"], json!([
        { "label": "AAPL", "value": "231.40", "delta": 1.89, "change": "+$1.89" },
        { "label": "NET", "value": "118.07", "delta": -1.61, "change": "-$1.61" },
    ]));
    let pct = fetch_via("stocks", &base, json!({ "symbols": ["AAPL", "NET"], "change": "percent" })).await;
    assert_eq!(pct["props"]["items"][0]["change"], "+0.82%");
    assert_eq!(pct["props"]["items"][1]["change"], "-1.35%");
    let both = fetch_via("stocks", &base, json!({ "symbols": ["AAPL"], "change": "both" })).await;
    assert_eq!(both["props"]["items"][0]["change"], "+$1.89 (+0.82%)");

    let clock = fetch("clock", json!({ "tz": "Pacific/Honolulu", "label": "Honolulu" })).await;
    assert_eq!(clock, json!({ "type": "clock", "props": { "tz": "Pacific/Honolulu", "label": "Honolulu", "seconds": false, "style": "digital", "format": "", "date": false }, "children": [] }));

    let system = fetch("system", json!({})).await;
    assert_eq!(system["type"], "group");
    fn labels(v: &Value, out: &mut Vec<String>) {
        if let Some(l) = v["props"]["label"].as_str() { out.push(l.to_string()); }
        for c in v["children"].as_array().into_iter().flatten() { labels(c, out); }
    }
    let mut found = Vec::new();
    labels(&system, &mut found);
    assert_eq!(found, vec!["CPU", "Memory", "CPU · last hour", "Load", "Uptime"]);
    assert_eq!(system["children"][1]["type"], "line");
    assert_eq!(system["children"][1]["props"]["points"].as_array().unwrap().len(), 1);

    if std::env::var("TEST_REDIS_URL").is_ok() {
        let redis = fetch("redis", json!({})).await;
        assert_eq!(redis["type"], "group");
        assert_eq!(redis["children"][0]["props"]["label"], "Redis");
    }
}

#[tokio::test]
async fn system_samples_every_5s_but_charts_one_point_per_30s() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../modules/system/module.lua");
    let def = Arc::new(ModuleDef::load(&path).await.unwrap());
    assert_eq!(def.schedule.as_ref().unwrap().describe(), "every 5s");
    let hub = Hub::new(Persist::memory()).await.unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let h = spawn(InstanceSpec { id: "system".into(), def: Ok(def), config: json!({}) }, hub.clone(), reqwest::Client::new(), Limits::default(), services().await, tx);
    for _ in 0..2 {
        h.request_fetch();
        match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap() {
            InstanceEvent::FetchFinished { .. } => {}
            other => panic!("{other:?}"),
        }
    }
    let state = hub.get("system").await.unwrap().state;
    assert_eq!(state["cpu_history"].as_array().unwrap().len(), 1, "a second fetch within 30 s must not add a chart point");
    assert!(state["cpu_pct"].is_number());
}
