//! Loading and validating `modules/<name>/module.lua`.
use crate::{duration::parse_duration, lua_vm::Vm, protocol::Kind, schedule::Schedule};
use mlua::{Table, Value as LuaValue};
use serde_json::{Map, Value};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

pub type ModuleSet = BTreeMap<String, Result<Arc<ModuleDef>, String>>;

#[derive(Debug, Clone)]
pub struct ModuleDef {
    pub name: String,
    pub path: PathBuf,
    pub source: Arc<str>,
    /// The folder's other `.lua` files, loadable with `require`.
    pub libs: crate::lua_vm::Libs,
    pub schedule: Option<Schedule>,
    pub stale_after: Duration,
    pub config: Value,
    /// Config keys declared as `key = required`: no default, every instance must pass one. A slot that omits one gets a load error.
    pub required: Vec<String>,
    pub has_fetch: bool,
    pub has_view: bool,
    pub component: Option<String>,
    pub commands: Vec<String>,
    /// Inbound webhooks: name → auth. Each has a `handle(ctx, req)` function in the module table.
    pub hooks: std::collections::BTreeMap<String, crate::hooks::HookSpec>,
    /// Default frame title template, e.g. "Weather: {{state.place}} ({{config.zip}})".
    pub title: Option<String>,
    /// Default header icon for this module's frames: a Lucide name, or "redis".
    pub icon: Option<String>,
}

impl ModuleDef {
    /// No `fetch`, only hooks: its state arrives by push.
    pub fn push_only(&self) -> bool {
        !self.has_fetch && !self.hooks.is_empty()
    }

    pub fn kind(&self) -> Kind {
        if self.component.is_some() { Kind::State } else { Kind::View }
    }

    pub async fn load(path: &Path) -> Result<Self, String> {
        let shown = path.display().to_string();
        let source: Arc<str> = tokio::fs::read_to_string(path).await.map_err(|e| format!("{shown}: {e}"))?.into();
        let folder = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        let libs = read_libs(path).await.map_err(|e| format!("{shown}: {e}"))?;
        let vm = Vm::new().map_err(|e| e.to_string())?;
        let value: LuaValue = crate::lua_vm::eval_module(&vm, path, &source, &libs).await.map_err(|e| format!("{shown}: {e}"))?;
        let LuaValue::Table(t) = value else {
            return Err(format!("{shown}: module must return a table"));
        };
        Self::from_table(&vm, &t, folder, path.to_path_buf(), source, libs).map_err(|e| format!("{shown}: {e}"))
    }

