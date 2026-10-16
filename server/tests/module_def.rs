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
    let all = load_all(&[dir.path().to_path_buf()]).await;
    assert_eq!(all.len(), 2);
    assert!(all["good"].is_ok());
    assert!(all["bad"].as_ref().unwrap_err().contains("must match its folder"));
}

#[tokio::test]
async fn a_module_can_require_its_own_sibling_files() {
    let dir = tempfile::tempdir().unwrap();
    let path = module(&dir, "cal", r#"
        local ics = require("ics")
        local again = require("ics")
        return {
          name = "cal", every = "1h",
          fetch = function(ctx) return { n = ics.double(21), same = ics == again, nested = ics.nested() } end,
          view = function(state) return ui.stat { value = tostring(state.n) } end,
        }
    "#);
    std::fs::write(dir.path().join("cal/ics.lua"), r#"local util = require("util") return { double = function(x) return x * 2 end, nested = function() return util.name end }"#).unwrap();
    std::fs::write(dir.path().join("cal/util.lua"), r#"return { name = "util" }"#).unwrap();
    let def = ModuleDef::load(&path).await.unwrap();
    assert_eq!(def.libs.keys().cloned().collect::<Vec<_>>(), vec!["ics", "util"]);

    // The instance VM gets the same files: fetch runs code from both.
    let hub = dashboard::hub::Hub::new(dashboard::persist::Persist::memory()).await.unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let services = dashboard::instance::HostServices { sys: dashboard::sysstats::Sampler::start(), persist: dashboard::persist::Persist::memory() };
    let h = dashboard::instance::spawn(
        dashboard::instance::InstanceSpec { id: "cal".into(), def: Ok(std::sync::Arc::new(def)), config: json!({}) },
        hub.clone(), reqwest::Client::new(), dashboard::instance::Limits::default(), services, tx,
    );
    h.request_fetch();
    let ev = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap();
    assert!(matches!(ev, dashboard::instance::InstanceEvent::FetchFinished { outcome: dashboard::instance::FetchOutcome::Updated, .. }), "{ev:?}");
    assert_eq!(hub.get("cal").await.unwrap().state, json!({ "n": 42, "same": true, "nested": "util" }));
}

#[tokio::test]
async fn require_only_reaches_files_in_the_module_folder() {
    let dir = tempfile::tempdir().unwrap();
    for (name, src, expected) in [
        ("m1", r#"require("missing") return { name = "m1" }"#, "no file missing.lua"),
        ("m2", r#"require("../m1/module") return { name = "m2" }"#, "plain file name"),
        ("m3", r#"require("module") return { name = "m3" }"#, "no file module.lua"),
    ] {
        let err = ModuleDef::load(&module(&dir, name, src)).await.unwrap_err();
        assert!(err.contains(expected), "{name}: {err}");
    }
}

#[tokio::test]
async fn the_first_folder_with_a_module_wins_like_path_and_missing_folders_are_skipped() {
    let base = tempfile::tempdir().unwrap();
    let custom = tempfile::tempdir().unwrap();
    module(&base, "clock", r#"return { name = "clock", title = "stock clock" }"#);
    module(&base, "weather", r#"return { name = "weather" }"#);
    module(&custom, "clock", r#"return { name = "clock", title = "my clock" }"#);
    module(&custom, "mine", r#"return { name = "mine" }"#);
    let dirs = vec![custom.path().to_path_buf(), base.path().join("does-not-exist"), base.path().to_path_buf()];
    let all = load_all(&dirs).await;
    assert_eq!(all.keys().cloned().collect::<Vec<_>>(), vec!["clock", "mine", "weather"]);
    assert_eq!(all["clock"].as_ref().unwrap().title.as_deref(), Some("my clock"));
}
