//! The `ctx` table passed to every module function.
use crate::lua_vm::to_lua;
use mlua::{Function, Lua, LuaSerdeExt, Table, Value as LuaValue};
use reqwest::{Client, Method};
use serde_json::Value;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

pub struct CallContext {
    pub instance: String,
    pub state: Value,
    pub config: Value,
    pub http: Client,
    pub refresh: Arc<AtomicBool>,
    /// Host status for `ctx.sys`; absent in contexts that must not read it.
    pub sys: Option<crate::sysstats::Sampler>,
    /// The host's store for `ctx.redis.info()`.
    pub persist: Option<crate::persist::Persist>,
}

/// The host zone: the `TZ` environment variable, UTC when unset.
fn host_tz() -> chrono_tz::Tz {
    std::env::var("TZ").ok().and_then(|z| z.parse().ok()).unwrap_or(chrono_tz::UTC)
}

/// `wall` ("YYYY-MM-DDTHH:MM:SS") read in `zone` (host zone when None), as epoch seconds and RFC 3339 in the host zone.
/// A time skipped by a daylight-saving jump lands just after the gap, as calendar apps do.
pub fn instant(wall: &str, zone: Option<&str>) -> Result<(i64, String), String> {
    use chrono::TimeZone;
    let naive = chrono::NaiveDateTime::parse_from_str(wall, "%Y-%m-%dT%H:%M:%S")
        .map_err(|_| format!("instant: expected YYYY-MM-DDTHH:MM:SS, got {wall:?}"))?;
    let host = host_tz();
    let tz: chrono_tz::Tz = match zone {
        None => host,
        Some(z) => z.parse().map_err(|_| format!("instant: unknown time zone {z:?}"))?,
    };
    let at = tz
        .from_local_datetime(&naive)
        .earliest()
        .or_else(|| tz.from_local_datetime(&(naive + chrono::Duration::hours(1))).earliest())
        .ok_or_else(|| format!("instant: {wall} does not exist in {}", tz.name()))?;
    let local = at.with_timezone(&host);
    Ok((at.timestamp(), local.to_rfc3339_opts(chrono::SecondsFormat::Secs, false)))
}

/// A URL safe for logs and screens: just the scheme and host. API keys live in query strings, and
/// private feeds put their tokens in the path, so neither is ever shown.
pub fn redact_url(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else { return "…".into() };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if rest.len() > host.len() { format!("{scheme}://{host}/…") } else { format!("{scheme}://{host}") }
}

pub fn build_ctx(lua: &Lua, cc: &CallContext) -> mlua::Result<Table> {
    let ctx = lua.create_table()?;
    ctx.set("state", to_lua(lua, &cc.state)?)?;
    ctx.set("config", to_lua(lua, &cc.config)?)?;

    // System-wide static settings (API keys) come from the environment; `config` is what screens may override.
    ctx.set(
        "env",
        lua.create_function(|_, name: String| match std::env::var(&name).ok().filter(|v| !v.is_empty()) {
            None => Err(mlua::Error::runtime(format!("{name} is not set in the environment"))),
            Some(v) => Ok(v),
        })?,
    )?;

    // Time zones are the one part of date handling Lua cannot do. `ctx.instant(wall, zone)`: the moment that wall-clock
    // time names in an IANA zone ("UTC", or nil for the host zone), as epoch seconds and RFC 3339 in the host zone.
    ctx.set(
        "instant",
        lua.create_function(|lua, (wall, zone): (String, Option<String>)| {
            let (epoch, iso) = instant(&wall, zone.as_deref()).map_err(mlua::Error::runtime)?;
            let t = lua.create_table()?;
            t.set("epoch", epoch)?;
            t.set("iso", iso)?;
            Ok(t)
        })?,
    )?;

    ctx.set("now", lua.create_function(|_, ()| Ok(chrono::Utc::now().timestamp()))?)?;
    // Today's calendar date in the host zone (`TZ`, default UTC): modules compare due dates against it.
    ctx.set(
        "today",
        lua.create_function(|_, ()| Ok(chrono::Utc::now().with_timezone(&host_tz()).format("%Y-%m-%d").to_string()))?,
    )?;

    let refresh = cc.refresh.clone();
    ctx.set(
        "refresh",
        lua.create_function(move |_, ()| {
            refresh.store(true, Ordering::SeqCst);
            Ok(())
        })?,
    )?;

    let instance = cc.instance.clone();
    ctx.set(
        "log",
        lua.create_function(move |_, (level, msg): (String, String)| {
            match level.as_str() {
                "error" => tracing::error!(instance = %instance, "{msg}"),
                "warn" => tracing::warn!(instance = %instance, "{msg}"),
                "debug" => tracing::debug!(instance = %instance, "{msg}"),
                _ => tracing::info!(instance = %instance, "{msg}"),
            }
            Ok(())
        })?,
    )?;

    let sys_table = lua.create_table()?;
    let sampler = cc.sys.clone();
    sys_table.set(
        "stats",
        lua.create_function(move |lua, ()| match &sampler {
            Some(s) => lua.to_value(&s.latest()),
            None => Err(mlua::Error::runtime("ctx.sys is not available in this context")),
        })?,
    )?;
    ctx.set("sys", sys_table)?;

    let redis_table = lua.create_table()?;
    let persist = cc.persist.clone();
    redis_table.set(
        "info",
        lua.create_async_function(move |lua, ()| {
            let persist = persist.clone();
            async move {
                let Some(p) = persist else {
                    return Err(mlua::Error::runtime("ctx.redis is not available in this context"));
                };
                match p.redis_info().await.map_err(|e| mlua::Error::runtime(format!("redis info: {e}")))? {
                    Some(info) => lua.to_value(&info),
                    None => Err(mlua::Error::runtime("the host is not using Redis")),
                }
            }
        })?,
    )?;
    ctx.set("redis", redis_table)?;

    let http = lua.create_table()?;
    http.set("get", http_fn(lua, cc.http.clone(), Method::GET)?)?;
    http.set("post", http_fn(lua, cc.http.clone(), Method::POST)?)?;
    ctx.set("http", http)?;
    Ok(ctx)
}

