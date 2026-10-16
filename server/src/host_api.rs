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

/// A URL safe to show on screens: no query string or fragment, which is where API keys live.
pub fn redact_url(url: &str) -> String {
    url.split(['?', '#']).next().unwrap_or(url).to_string()
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

    // Calendars: `ctx.ical.events(ics_text, { from = "YYYY-MM-DD", to = "YYYY-MM-DD" })`, recurrences expanded, host zone.
    let ical = lua.create_table()?;
    ical.set(
        "events",
        lua.create_function(|lua, (text, opts): (String, Table)| {
            let day = |key: &str| -> mlua::Result<chrono::NaiveDate> {
                let s: String = opts.get(key)?;
                chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d").map_err(|_| mlua::Error::runtime(format!("ical.events: `{key}` must be YYYY-MM-DD, got {s:?}")))
            };
            let tz = host_tz();
            let from = match opts.get::<Option<String>>("from")? { Some(_) => day("from")?, None => chrono::Utc::now().with_timezone(&tz).date_naive() };
            let to = match opts.get::<Option<u32>>("days")? {
                Some(days) => from + chrono::Duration::days(i64::from(days)),
                None => day("to")?,
            };
            let events = crate::ical::events(&text, from, to, tz).map_err(mlua::Error::runtime)?;
            let json = serde_json::to_value(events).map_err(mlua::Error::external)?;
            to_lua(lua, &json)
        })?,
    )?;
    ctx.set("ical", ical)?;

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
}

fn read_opts(lua: &Lua, url: String, opts: Option<Table>) -> mlua::Result<Request> {
    let mut r = Request { url, query: Vec::new(), headers: Vec::new(), json: None, body: None, timeout: None };
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
