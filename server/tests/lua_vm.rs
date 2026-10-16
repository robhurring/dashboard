use dashboard::lua_vm::{clean_error, Vm};
use dashboard::widgets::normalize_tree;
use serde_json::json;
use std::time::Duration;

#[tokio::test]
async fn sandbox_hides_os_and_io() {
    let vm = Vm::new().unwrap();
    let ok: bool = vm.lua.load("return io == nil and (os == nil or os.execute == nil)").eval().unwrap();
    assert!(ok);
}

#[tokio::test]
async fn runaway_loop_times_out() {
    let vm = Vm::new().unwrap();
    let err = vm
        .run(Duration::from_millis(100), vm.lua.load("while true do end").exec_async())
        .await
        .unwrap_err();
    assert!(err.contains("timed out"), "{err}");
}

#[tokio::test]
async fn memory_is_capped() {
    let vm = Vm::new().unwrap();
    let src = "local t = {} for i = 1, 1e8 do t[i] = string.rep('x', 1024) end";
    let err = vm.run(Duration::from_secs(5), vm.lua.load(src).exec_async()).await.unwrap_err();
    assert!(err.to_lowercase().contains("memory"), "{err}");
}

#[tokio::test]
async fn ui_builds_widget_trees_with_actions() {
    let vm = Vm::new().unwrap();
    let v: mlua::Value = vm
        .lua
        .load(r##"return ui.list { empty = "none", ui.row { title = "#a", on_tap = cmd("dismiss", { name = "a" }) } }"##)
        .eval()
        .unwrap();
    let tree = normalize_tree(vm.to_json(v).unwrap().unwrap()).unwrap();
    assert_eq!(
        tree,
        json!({ "type": "list", "props": { "empty": "none" }, "children": [
            { "type": "row", "props": { "title": "#a", "on_tap": { "command": "dismiss", "args": { "name": "a" } } }, "children": [] }
        ] })
    );
}

#[tokio::test]
async fn unknown_widget_is_an_error() {
    let vm = Vm::new().unwrap();
    let e = vm.lua.load("return ui.nope {}").eval::<mlua::Value>().unwrap_err();
    assert!(clean_error(&e).contains("unknown widget ui.nope"));
}

#[tokio::test]
async fn functions_are_not_state() {
    let vm = Vm::new().unwrap();
    let v: mlua::Value = vm.lua.load("return { f = function() end }").eval().unwrap();
    assert!(vm.to_json(v).unwrap_err().contains("JSON-serialisable"));
}

#[tokio::test]
async fn empty_tables_marked_with_json_array_encode_as_lists() {
    let vm = Vm::new().unwrap();
    let v: mlua::Value = vm.lua.load(r#"return { items = json.array({}), also = json.array({ 1, 2 }), plain = {} }"#).eval().unwrap();
    let j = vm.to_json(v).unwrap().unwrap();
    assert_eq!(j, serde_json::json!({ "items": [], "also": [1, 2], "plain": {} }));
}

#[tokio::test]
async fn tables_with_number_keys_become_objects_with_string_keys() {
    let vm = Vm::new().unwrap();
    let v: mlua::Value = vm.lua.load(r#"return { stops = { [70] = "yellow", [90] = "red" }, seq = { 1, 2 }, mixed = { 1, 2, x = "y" }, empty = {}, arr = json.array({}) }"#).eval().unwrap();
    let j = vm.to_json(v).unwrap().unwrap();
    assert_eq!(j["stops"], serde_json::json!({ "70": "yellow", "90": "red" }));
    assert_eq!(j["seq"], serde_json::json!([1, 2]));
    assert_eq!(j["mixed"], serde_json::json!({ "1": 1, "2": 2, "x": "y" }));
    assert_eq!(j["empty"], serde_json::json!({}));
    assert_eq!(j["arr"], serde_json::json!([]));
}

#[tokio::test]
async fn json_round_trips() {
    let vm = Vm::new().unwrap();
    let s: String = vm.lua.load(r#"return json.encode(json.decode('{"a":[1,2]}'))"#).eval().unwrap();
    assert_eq!(serde_json::from_str::<serde_json::Value>(&s).unwrap(), json!({ "a": [1, 2] }));
}

#[test]
fn normalize_rejects_bad_trees() {
    assert!(normalize_tree(json!({ "type": "marquee" })).unwrap_err().contains("unknown widget"));
    for chart in ["gauge", "line", "bar", "donut"] {
        assert!(normalize_tree(json!({ "type": chart, "props": { "value": 1 } })).is_ok(), "{chart} is a widget");
    }
    assert!(normalize_tree(json!("text")).unwrap_err().contains("expected a widget"));
    assert!(normalize_tree(json!({ "type": "list", "children": [ { "props": {} } ] })).unwrap_err().contains("view.list[1]"));
    // Lua's empty table may arrive as [] or {}; both mean "none".
    assert_eq!(
        normalize_tree(json!({ "type": "stat", "props": [], "children": {} })).unwrap(),
        json!({ "type": "stat", "props": {}, "children": [] })
    );
}
