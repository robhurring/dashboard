//! Inbound webhooks: auth declared by a module, checked by the host before any Lua runs.
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub enum Encoding {
    Hex,
    Base64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum HookAuth {
    /// HMAC-SHA256 of the raw body with the secret in env var `secret`, sent in `header`.
    Hmac { header: String, secret: String, encoding: Encoding },
    /// A shared token from env var `secret`, sent as `Authorization: Bearer <token>` or `X-Hook-Token: <token>`.
    /// When that variable is unset or empty (local development) the hook is open.
    Token { secret: String },
    /// No check. Must be written explicitly; meant for testing.
    Public,
}

/// Headers handed to Lua: a small allow-list, lower-cased.
pub const FORWARDED_HEADERS: &[&str] = &["user-agent", "content-type", "x-event", "x-github-event", "x-request-id"];

impl HookAuth {
    /// Whether the request may run the handler. `headers` keys are lower-case.
    pub fn verify(&self, headers: &HashMap<String, String>, body: &[u8]) -> bool {
        match self {
            HookAuth::Public => true,
            HookAuth::Token { secret } => {
                let Some(expected) = token_value(secret) else { return true };
                let bearer = headers.get("authorization").and_then(|v| {
                    let (scheme, rest) = v.trim().split_once(' ')?;
                    scheme.eq_ignore_ascii_case("bearer").then(|| rest.trim().to_string())
                });
                let sent = bearer.or_else(|| headers.get("x-hook-token").map(|v| v.trim().to_string()));
                sent.is_some_and(|sent| constant_time_eq(sent.as_bytes(), expected.as_bytes()))
            }
            HookAuth::Hmac { header, secret, encoding } => {
                let Some(sent) = headers.get(&header.to_ascii_lowercase()) else { return false };
                let Ok(key) = std::env::var(secret) else { return false };
                if key.is_empty() { return false; }
                let sent = sent.trim();
                let sent = sent.strip_prefix("sha256=").unwrap_or(sent);
                let decoded = match encoding {
                    Encoding::Hex => hex::decode(sent).ok(),
                    Encoding::Base64 => base64::engine::general_purpose::STANDARD.decode(sent).ok(),
                };
                let Some(sig) = decoded else { return false };
                let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(key.as_bytes()) else { return false };
                mac.update(body);
                mac.verify_slice(&sig).is_ok() // constant-time
            }
        }
    }
}

/// A declared hook: its auth plus what it accepts, for `GET /hooks/<instance>`.
#[derive(Debug, Clone, PartialEq)]
pub struct HookSpec {
    pub auth: HookAuth,
    pub description: Option<String>,
    /// JSON Schema of the request body, as the module declares it.
    pub schema: Option<serde_json::Value>,
    pub example: Option<serde_json::Value>,
}

impl HookSpec {
    /// The public contract: never the secret's value, only how to sign.
    pub fn describe(&self, instance: &str, name: &str) -> serde_json::Value {
        let auth = match &self.auth {
            HookAuth::Public => serde_json::json!({ "type": "public" }),
            HookAuth::Token { secret } if token_value(secret).is_none() => serde_json::json!({
                "type": "none",
                "note": format!("open: {secret} is not set on this server; set it to require a bearer token"),
            }),
            HookAuth::Token { .. } => serde_json::json!({
                "type": "bearer",
                "header": "Authorization",
                "format": "Bearer <token>",
                "alternative": "X-Hook-Token: <token>",
            }),
            HookAuth::Hmac { header, encoding, .. } => serde_json::json!({
                "type": "hmac-sha256",
                "header": header,
                "encoding": match encoding { Encoding::Hex => "hex", Encoding::Base64 => "base64" },
                "signs": "the raw request body",
            }),
        };
        serde_json::json!({
            "hook": name,
            "method": "POST",
            "path": format!("/hooks/{instance}/{name}"),
            "description": self.description,
            "auth": auth,
            "content_type": "application/json",
            "schema": self.schema,
            "example": self.example,
        })
    }
}

impl HookSpec {
    /// This hook as an OpenAPI 3.1 operation (3.1 takes JSON Schema as-is).
    pub fn openapi_operation(&self, instance: &str, name: &str) -> serde_json::Value {
        use serde_json::json;
        let mut body = serde_json::Map::new();
        body.insert("schema".into(), self.schema.clone().unwrap_or_else(|| json!({})));
        if let Some(ex) = &self.example { body.insert("example".into(), ex.clone()); }
        let mut responses = serde_json::Map::new();
        responses.insert("204".into(), json!({ "description": "Accepted; screens update live" }));
        let mut op = json!({
            "operationId": format!("{}_{}", instance.replace([':', '-'], "_"), name),
            "summary": self.description.clone().unwrap_or_else(|| format!("{instance} {name}")),
            "requestBody": { "required": true, "content": { "application/json": body } },
        });
        if let HookAuth::Hmac { header, encoding, .. } = &self.auth {
            let enc = match encoding { Encoding::Hex => "Hex", Encoding::Base64 => "Base64" };
            op["parameters"] = json!([{
                "name": header, "in": "header", "required": true,
                "description": format!("{enc} HMAC-SHA256 of the raw request body with the hook's secret; a `sha256=` prefix is accepted."),
                "schema": { "type": "string" },
            }]);
            responses.insert("401".into(), json!({ "description": "Signature missing or invalid" }));
        }
        if let HookAuth::Token { secret } = &self.auth && token_value(secret).is_some() {
            op["security"] = json!([{ "hookToken": [] }]);
            responses.insert("401".into(), json!({ "description": "Token missing or invalid" }));
        }
        responses.insert("404".into(), json!({ "description": "No such instance or hook" }));
        responses.insert("413".into(), json!({ "description": "Body over 64 KiB" }));
        responses.insert("429".into(), json!({ "description": "Over 60 calls a minute for this instance" }));
        responses.insert("500".into(), json!({ "description": "The handler failed; the last good state is kept" }));
        op["responses"] = serde_json::Value::Object(responses);
        op
    }
}

/// The configured token, or None when the variable is unset or empty (the hook is then open).
fn token_value(var: &str) -> Option<String> {
    std::env::var(var).ok().filter(|v| !v.is_empty())
}

/// Equal-length-aware comparison that does not stop at the first differing byte.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() { return false; }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Parses a hook's `auth` table (already converted to JSON).
pub fn parse_auth(name: &str, v: Option<&serde_json::Value>) -> Result<HookAuth, String> {
    let Some(obj) = v.and_then(|v| v.as_object()) else { return Err(format!("hook {name:?} needs `auth`")) };
    if obj.get("public").and_then(|p| p.as_bool()) == Some(true) {
        return Ok(HookAuth::Public);
    }
    if let Some(secret) = obj.get("token") {
        let secret = secret.as_str().filter(|s| !s.is_empty()).ok_or(format!("hook {name:?}: `token` must name an environment variable"))?;
        return Ok(HookAuth::Token { secret: secret.to_string() });
    }
    match obj.get("hmac").and_then(|h| h.as_str()) {
        Some("sha256") => {}
        Some(other) => return Err(format!("hook {name:?}: hmac must be \"sha256\", got {other:?}")),
        None => return Err(format!("hook {name:?}: auth must be {{ token = \"ENV_VAR\" }}, {{ hmac = \"sha256\", header, secret }} or {{ public = true }}")),
    }
    let field = |k: &str| obj.get(k).and_then(|x| x.as_str()).map(str::to_string).ok_or(format!("hook {name:?}: hmac auth needs `{k}`"));
    let encoding = match obj.get("encoding").and_then(|e| e.as_str()) {
        None | Some("hex") => Encoding::Hex,
        Some("base64") => Encoding::Base64,
        Some(other) => return Err(format!("hook {name:?}: encoding must be \"hex\" or \"base64\", got {other:?}")),
    };
    Ok(HookAuth::Hmac { header: field("header")?, secret: field("secret")?, encoding })
}

/// Why a hook request did not run.
#[derive(Debug, PartialEq)]
pub enum HookError {
    NotFound,
    Unauthorized,
    RateLimited,
    Failed(String),
}

/// A sliding one-minute window.
#[derive(Default)]
pub struct RateLimit {
    hits: std::collections::VecDeque<std::time::Instant>,
}

impl RateLimit {
    pub fn allow(&mut self, per_minute: usize) -> bool {
        let now = std::time::Instant::now();
        while self.hits.front().is_some_and(|t| now.duration_since(*t).as_secs() >= 60) {
            self.hits.pop_front();
        }
        if self.hits.len() >= per_minute { return false; }
        self.hits.push_back(now);
        true
    }
}
