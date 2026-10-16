//! Widgets from WIDGETS_DIR folders: their names become valid `ui.<name>` in Lua and in view trees.
use dashboard::lua_vm::Vm;
use dashboard::widgets::{normalize_tree, scan_custom, set_custom};
use serde_json::json;

#[test]
fn custom_widget_names_come_from_the_widget_folders() {
    let dir = tempfile::tempdir().unwrap();
    for f in ["moon.tsx", "garden_bed/index.tsx", "Bad-Name.tsx", "stat.tsx", "notes.md", "moon.test.tsx"] {
        let p = dir.path().join(f);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, "").unwrap();
    }
    let names = scan_custom(&[dir.path().to_path_buf(), dir.path().join("missing")]);
    assert_eq!(names, vec!["garden_bed", "moon"]);

    // Unknown before registration, valid after: in the Lua prelude and in tree validation.
    assert!(normalize_tree(json!({ "type": "moon" })).unwrap_err().contains("unknown widget"));
    set_custom(names);
    let tree = normalize_tree(json!({ "type": "garden_bed", "props": { "zone": 2 } })).unwrap();
    assert_eq!(tree["type"], "garden_bed");
    let vm = Vm::new().unwrap();
    let v: mlua::Value = vm.lua.load(r#"return ui.moon { phase = "full" }"#).eval().unwrap();
    assert_eq!(vm.to_json(v).unwrap().unwrap(), json!({ "type": "moon", "props": { "phase": "full" } }));
    let err = vm.lua.load(r#"return ui.sparkle {}"#).eval::<mlua::Value>().unwrap_err().to_string();
    assert!(err.contains("unknown widget ui.sparkle"), "{err}");
}
