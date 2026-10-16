//! Validation of widget trees produced by Lua `view` functions.
use serde_json::{Map, Value, json};

pub const WIDGETS: &[&str] = &["stat", "ticker", "list", "row", "text", "badge", "icon", "group", "clock", "gauge", "line", "bar", "donut"];

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
    if !WIDGETS.contains(&ty.as_str()) {
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
