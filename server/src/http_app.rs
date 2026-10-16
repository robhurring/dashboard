use axum::{Json, Router, routing::get};
use serde_json::{Value, json};
use std::path::Path;
use axum::http::{HeaderValue, header::CACHE_CONTROL};
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};

/// Health check plus the built frontend.
///
/// - `/assets/*` are content-hashed: cached forever, and a missing one is a 404. (An old page asking
///   for last build's script must never get the HTML shell back: it would fail to parse and hang.)
/// - Everything else serves the shell, `index.html`, which is never cached, so a reload after a
///   deploy always picks up the new build.
pub fn static_router(static_dir: &Path) -> Router {
    let assets = Router::new()
        .fallback_service(ServeDir::new(static_dir.join("assets")))
        .layer(SetResponseHeaderLayer::overriding(CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable")));
    let shell = Router::new()
        .fallback_service(ServeDir::new(static_dir).append_index_html_on_directories(true).fallback(ServeFile::new(static_dir.join("index.html"))))
        .layer(SetResponseHeaderLayer::overriding(CACHE_CONTROL, HeaderValue::from_static("no-cache")));
    Router::new()
        .route("/healthz", get(healthz))
        .nest("/assets", assets)
        .merge(shell)
}

async fn healthz() -> Json<Value> {
    Json(json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") }))
}

use crate::ws::{self, AppState};

/// The complete application: websocket, health, and static files.
pub fn router(state: AppState, static_dir: &Path) -> Router {
    Router::new()
        .route("/ws", get(ws::upgrade))
        .merge(crate::hook_routes::routes())
        .with_state(state)
        .merge(static_router(static_dir))
}
