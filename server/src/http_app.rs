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
///   deploy always picks up the new build. The shell carries the page's runtime settings (`Shell`)
///   in meta tags, so they come from the environment like any other setting.
pub fn static_router(static_dir: &Path, shell_settings: Shell) -> Router {
    let assets = Router::new()
        .fallback_service(ServeDir::new(static_dir.join("assets")))
        .layer(SetResponseHeaderLayer::overriding(CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable")));
    let index = static_dir.join("index.html");
    let metas = shell_settings.metas();
    let page = get(move || shell_html(index.clone(), metas.clone()));
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

/// Settings the page reads at runtime, each filled into an empty `<meta name="dashboard-…">` in index.html.
#[derive(Clone, Debug, Default)]
pub struct Shell {
    /// `DEFAULT_THEME`, in `dashboard-default-theme`.
    pub default_theme: Option<String>,
    /// `RETURN_HOME_AFTER`, in `dashboard-return-home-after`.
    pub return_home_after: Option<String>,
}

impl Shell {
    fn metas(&self) -> Vec<(&'static str, String)> {
        let value = |v: &Option<String>| v.as_deref().map(escape_attr).unwrap_or_default();
        vec![("dashboard-default-theme", value(&self.default_theme)), ("dashboard-return-home-after", value(&self.return_home_after))]
    }
}

/// index.html with the settings filled in. Read per request: it's small, and a rebuild in place is picked up.
async fn shell_html(index: std::path::PathBuf, metas: Vec<(&'static str, String)>) -> axum::response::Response {
    use axum::response::IntoResponse;
    match tokio::fs::read_to_string(&index).await {
        Ok(mut html) => {
            for (name, value) in &metas {
                html = html.replace(&format!(r#"name="{name}" content="""#), &format!(r#"name="{name}" content="{value}""#));
            }
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
pub fn router(state: AppState, static_dir: &Path, shell: Shell) -> Router {
    Router::new()
        .route("/ws", get(ws::upgrade))
        .merge(crate::hook_routes::routes())
        .with_state(state)
        .merge(static_router(static_dir, shell))
}
