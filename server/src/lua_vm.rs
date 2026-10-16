//! A sandboxed Luau VM with the module prelude and per-call deadlines.
use mlua::{Lua, LuaSerdeExt, VmState, serde::ser::Options as SerializeOptions};
use std::{
    future::Future,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

pub const MEMORY_LIMIT: usize = 32 * 1024 * 1024;

/// JSON → Lua with `null` becoming `nil`, so `if ctx.state then` behaves as modules expect.
pub fn to_lua(lua: &Lua, v: &serde_json::Value) -> mlua::Result<mlua::Value> {
    lua.to_value_with(v, SerializeOptions::new().serialize_none_to_null(false).serialize_unit_to_null(false))
}

/// The prelude's `KNOWN` table is generated from `widgets::WIDGETS`, the one list of widget names.
fn prelude() -> String {
    let known = crate::widgets::WIDGETS.iter().map(|w| format!("{w} = true")).collect::<Vec<_>>().join(", ");
    format!("local KNOWN = {{ {known} }}\n{PRELUDE}")
}

const PRELUDE: &str = r#"
-- `config = { project = required }`: a key with no default that every instance must pass.
required = setmetatable({}, { __name = "required", __tostring = function() return "required" end })
ui = setmetatable({}, {
  __index = function(_, name)
    if not KNOWN[name] then error("unknown widget ui." .. tostring(name), 2) end
    return function(props)
      props = props or {}
      local children = props.children
      props.children = nil
      for i = 1, #props do
        children = children or {}
        children[#children + 1] = props[i]
        props[i] = nil
      end
      return { type = name, props = props, children = children }
    end
  end,
})
function cmd(action, args)
  return { command = action, args = args or {} }
end
"#;

pub struct Vm {
    pub lua: Lua,
    deadline_ms: Arc<AtomicU64>,
    origin: Instant,
}

impl Vm {
    pub fn new() -> mlua::Result<Self> {
        let lua = Lua::new();
        lua.set_memory_limit(MEMORY_LIMIT)?;
        lua.load(prelude()).set_name("prelude").exec()?;

        let json = lua.create_table()?;
        json.set(
            "encode",
            lua.create_function(|lua, v: mlua::Value| {
                let j: serde_json::Value = lua.from_value(v)?;
                serde_json::to_string(&j).map_err(mlua::Error::external)
            })?,
        )?;
        json.set(
            "decode",
            lua.create_function(|lua, s: String| {
                let j: serde_json::Value = serde_json::from_str(&s).map_err(mlua::Error::external)?;
                to_lua(&lua, &j)
            })?,
        )?;
        // Empty Lua tables are ambiguous; `json.array(t)` marks one so it encodes as `[]`, never `{}`.
        json.set(
            "array",
            lua.create_function(|lua, t: mlua::Table| {
                t.set_metatable(Some(lua.array_metatable()))?;
                Ok(t)
            })?,
        )?;
        lua.globals().set("json", json)?;

        let origin = Instant::now();
        let deadline_ms = Arc::new(AtomicU64::new(0));
        let d = deadline_ms.clone();
        lua.set_interrupt(move |_| {
            let limit = d.load(Ordering::Relaxed);
            if limit != 0 && origin.elapsed().as_millis() as u64 > limit {
                return Err(mlua::Error::runtime("timed out"));
            }
            Ok(VmState::Continue)
        });
        // Globals are complete; freeze them. Module code gets its own writable environment.
        lua.sandbox(true)?;
        Ok(Self { lua, deadline_ms, origin })
    }

    /// Runs a Lua future with a deadline. The interrupt stops busy Lua code; the timeout stops awaits.
    pub async fn run<T>(&self, limit: Duration, fut: impl Future<Output = mlua::Result<T>>) -> Result<T, String> {
        let deadline = self.origin.elapsed().as_millis() as u64 + limit.as_millis() as u64;
        self.deadline_ms.store(deadline, Ordering::Relaxed);
        let out = tokio::time::timeout(limit, fut).await;
        self.deadline_ms.store(0, Ordering::Relaxed);
        match out {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(e)) => Err(clean_error(&e)),
            Err(_) => Err(format!("timed out after {:.1}s", limit.as_secs_f32())),
        }
    }

    /// Converts a Lua value to JSON. `nil` means "no value".
    pub fn to_json(&self, v: mlua::Value) -> Result<Option<serde_json::Value>, String> {
        if v.is_nil() {
            return Ok(None);
        }
        lua_to_json(&self.lua, v, 0).map(Some).map_err(|e| format!("state must be JSON-serialisable: {e}"))
    }
}

/// A module's other `.lua` files, by name without the extension: what `require("name")` may load.
pub type Libs = std::sync::Arc<std::collections::BTreeMap<String, std::sync::Arc<str>>>;

/// Evaluates a module's `module.lua` in its own environment, with a `require` that loads only that
/// module's sibling files (each once). Modules stay self-contained folders: nothing else is reachable.
pub async fn eval_module(vm: &Vm, path: &std::path::Path, source: &str, libs: &Libs) -> Result<mlua::Value, String> {
    let env = module_env(&vm.lua, path, libs).map_err(|e| clean_error(&e))?;
    let chunk = vm.lua.load(source).set_name(path.display().to_string()).set_environment(env);
    vm.run(Duration::from_secs(1), chunk.eval_async()).await
}

fn module_env(lua: &Lua, path: &std::path::Path, libs: &Libs) -> mlua::Result<mlua::Table> {
    let env = lua.create_table()?;
    let meta = lua.create_table()?;
    meta.set("__index", lua.globals())?;
    env.set_metatable(Some(meta))?;
    let cache = lua.create_table()?;
    let dir = path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let (libs, scope) = (libs.clone(), env.clone());
    let require = lua.create_function(move |lua, name: String| {
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
            return Err(mlua::Error::runtime(format!("require({name:?}): use a plain file name from this module's folder, like require(\"ics\")")));
        }
        match cache.get::<mlua::Value>(name.as_str())? {
            mlua::Value::Nil => {}
            mlua::Value::LightUserData(_) => return Err(mlua::Error::runtime(format!("require({name:?}): circular require"))),
            v => return Ok(v),
        }
        let Some(src) = libs.get(&name) else {
            return Err(mlua::Error::runtime(format!("require({name:?}): no file {name}.lua in this module's folder")));
        };
        cache.set(name.as_str(), mlua::Value::LightUserData(mlua::LightUserData(std::ptr::null_mut())))?;
        let chunk = lua.load(&**src).set_name(dir.join(format!("{name}.lua")).display().to_string()).set_environment(scope.clone());
        let v = match chunk.eval::<mlua::Value>()? {
            mlua::Value::Nil => mlua::Value::Boolean(true),
            v => v,
        };
        cache.set(name.as_str(), v.clone())?;
        Ok(v)
    })?;
    env.set("require", require)?;
    Ok(env)
}

