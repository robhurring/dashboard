use axum::body::Body;
use axum::http::Request;
use dashboard::config::Config;
use dashboard::http_app::static_router;
use tower::ServiceExt;

#[tokio::test]
async fn healthz_reports_ok_and_unknown_paths_serve_the_app() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "<p>shell</p>").unwrap();
    let app = static_router(dir.path(), None);

    let res = app.clone().oneshot(Request::get("/healthz").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(res.status(), 200);
    let body = axum::body::to_bytes(res.into_body(), 4096).await.unwrap();
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["ok"], true);
    assert_eq!(v["version"], env!("CARGO_PKG_VERSION"));

    let res = app.oneshot(Request::get("/some/client/route").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(res.status(), 200);
    let body = axum::body::to_bytes(res.into_body(), 4096).await.unwrap();
    assert_eq!(&body[..], b"<p>shell</p>");
}

#[tokio::test]
async fn the_shell_is_never_cached_assets_are_immutable_and_missing_assets_are_404() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "<p>shell</p>").unwrap();
    std::fs::create_dir_all(dir.path().join("assets")).unwrap();
    std::fs::write(dir.path().join("assets/index-abc123.js"), "console.log(1)").unwrap();
    let app = static_router(dir.path(), None);
    let get = |path: &'static str| { let app = app.clone(); async move { app.oneshot(Request::get(path).body(Body::empty()).unwrap()).await.unwrap() } };

    for path in ["/", "/index.html", "/some/client/route"] {
        let res = get(path).await;
        assert_eq!(res.status(), 200, "{path}");
        assert_eq!(res.headers()["cache-control"], "no-cache", "{path}");
    }
    let res = get("/assets/index-abc123.js").await;
    assert_eq!(res.status(), 200);
    assert_eq!(res.headers()["cache-control"], "public, max-age=31536000, immutable");
    // An old page asking for last build's script must get a 404, never the HTML shell.
    let res = get("/assets/index-OLD999.js").await;
    assert_eq!(res.status(), 404);
}

#[tokio::test]
async fn the_shell_carries_the_default_theme_from_the_environment() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), r#"<head><meta name="dashboard-default-theme" content="" /></head>"#).unwrap();
    let body = |app: axum::Router, path: &'static str| async move {
        let res = app.oneshot(Request::get(path).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.headers()["cache-control"], "no-cache", "{path}");
        String::from_utf8(axum::body::to_bytes(res.into_body(), 4096).await.unwrap().to_vec()).unwrap()
    };
    for path in ["/", "/index.html", "/some/client/route"] {
        let html = body(static_router(dir.path(), Some("wall".into())), path).await;
        assert!(html.contains(r#"content="wall""#), "{path}: {html}");
    }
    let html = body(static_router(dir.path(), Some(r#"x"><script>"#.into())), "/").await;
    assert!(html.contains(r#"content="x&quot;&gt;&lt;script&gt;""#), "escaped: {html}");
    let html = body(static_router(dir.path(), None), "/").await;
    assert!(html.contains(r#"content="""#), "{html}");
}

#[test]
fn config_defaults_and_overrides() {
    let cfg = Config::from_lookup(|_| None).unwrap();
    assert_eq!(cfg.port, 5000);
    assert_eq!(cfg.redis_prefix, "dashboard:");
    assert!(!cfg.watch_files);

    let cfg = Config::from_lookup(|k| match k {
        "PORT" => Some("4000".into()),
        "DASHBOARD_WATCH" => Some("1".into()),
        "REDIS_URL" => Some("redis://x".into()),
        _ => None,
    })
    .unwrap();
    assert_eq!(cfg.port, 4000);
    assert!(cfg.watch_files);
    assert_eq!(cfg.redis_url.as_deref(), Some("redis://x"));

    assert!(Config::from_lookup(|k| (k == "PORT").then(|| "not-a-port".into())).is_err());
}

#[test]
fn timezone_comes_from_tz_env_and_defaults_to_utc() {
    assert_eq!(Config::from_lookup(|_| None).unwrap().timezone, chrono_tz::UTC);
    let cfg = Config::from_lookup(|k| (k == "TZ").then(|| "America/New_York".into())).unwrap();
    assert_eq!(cfg.timezone, chrono_tz::America::New_York);
    let err = Config::from_lookup(|k| (k == "TZ").then(|| "Mars/Base".into())).unwrap_err().to_string();
    assert!(err.contains("TZ") && err.contains("Mars/Base"), "{err}");
}
