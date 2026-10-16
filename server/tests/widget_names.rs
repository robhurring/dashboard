//! The built-in widget names live in two places: server/src/widgets.rs and web/src/widgets/names.ts.
use dashboard::widgets::{WIDGETS, normalize_tree};
use serde_json::json;

#[test]
fn the_server_and_the_web_build_agree_on_the_built_in_widgets() {
    let ts = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../web/src/widgets/names.ts")).unwrap();
    let list = ts.split('[').nth(1).and_then(|r| r.split(']').next()).unwrap();
    let web: Vec<&str> = list.split(',').map(|s| s.trim().trim_matches('"')).filter(|s| !s.is_empty()).collect();
    assert_eq!(WIDGETS.to_vec(), web);
}

#[test]
fn markdown_is_a_built_in_widget() {
    let tree = normalize_tree(json!({ "type": "markdown", "props": { "text": "# Hi", "links": false } })).unwrap();
    assert_eq!(tree["props"]["text"], "# Hi");
}
