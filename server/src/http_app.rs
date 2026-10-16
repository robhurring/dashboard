use axum::{Json, Router, routing::get};
use serde_json::{Value, json};
use std::path::Path;
use axum::http::{HeaderValue, header::CACHE_CONTROL};
use tower_http::{
    services::ServeDir,
    set_header::SetResponseHeaderLayer,
};

/// Health check plus the built frontend.
///
/// - `/assets/*` are content-hashed: cached forever, and a missing one is a 404. (An old page asking
///   for last build's script must never get the HTML shell back: it would fail to parse and hang.)
/// - Everything else serves the shell, `index.html`, which is never cached, so a reload after a
///   deploy always picks up the new build. The shell carries `DEFAULT_THEME` in its
///   `dashboard-default-theme` meta tag, so the theme is a runtime setting like any other.
pub fn static_router(static_dir: &Path, default_theme: Option<String>) -> Router {
    let assets = Router::new()
        .fallback_service(ServeDir::new(static_dir.join("assets")))
        .layer(SetResponseHeaderLayer::overriding(CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable")));
    let index = static_dir.join("index.html");
    let theme = default_theme.map(|t| escape_attr(&t)).unwrap_or_default();
    let page = get(move || shell_html(index.clone(), theme.clone()));
    let shell = Router::new()
        .route("/", page.clone())
        .route("/index.html", page.clone())
        .fallback_service(ServeDir::new(static_dir).fallback(page))
        .layer(SetResponseHeaderLayer::overriding(CACHE_CONTROL, HeaderValue::from_static("no-cache")));
    Router::new()
        .route("/healthz", get(healthz))
        .nest("/assets", assets)
        .merge(shell)
}

/// index.html with the default theme filled in. Read per request: it's small, and a rebuild in place is picked up.
async fn shell_html(index: std::path::PathBuf, theme: String) -> axum::response::Response {
    use axum::response::IntoResponse;
    match tokio::fs::read_to_string(&index).await {
        Ok(html) => {
            let html = html.replace(r#"name="dashboard-default-theme" content="""#, &format!(r#"name="dashboard-default-theme" content="{theme}""#));
            axum::response::Html(html).into_response()
        }
        Err(_) => (axum::http::StatusCode::NOT_FOUND, "the web build is missing: run bin/build").into_response(),
    }
}

fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;")
}

async fn healthz() -> Json<Value> {
    Json(json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") }))
}

use crate::ws::{self, AppState};

/// The complete application: websocket, health, and static files.
pub fn router(state: AppState, static_dir: &Path, default_theme: Option<String>) -> Router {
    Router::new()
        .route("/ws", get(ws::upgrade))
        .merge(crate::hook_routes::routes())
        .with_state(state)
        .merge(static_router(static_dir, default_theme))
}
