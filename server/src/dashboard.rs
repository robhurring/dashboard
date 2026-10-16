//! `application.lua`: which instances run, with what config.
use crate::lua_vm::Vm;
use serde_json::{Map, Value};
use std::{collections::HashSet, path::Path, time::Duration};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Poll {
    Watched,
    Always,
}

#[derive(Debug, Clone, PartialEq)]
pub struct InstanceDecl {
    pub id: String,
    pub module: String,
    pub config: Value,
    pub poll: Poll,
}

#[derive(Debug, Clone)]
pub struct DashboardConfig {
    pub instances: Vec<InstanceDecl>,
}

impl Default for DashboardConfig {
    fn default() -> Self {
        Self { instances: Vec::new() }
    }
}

pub fn validate_id(id: &str) -> Result<(), String> {
    let ok_part = |p: &str| {
        !p.is_empty() && p.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    };
    let mut parts = id.split(':');
    let module = parts.next().unwrap_or_default();
    let name = parts.next();
    if parts.next().is_some() || !ok_part(module) || name.is_some_and(|n| !ok_part(n)) {
        return Err(format!("instance id {id:?} must look like `module` or `module:name` using a-z, 0-9, _ and -"));
    }
    Ok(())
}

pub fn module_of(id: &str) -> &str {
    id.split(':').next().unwrap_or(id)
}

/// Shallow merge: keys in `overrides` replace keys in `defaults`.
pub fn merge_config(defaults: &Value, overrides: &Value) -> Value {
    let mut out = defaults.as_object().cloned().unwrap_or_default();
    if let Some(o) = overrides.as_object() {
        for (k, v) in o {
            out.insert(k.clone(), v.clone());
        }
    }
    Value::Object(out)
}

pub async fn load(path: &Path) -> Result<DashboardConfig, String> {
    let shown = path.display().to_string();
    let source = match tokio::fs::read_to_string(path).await {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(DashboardConfig::default()),
        Err(e) => return Err(format!("{shown}: {e}")),
    };
    let vm = Vm::new().map_err(|e| e.to_string())?;
    let chunk = vm.lua.load(&source).set_name(shown.clone());
    let v = vm
        .run(Duration::from_secs(1), chunk.eval_async::<mlua::Value>())
        .await
        .map_err(|e| format!("{shown}: {e}"))?;
    let json = vm.to_json(v).map_err(|e| format!("{shown}: {e}"))?.unwrap_or(Value::Null);
    parse(&json).map_err(|e| format!("{shown}: {e}"))
}

pub fn parse(v: &Value) -> Result<DashboardConfig, String> {
    let obj = v.as_object().ok_or("application.lua must return a table")?;
    if obj.contains_key("timezone") {
        return Err("`timezone` moved to the TZ environment variable; system settings come from the environment".into());
    }
    let list = match obj.get("instances") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(a)) => a.clone(),
        Some(Value::Object(m)) if m.is_empty() => Vec::new(),
        _ => return Err("`instances` must be a list".into()),
    };
    let mut seen = HashSet::new();
    let mut instances = Vec::new();
    for (i, item) in list.iter().enumerate() {
        let at = format!("instances[{}]", i + 1);
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .ok_or(format!("{at}: needs an `id`"))?
            .to_string();
        validate_id(&id).map_err(|e| format!("{at}: {e}"))?;
        if !seen.insert(id.clone()) {
            return Err(format!("{at}: duplicate instance id {id:?}"));
        }
        let module = item.get("module").and_then(Value::as_str).unwrap_or(module_of(&id)).to_string();
        let config = match item.get("config") {
            None | Some(Value::Null) => Value::Object(Map::new()),
            Some(Value::Array(a)) if a.is_empty() => Value::Object(Map::new()),
            Some(c @ Value::Object(_)) => c.clone(),
            _ => return Err(format!("{at}: `config` must be a table")),
        };
        let poll = match item.get("poll").and_then(Value::as_str) {
            None | Some("watched") => Poll::Watched,
            Some("always") => Poll::Always,
            Some(p) => return Err(format!("{at}: poll must be \"watched\" or \"always\", got {p:?}")),
        };
        instances.push(InstanceDecl { id, module, config, poll });
    }
    Ok(DashboardConfig { instances })
}
