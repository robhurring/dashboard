use dashboard::module_def::{ModuleDef, load_all};
use dashboard::protocol::Kind;
use serde_json::json;
use std::{path::PathBuf, time::Duration};

fn module(dir: &tempfile::TempDir, name: &str, src: &str) -> PathBuf {
    let folder = dir.path().join(name);
    std::fs::create_dir_all(&folder).unwrap();
    let path = folder.join("module.lua");
    std::fs::write(&path, src).unwrap();
    path
}

#[tokio::test]
async fn hooks_need_valid_auth_to_load() {
    let dir = tempfile::tempdir().unwrap();
    let ok = module(&dir, "a", r#"return { name = "a", hooks = { push = { auth = { hmac = "sha256", header = "X-Sig", secret = "A_SECRET" }, handle = function() end } }, view = function() return ui.stat {} end }"#);
    let def = ModuleDef::load(&ok).await.unwrap();
    assert_eq!(def.hooks.keys().cloned().collect::<Vec<_>>(), vec!["push"]);
    let cases = [
        ("b", r#"return { name = "b", hooks = { x = { handle = function() end } }, view = function() return ui.stat {} end }"#, "needs `auth`"),
        ("c", r#"return { name = "c", hooks = { x = { auth = { hmac = "md5", header = "H", secret = "S" }, handle = function() end } }, view = function() return ui.stat {} end }"#, "sha256"),
        ("d", r#"return { name = "d", hooks = { x = { auth = { public = true } } }, view = function() return ui.stat {} end }"#, "handle"),
        ("e", r#"return { name = "e", hooks = { x = { auth = { hmac = "sha256", secret = "S" }, handle = function() end } }, view = function() return ui.stat {} end }"#, "header"),
    ];
    for (name, src, expected) in cases {
        let err = ModuleDef::load(&module(&dir, name, src)).await.unwrap_err();
        assert!(err.contains(expected), "{name}: {err}");
    }
}

#[tokio::test]
async fn loads_a_complete_module() {
    let dir = tempfile::tempdir().unwrap();
    let path = module(&dir, "weather", r#"
        return {
          name = "weather", every = "30m", icon = "cloud-sun",           config = { zip = required, units = "imperial" },
          fetch = function(ctx) return {} end,
          view = function(state) return ui.stat { value = "1" } end,
          commands = { refresh = function(ctx) end, dismiss = function(ctx, args) end },
        }"#);
    let def = ModuleDef::load(&path).await.unwrap();
    assert_eq!(def.name, "weather");
    assert_eq!(def.icon.as_deref(), Some("cloud-sun"));
    assert_eq!(def.schedule.as_ref().unwrap().describe(), "every 30m");
    assert_eq!(def.stale_after, Duration::from_secs(3600));
    // `required` keys are config with no default: an instance must supply them.
    assert_eq!(def.config, json!({ "units": "imperial" }));
    assert_eq!(def.required, vec!["zip"]);
    assert!(def.has_fetch && def.has_view);
    assert_eq!(def.kind(), Kind::View);
    assert_eq!(def.commands, vec!["dismiss", "refresh"]);
}

#[tokio::test]
async fn push_only_module_needs_nothing_but_a_name() {
    let dir = tempfile::tempdir().unwrap();
    let def = ModuleDef::load(&module(&dir, "slack", r#"return { name = "slack", component = "SlackList" }"#)).await.unwrap();
    assert!(def.schedule.is_none() && !def.has_fetch);
    assert_eq!(def.kind(), Kind::State);
    assert_eq!(def.config, json!({}));
}

#[tokio::test]
async fn invalid_modules_explain_what_is_wrong() {
    let dir = tempfile::tempdir().unwrap();
    let cases = [
        ("a", r#"return { name = "other" }"#, "must match its folder"),
        ("b", r#"return { name = "b", every = "1m", cron = "* * * * *", fetch = function() end }"#, "not both"),
        ("c", r#"return { name = "c", every = "1m" }"#, "needs a `fetch`"),
        ("d", r#"return { name = "d", view = function() end, component = "X" }"#, "`view` or `component`"),
        ("e", r#"return 42"#, "must return a table"),
        ("f", r#"return { name = "f", every = "soon", fetch = function() end }"#, "duration"),
        ("g", r#"return { name = "g", commands = { go = 1 } }"#, "must be a function"),
        ("h", r#"return {"#, "module.lua"),
    ];
    for (name, src, expected) in cases {
        let err = ModuleDef::load(&module(&dir, name, src)).await.unwrap_err();
        assert!(err.contains(expected), "{name}: {err}");
    }
}

#[tokio::test]
async fn load_all_keeps_broken_modules_as_errors() {
    let dir = tempfile::tempdir().unwrap();
    module(&dir, "good", r#"return { name = "good" }"#);
    module(&dir, "bad", r#"return { name = "nope" }"#);
    std::fs::create_dir_all(dir.path().join("not-a-module")).unwrap();
    let all = load_all(dir.path()).await;
    assert_eq!(all.len(), 2);
    assert!(all["good"].is_ok());
    assert!(all["bad"].as_ref().unwrap_err().contains("must match its folder"));
}