struct Request {
    url: String,
    query: Vec<(String, String)>,
    headers: Vec<(String, String)>,
    json: Option<Value>,
    body: Option<String>,
    timeout: Option<Duration>,
    /// `as = "base64"`: return the body as `{ data = <base64>, type = <content type> }`, for binary
    /// responses like audio and images.
    as_base64: bool,
}

/// The largest binary response a module may take in, before base64: images and speech fit easily,
/// and the module's sandbox (32 MB) keeps room to work with it.
const MAX_BINARY_BYTES: usize = 8 * 1024 * 1024;

fn read_opts(lua: &Lua, url: String, opts: Option<Table>) -> mlua::Result<Request> {
    let mut r = Request { url, query: Vec::new(), headers: Vec::new(), json: None, body: None, timeout: None, as_base64: false };
    let Some(opts) = opts else { return Ok(r) };
    if let Some(q) = opts.get::<Option<Table>>("query")? {
        for pair in q.pairs::<String, LuaValue>() {
            let (k, v) = pair?;
            r.query.push((k, scalar(&v)?));
        }
    }
    if let Some(h) = opts.get::<Option<Table>>("headers")? {
        for pair in h.pairs::<String, String>() {
            r.headers.push(pair?);
        }
    }
    if let Some(j) = opts.get::<Option<LuaValue>>("json")? {
        r.json = Some(lua.from_value(j)?);
    }
    r.body = opts.get::<Option<String>>("body")?;
    r.timeout = opts.get::<Option<f64>>("timeout")?.map(Duration::from_secs_f64);
    r.as_base64 = match opts.get::<Option<String>>("as")?.as_deref() {
        None => false,
        Some("base64") => true,
        Some(other) => return Err(mlua::Error::runtime(format!("http: `as` can only be \"base64\", got {other:?}"))),
    };
    Ok(r)
}

fn scalar(v: &LuaValue) -> mlua::Result<String> {
    match v {
        LuaValue::String(s) => Ok(s.to_str()?.to_string()),
        LuaValue::Integer(i) => Ok(i.to_string()),
        LuaValue::Number(n) => Ok(n.to_string()),
        LuaValue::Boolean(b) => Ok(b.to_string()),
        other => Err(mlua::Error::runtime(format!("query values must be strings or numbers, got {}", other.type_name()))),
    }
}

fn http_fn(lua: &Lua, client: Client, method: Method) -> mlua::Result<Function> {
    lua.create_async_function(move |lua, (url, opts): (String, Option<Table>)| {
        let client = client.clone();
        let method = method.clone();
        let req = read_opts(&lua, url, opts);
        async move {
            let req = req?;
            let shown = redact_url(&req.url);
            let mut b = client.request(method, &req.url).query(&req.query);
            for (k, v) in &req.headers {
                b = b.header(k, v);
            }
            if let Some(j) = &req.json {
                b = b.json(j);
            }
            if let Some(body) = req.body {
                b = b.body(body);
            }
            if let Some(t) = req.timeout {
                b = b.timeout(t);
            }
            // reqwest errors embed the full URL; strip it so keys in query strings never surface.
            let started = std::time::Instant::now();
            let res = b.send().await.map_err(|e| {
                let error = e.without_url().to_string();
                tracing::warn!(url = %shown, %error, "upstream request failed");
                mlua::Error::runtime(format!("http {shown}: {error}"))
            })?;
            let status = res.status();
            tracing::info!(url = %shown, status = status.as_u16(), ms = started.elapsed().as_millis(), "upstream request");
            let content_type = res
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();
            if req.as_base64 && status.is_success() {
                let bytes = res.bytes().await.map_err(|e| mlua::Error::runtime(format!("http {shown}: {}", e.without_url())))?;
                if bytes.len() > MAX_BINARY_BYTES {
                    return Err(mlua::Error::runtime(format!("http {shown}: response is {} bytes; the limit is {MAX_BINARY_BYTES}", bytes.len())));
                }
                use base64::Engine;
                let t = lua.create_table()?;
                t.set("data", base64::engine::general_purpose::STANDARD.encode(&bytes))?;
                t.set("type", content_type.split(';').next().unwrap_or("").trim())?;
                return Ok(LuaValue::Table(t));
            }
            let is_json = res
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .is_some_and(|ct| ct.contains("json"));
            let text = res
                .text()
                .await
                .map_err(|e| mlua::Error::runtime(format!("http {shown}: {}", e.without_url())))?;
            if !status.is_success() {
                let excerpt: String = text.chars().take(200).collect();
                return Err(mlua::Error::runtime(format!("http {} {shown}: {excerpt}", status.as_u16())));
            }
            if is_json {
                let v: Value = serde_json::from_str(&text)
                    .map_err(|e| mlua::Error::runtime(format!("http {shown}: invalid JSON: {e}")))?;
                to_lua(&lua, &v)
            } else {
                lua.to_value(&text)
            }
        }
    })
}