    fn from_table(vm: &Vm, t: &Table, folder: String, path: PathBuf, source: Arc<str>, libs: crate::lua_vm::Libs) -> Result<Self, String> {
        let get_str = |k: &str| -> Result<Option<String>, String> {
            t.get::<Option<String>>(k).map_err(|_| format!("`{k}` must be a string"))
        };
        let is_fn = |k: &str| matches!(t.get::<LuaValue>(k), Ok(LuaValue::Function(_)));

        let name = get_str("name")?.ok_or("module needs a `name`")?;
        if name != folder {
            return Err(format!("name {name:?} must match its folder {folder:?}"));
        }
        let schedule = match (get_str("every")?, get_str("cron")?) {
            (Some(_), Some(_)) => return Err("use `every` or `cron`, not both".into()),
            (Some(e), None) => Some(Schedule::every(&e)?),
            (None, Some(c)) => Some(Schedule::cron(&c)?),
            (None, None) => None,
        };
        let has_fetch = is_fn("fetch");
        if schedule.is_some() && !has_fetch {
            return Err("a schedule needs a `fetch` function".into());
        }
        let stale_after = match get_str("stale_after")? {
            Some(s) => parse_duration(&s)?,
            None => schedule.as_ref().map(Schedule::default_stale_after).unwrap_or(Duration::from_secs(3600)),
        };
        let has_view = is_fn("view");
        let component = get_str("component")?;
        let title = get_str("title")?;
        let icon = get_str("icon")?;
        if has_view && component.is_some() {
            return Err("use `view` or `component`, not both".into());
        }
        let mut required = Vec::new();
        let config = match t.get::<LuaValue>("config").map_err(|e| e.to_string())? {
            LuaValue::Nil => Value::Object(Map::new()),
            LuaValue::Table(c) => {
                // Keys set to the `required` sentinel have no default; pull them out before converting.
                let sentinel: LuaValue = vm.lua.globals().get("required").map_err(|e| e.to_string())?;
                let defaults = vm.lua.create_table().map_err(|e| e.to_string())?;
                for pair in c.pairs::<LuaValue, LuaValue>() {
                    let (k, v) = pair.map_err(|_| "`config` must be a table of key = value")?;
                    let LuaValue::String(key) = &k else { return Err("`config` keys must be names".into()) };
                    if v == sentinel {
                        required.push(key.to_str().map_err(|e| e.to_string())?.to_string());
                    } else {
                        defaults.set(k, v).map_err(|e| e.to_string())?;
                    }
                }
                required.sort();
                match vm.to_json(LuaValue::Table(defaults))? {
                    Some(Value::Object(m)) => Value::Object(m),
                    Some(Value::Array(a)) if a.is_empty() => Value::Object(Map::new()),
                    None => Value::Object(Map::new()),
                    _ => return Err("`config` must be a table of key = value".into()),
                }
            }
            _ => return Err("`config` must be a table".into()),
        };
        let commands = match t.get::<LuaValue>("commands").map_err(|e| e.to_string())? {
            LuaValue::Nil => Vec::new(),
            LuaValue::Table(c) => {
                let mut names = Vec::new();
                for pair in c.pairs::<String, LuaValue>() {
                    let (k, v) = pair.map_err(|_| "`commands` keys must be names")?;
                    if !matches!(v, LuaValue::Function(_)) {
                        return Err(format!("command {k:?} must be a function"));
                    }
                    names.push(k);
                }
                names.sort();
                names
            }
            _ => return Err("`commands` must be a table".into()),
        };
        let hooks = match t.get::<LuaValue>("hooks").map_err(|e| e.to_string())? {
            LuaValue::Nil => std::collections::BTreeMap::new(),
            LuaValue::Table(h) => {
                let mut out = std::collections::BTreeMap::new();
                for pair in h.pairs::<String, LuaValue>() {
                    let (name, v) = pair.map_err(|_| "`hooks` keys must be names")?;
                    let LuaValue::Table(hook) = v else { return Err(format!("hook {name:?} must be a table with `auth` and `handle`")) };
                    if !matches!(hook.get::<LuaValue>("handle").map_err(|e| e.to_string())?, LuaValue::Function(_)) {
                        return Err(format!("hook {name:?} needs a `handle` function"));
                    }
                    let field = |k: &str| -> Result<Option<serde_json::Value>, String> { vm.to_json(hook.get::<LuaValue>(k).map_err(|e| e.to_string())?) };
                    let auth = crate::hooks::parse_auth(&name, field("auth")?.as_ref())?;
                    let description = field("description")?.and_then(|d| d.as_str().map(str::to_string));
                    out.insert(name.clone(), crate::hooks::HookSpec { auth, description, schema: field("schema")?, example: field("example")? });
                }
                out
            }
            _ => return Err("`hooks` must be a table".into()),
        };
        Ok(Self { name, path, source, libs, schedule, stale_after, config, required, has_fetch, has_view, component, commands, title, icon, hooks })
    }
}

/// Every other `.lua` file next to `module.lua`, keyed by name without the extension.
async fn read_libs(module_path: &Path) -> Result<crate::lua_vm::Libs, String> {
    let mut libs = BTreeMap::new();
    let Some(dir) = module_path.parent() else { return Ok(Arc::new(libs)) };
    let mut entries = tokio::fs::read_dir(dir).await.map_err(|e| e.to_string())?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let p = entry.path();
        let (Some(stem), Some("lua")) = (p.file_stem().and_then(|s| s.to_str()), p.extension().and_then(|e| e.to_str())) else { continue };
        if stem == "module" || !p.is_file() {
            continue;
        }
        let src = tokio::fs::read_to_string(&p).await.map_err(|e| format!("{}: {e}", p.display()))?;
        libs.insert(stem.to_string(), Arc::from(src));
    }
    Ok(Arc::new(libs))
}

/// Loads every `<dir>/<name>/module.lua` across `dirs`, searched like `$PATH`: the first folder with a
/// module by a given name wins. Missing folders are skipped. Broken modules are kept as errors keyed by folder name.
pub async fn load_all(dirs: &[PathBuf]) -> ModuleSet {
    let mut out = BTreeMap::new();
    for dir in dirs {
        let Ok(mut entries) = tokio::fs::read_dir(dir).await else { continue };
        let mut found = Vec::new();
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path().join("module.lua");
            if path.is_file() {
                found.push((entry.file_name().to_string_lossy().to_string(), path));
            }
        }
        found.sort();
        for (name, path) in found {
            if out.contains_key(&name) {
                tracing::debug!(module = %name, shadowed = %path.display(), "an earlier folder already has this module");
                continue;
            }
            out.insert(name, ModuleDef::load(&path).await.map(Arc::new));
        }
    }
    out
}