/// The first line of a Lua error, without mlua's prefix. Tracebacks stay in the logs.
pub fn clean_error(e: &mlua::Error) -> String {
    let s = e.to_string();
    let first = s.lines().next().unwrap_or("").trim();
    first.strip_prefix("runtime error: ").unwrap_or(first).to_string()
}

/// Lua → JSON by hand: a sequence (or a table marked with `json.array`) is a list; any other table is
/// an object whose number keys become strings, so `{ [70] = "yellow" }` works as a map.
fn lua_to_json(lua: &Lua, v: mlua::Value, depth: usize) -> Result<serde_json::Value, String> {
    use mlua::Value as L;
    use serde_json::Value as J;
    if depth > 64 {
        return Err("table nesting too deep (or a cycle)".into());
    }
    Ok(match v {
        L::Nil => J::Null,
        L::Boolean(b) => J::Bool(b),
        L::Integer(i) => J::from(i),
        L::Number(n) => serde_json::Number::from_f64(n).map(J::Number).ok_or_else(|| format!("{n} is not a finite number"))?,
        L::String(s) => J::String(s.to_str().map_err(|e| e.to_string())?.to_string()),
        L::Table(t) => {
            let marked_array = t.metatable().is_some_and(|m| m == lua.array_metatable());
            let mut entries: Vec<(L, L)> = Vec::new();
            for pair in t.pairs::<L, L>() {
                entries.push(pair.map_err(|e| e.to_string())?);
            }
            let is_sequence = !entries.is_empty()
                && entries.iter().all(|(k, _)| matches!(k, L::Integer(i) if *i >= 1))
                && {
                    let mut idx: Vec<i64> = entries.iter().map(|(k, _)| if let L::Integer(i) = k { *i } else { 0 }).collect();
                    idx.sort_unstable();
                    idx.iter().enumerate().all(|(i, k)| *k == i as i64 + 1)
                };
            if marked_array || is_sequence {
                entries.sort_by_key(|(k, _)| if let L::Integer(i) = k { *i } else { 0 });
                J::Array(entries.into_iter().map(|(_, v)| lua_to_json(lua, v, depth + 1)).collect::<Result<_, _>>()?)
            } else {
                let mut map = serde_json::Map::new();
                for (k, v) in entries {
                    let key = match k {
                        L::String(s) => s.to_str().map_err(|e| e.to_string())?.to_string(),
                        L::Integer(i) => i.to_string(),
                        L::Number(n) => n.to_string(),
                        other => return Err(format!("table key must be a string or number, got {}", other.type_name())),
                    };
                    map.insert(key, lua_to_json(lua, v, depth + 1)?);
                }
                J::Object(map)
            }
        }
        other => return Err(format!("cannot serialise a {}", other.type_name())),
    })
}
