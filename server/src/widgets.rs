//! Validation of widget trees produced by Lua `view` functions.
use serde_json::{Map, Value, json};

pub const WIDGETS: &[&str] = &["stat", "ticker", "list", "row", "text", "badge", "icon", "group", "clock", "gauge", "line", "bar", "donut"];

/// Custom widgets: names found in the WIDGETS_DIR folders, each drawn by a component the web build
/// picks up from the same folders (web/plugins/extensions.ts applies the same naming rules).
static CUSTOM: std::sync::RwLock<Vec<String>> = std::sync::RwLock::new(Vec::new());

/// The custom widget names in `dirs`: `<name>.tsx` or `<name>/index.tsx`, lowercase letters, digits and
/// `_`, not shadowing a built-in. Missing folders are skipped. Sorted, without duplicates.
pub fn scan_custom(dirs: &[std::path::PathBuf]) -> Vec<String> {
    let mut names = std::collections::BTreeSet::new();
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let file = entry.file_name().to_string_lossy().to_string();
            let name = if let Some(stem) = file.strip_suffix(".tsx") {
                if stem.ends_with(".test") { continue }
                stem.to_string()
            } else if entry.path().join("index.tsx").is_file() {
                file
            } else {
                continue;
            };
            let valid = name.chars().next().is_some_and(|c| c.is_ascii_lowercase())
                && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
            if !valid {
                tracing::warn!(file = %entry.path().display(), "skipping widget: names are lowercase letters, digits and _");
            } else if WIDGETS.contains(&name.as_str()) {
                tracing::warn!(file = %entry.path().display(), "skipping widget: ui.{name} is built in");
            } else {
                names.insert(name);
            }
        }
    }
    names.into_iter().collect()
}

/// Sets the custom widget names. Lua VMs created afterwards accept them as `ui.<name>`.
pub fn set_custom(names: Vec<String>) {
    *CUSTOM.write().unwrap_or_else(|e| e.into_inner()) = names;
}

/// Every widget name a view may use: the built-ins, then the custom ones.
pub fn known() -> Vec<String> {
    let custom = CUSTOM.read().unwrap_or_else(|e| e.into_inner()).clone();
    WIDGETS.iter().map(|w| w.to_string()).chain(custom).collect()
}

/// Validates a tree and normalises every node to `{ type, props: {..}, children: [..] }`.
pub fn normalize_tree(node: Value) -> Result<Value, String> {
    normalize(node, "view")
}

fn normalize(node: Value, path: &str) -> Result<Value, String> {
    let mut obj = match node {
        Value::Object(o) => o,
        other => return Err(format!("{path}: expected a widget, got {}", kind_of(&other))),
    };
    let ty = obj
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{path}: widget has no type"))?
        .to_string();
    if !WIDGETS.contains(&ty.as_str()) && !CUSTOM.read().unwrap_or_else(|e| e.into_inner()).contains(&ty) {
        return Err(format!("{path}: unknown widget {ty:?}"));
    }
    let props = match obj.remove("props") {
        None | Some(Value::Null) => Value::Object(Map::new()),
        Some(Value::Array(a)) if a.is_empty() => Value::Object(Map::new()),
        Some(p @ Value::Object(_)) => p,
        Some(other) => return Err(format!("{path}.{ty}: props must be a table, got {}", kind_of(&other))),
    };
    let children: Vec<Value> = match obj.remove("children") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Object(m)) if m.is_empty() => Vec::new(),
        Some(Value::Array(items)) => items
            .into_iter()
            .enumerate()
            .map(|(i, c)| normalize(c, &format!("{path}.{ty}[{}]", i + 1)))
            .collect::<Result<_, _>>()?,
        Some(other) => return Err(format!("{path}.{ty}: children must be a list, got {}", kind_of(&other))),
    };
    Ok(json!({ "type": ty, "props": props, "children": children }))
}

fn kind_of(v: &Value) -> &'static str {
    match v {
        Value::Null => "nil",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "list",
        Value::Object(_) => "table",
    }
}
