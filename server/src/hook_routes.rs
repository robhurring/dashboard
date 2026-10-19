//! HTTP side of webhooks: discovery (GET) and delivery (POST).
use crate::hooks::HookError;
use crate::ws::AppState;
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::{Value, json};
use std::collections::HashMap;

/// Request bodies above this are refused with 413 before anything else runs.
pub const MAX_BODY: usize = 64 * 1024;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/hooks", get(list))
        .route("/hooks/openapi.json", get(openapi))
        .route("/hooks/{instance}", get(describe_instance))
        .route("/hooks/{instance}/{hook}", get(describe_hook).post(deliver))
        .layer(DefaultBodyLimit::max(MAX_BODY))
}

/// Every hook on every instance: where to POST and what it is for.
async fn list(State(state): State<AppState>) -> Json<Value> {
    let mut hooks = Vec::new();
    for inst in state.supervisor.instances().await {
        let Some(def) = inst.def() else { continue };
        for (name, spec) in &def.hooks {
            hooks.push(json!({
                "instance": inst.id,
                "module": def.name,
                "hook": name,
                "path": format!("/hooks/{}/{name}", inst.id),
                "description": spec.description,
                "details": format!("/hooks/{}/{name}", inst.id),
            }));
        }
    }
    Json(json!({ "hooks": hooks }))
}

/// Every hook as one OpenAPI 3.1 document, for clients and agents that speak OpenAPI.
async fn openapi(State(state): State<AppState>, headers: HeaderMap) -> Json<Value> {
    let mut paths = serde_json::Map::new();
    for inst in state.supervisor.instances().await {
        let Some(def) = inst.def() else { continue };
        for (name, spec) in &def.hooks {
            paths.insert(format!("/hooks/{}/{name}", inst.id), json!({ "post": spec.openapi_operation(&inst.id, name) }));
        }
    }
    Json(json!({
        "openapi": "3.1.0",
        "info": {
            "title": "Dashboard webhooks",
            "version": env!("CARGO_PKG_VERSION"),
            "description": "Push data to dashboard modules. Each hook is declared by its module; GET /hooks/<instance>/<hook> describes one.",
        },
        "servers": [{ "url": server_url(&headers) }],
        "paths": paths,
        "components": { "securitySchemes": { "hookToken": { "type": "http", "scheme": "bearer" } } },
    }))
}

/// Where a caller reaches the hooks: the Host it asked on, or, behind a relay or proxy, what it
/// forwarded (e.g. https://relay.example/dashboard). `Forwarded` (RFC 7239) wins over X-Forwarded-*,
/// which a proxy in front (nginx) may overwrite; X-Forwarded-Prefix gives the path. Only used to
/// describe the API, never to route or authorize.
fn server_url(headers: &HeaderMap) -> String {
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok()).map(|v| v.split(',').next().unwrap_or("").trim().to_string()).filter(|v| !v.is_empty());
    let forwarded = |key: &str| {
        header("forwarded")?.split(';').find_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            (k.trim().eq_ignore_ascii_case(key)).then(|| v.trim().trim_matches('"').to_string())
        })
    };
    let host = forwarded("host").or_else(|| header("x-forwarded-host")).or_else(|| header("host")).unwrap_or_else(|| "localhost".into());
    let proto = forwarded("proto").or_else(|| header("x-forwarded-proto")).filter(|p| p == "https" || p == "http").unwrap_or_else(|| "http".into());
    let plain_path = |p: &String| p.starts_with('/') && p.chars().all(|c| c.is_ascii_alphanumeric() || "/-_.".contains(c));
    let prefix = header("x-forwarded-prefix").filter(plain_path).unwrap_or_default();
    format!("{proto}://{host}{}", prefix.trim_end_matches('/'))
}

async fn describe_instance(State(state): State<AppState>, Path(instance): Path<String>) -> Response {
    let Some(def) = state.supervisor.instance(&instance).await.and_then(|i| i.def()) else { return not_found() };
    if def.hooks.is_empty() { return not_found(); }
    let hooks: Vec<Value> = def.hooks.iter().map(|(name, spec)| spec.describe(&instance, name)).collect();
    Json(json!({ "instance": instance, "module": def.name, "hooks": hooks })).into_response()
}

async fn describe_hook(State(state): State<AppState>, Path((instance, hook)): Path<(String, String)>) -> Response {
    let Some(def) = state.supervisor.instance(&instance).await.and_then(|i| i.def()) else { return not_found() };
    match def.hooks.get(&hook) {
        Some(spec) => Json(spec.describe(&instance, &hook)).into_response(),
        None => not_found(),
    }
}

async fn deliver(State(state): State<AppState>, Path((instance, hook)): Path<(String, String)>, headers: HeaderMap, body: Bytes) -> Response {
    let Some(handle) = state.supervisor.instance(&instance).await else { return not_found() };
    let headers: HashMap<String, String> = headers
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().to_ascii_lowercase(), v.to_string())))
        .collect();
    match handle.hook(hook, headers, body).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(HookError::NotFound) => not_found(),
        Err(HookError::Unauthorized) => (StatusCode::UNAUTHORIZED, Json(json!({ "error": "missing or invalid token or signature" }))).into_response(),
        Err(HookError::RateLimited) => (StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "rate limited" }))).into_response(),
        // The handler's error stays in the server log; callers get no internals.
        Err(HookError::Failed(_)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "handler failed" }))).into_response(),
    }
}

fn not_found() -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": "no such hook" }))).into_response()
}
