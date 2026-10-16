use dashboard::hub::Hub;
use dashboard::instance::{FetchOutcome, InstanceEvent, InstanceHandle, InstanceSpec, Limits, spawn};
use dashboard::module_def::ModuleDef;
use dashboard::persist::Persist;
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tokio::sync::mpsc::UnboundedReceiver;

fn services() -> dashboard::instance::HostServices {
    dashboard::instance::HostServices { sys: dashboard::sysstats::Sampler::start(), persist: dashboard::persist::Persist::memory() }
}


const COUNTER: &str = r#"
return {
  name = "demo", every = "1m", config = { label = "Demo" },
  fetch = function(ctx) return { n = ((ctx.state and ctx.state.n) or 0) + 1, label = ctx.config.label } end,
  view = function(state) return ui.stat { value = tostring(state.n), label = state.label } end,
  commands = {
    reset = function(ctx, args) return { n = args.to or 0, label = ctx.state.label } end,
    poke = function(ctx) ctx.refresh() end,
    boom = function() error("nope") end,
  },
}"#;

struct Fixture { _dir: tempfile::TempDir, path: std::path::PathBuf, hub: Arc<Hub>, handle: InstanceHandle, events: UnboundedReceiver<InstanceEvent> }

async fn fixture(src: &str, config: Value) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("demo")).unwrap();
    let path = dir.path().join("demo/module.lua");
    std::fs::write(&path, src).unwrap();
    let def = ModuleDef::load(&path).await.map(Arc::new);
    let hub = Hub::new(Persist::memory()).await.unwrap();
    let (tx, events) = tokio::sync::mpsc::unbounded_channel();
    let limits = Limits { fetch: Duration::from_millis(300), command: Duration::from_millis(300), view: Duration::from_millis(300) };
    let handle = spawn(InstanceSpec { id: "demo".into(), def, config }, hub.clone(), reqwest::Client::new(), limits, services(), tx);
    Fixture { _dir: dir, path, hub, handle, events }
}

async fn fetched(f: &mut Fixture) -> FetchOutcome {
    assert!(f.handle.request_fetch());
    loop {
        match tokio::time::timeout(Duration::from_secs(5), f.events.recv()).await.unwrap().unwrap() {
            InstanceEvent::FetchFinished { outcome, .. } => return outcome,
            InstanceEvent::RefreshRequested { .. } => {}
        }
    }
}

#[tokio::test]
async fn fetch_publishes_state_and_rendered_view() {
    let mut f = fixture(COUNTER, json!({})).await;
    assert_eq!(fetched(&mut f).await, FetchOutcome::Updated);
    let s = f.hub.get("demo").await.unwrap();
    assert_eq!(s.rev, 1);
    assert_eq!(s.state, json!({ "n": 1, "label": "Demo" }));
    assert_eq!(s.view, Some(json!({ "type": "stat", "props": { "value": "1", "label": "Demo" }, "children": [] })));
    assert!(s.status.ok && s.status.fetched_at.is_some() && !s.status.loading);
    assert_eq!(fetched(&mut f).await, FetchOutcome::Updated);
    assert_eq!(f.hub.get("demo").await.unwrap().rev, 2);
}

#[tokio::test]
async fn concurrent_fetch_requests_merge() {
    let f = fixture(COUNTER, json!({})).await;
    assert!(f.handle.request_fetch());
    assert!(!f.handle.request_fetch());
}

#[tokio::test]
async fn instance_config_overrides_defaults() {
    let mut f = fixture(COUNTER, json!({ "label": "Override" })).await;
    fetched(&mut f).await;
    assert_eq!(f.hub.get("demo").await.unwrap().state["label"], "Override");
}

#[tokio::test]
async fn commands_return_state_request_refresh_and_report_errors() {
    let mut f = fixture(COUNTER, json!({})).await;
    fetched(&mut f).await;
    f.handle.command("reset".into(), json!({ "to": 5 })).await.unwrap();
    assert_eq!(f.hub.get("demo").await.unwrap().state["n"], 5);

    f.handle.command("poke".into(), Value::Null).await.unwrap();
    let ev = tokio::time::timeout(Duration::from_secs(2), f.events.recv()).await.unwrap().unwrap();
    assert!(matches!(ev, InstanceEvent::RefreshRequested { id } if id == "demo"));

    assert!(f.handle.command("boom".into(), Value::Null).await.unwrap_err().contains("nope"));
    assert!(f.handle.command("missing".into(), Value::Null).await.unwrap_err().contains("unknown command"));
}

#[tokio::test]
async fn missing_required_config_is_a_load_error() {
    let src = r#"return { name = "demo", every = "1m", config = { project = required },
      fetch = function(ctx) return { p = ctx.config.project } end,
      view = function(s) return ui.stat { value = s.p } end }"#;
    let f = fixture(src, json!({})).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let err = f.hub.get("demo").await.unwrap().status.load_error.unwrap();
    assert!(err.contains("config `project` is required"), "{err}");

    let f = fixture(src, json!({ "project": "" })).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(f.hub.get("demo").await.unwrap().status.load_error.unwrap().contains("required"));

    let mut f = fixture(src, json!({ "project": "Board" })).await;
    fetched(&mut f).await;
    assert_eq!(f.hub.get("demo").await.unwrap().state["p"], "Board");
}

#[tokio::test]
async fn view_receives_the_instance_config() {
    let src = r#"return { name = "demo", every = "1m", config = { show = "all" },
      fetch = function(ctx) return { n = 1 } end,
      view = function(state, config) return ui.stat { value = tostring(state.n), label = config.show } end }"#;
    let mut f = fixture(src, json!({ "show": "cpu" })).await;
    fetched(&mut f).await;
    assert_eq!(f.hub.get("demo").await.unwrap().view.unwrap()["props"]["label"], "cpu");
}

#[tokio::test]
async fn failing_fetch_keeps_the_last_good_state() {
    let src = r#"return { name = "demo", every = "1m",
      fetch = function(ctx) if ctx.state then error("upstream down") end return { n = 1 } end,
      view = function(s) return ui.stat { value = "x" } end }"#;
    let mut f = fixture(src, json!({})).await;
    fetched(&mut f).await;
    assert!(matches!(fetched(&mut f).await, FetchOutcome::Failed(e) if e.contains("upstream down")));
    let s = f.hub.get("demo").await.unwrap();
    assert_eq!((s.rev, s.state.clone()), (1, json!({ "n": 1 })));
    assert!(!s.status.ok);
    assert!(s.status.error.as_deref().unwrap().contains("upstream down"));
}

#[tokio::test]
async fn non_json_state_fails_and_keeps_last_state() {
    let src = r#"return { name = "demo", every = "1m",
      fetch = function(ctx) if ctx.state then return { f = function() end } end return { n = 1 } end }"#;
    let mut f = fixture(src, json!({})).await;
    fetched(&mut f).await;
    assert!(matches!(fetched(&mut f).await, FetchOutcome::Failed(e) if e.contains("JSON-serialisable")));
    assert_eq!(f.hub.get("demo").await.unwrap().state, json!({ "n": 1 }));
}

#[tokio::test]
async fn bad_view_fails_and_keeps_last_state() {
    let src = r#"return { name = "demo", every = "1m",
      fetch = function(ctx) return { n = ((ctx.state and ctx.state.n) or 0) + 1 } end,
      view = function(s) if s.n > 1 then return ui.marquee {} end return ui.stat { value = "1" } end }"#;
    let mut f = fixture(src, json!({})).await;
    fetched(&mut f).await;
    assert!(matches!(fetched(&mut f).await, FetchOutcome::Failed(e) if e.contains("view")));
    assert_eq!(f.hub.get("demo").await.unwrap().state, json!({ "n": 1 }));
}

#[tokio::test]
async fn runaway_fetch_times_out() {
    let mut f = fixture(r#"return { name = "demo", every = "1m", fetch = function() while true do end end }"#, json!({})).await;
    assert!(matches!(fetched(&mut f).await, FetchOutcome::Failed(e) if e.contains("timed out")));
}

#[tokio::test]
async fn reload_keeps_the_old_version_when_the_new_one_is_broken() {
    let mut f = fixture(COUNTER, json!({})).await;
    fetched(&mut f).await;

    f.handle.reload(Err("demo/module.lua: syntax error".into()), json!({}));
    assert_eq!(fetched(&mut f).await, FetchOutcome::Updated); // old VM still works
    assert!(f.hub.get("demo").await.unwrap().status.load_error.unwrap().contains("syntax error"));

    std::fs::write(&f.path, COUNTER.replace("ui.stat { value = tostring(state.n), label = state.label }", "ui.stat { value = \"n=\" .. state.n }")).unwrap();
    let def = ModuleDef::load(&f.path).await.map(Arc::new);
    f.handle.reload(def, json!({}));
    tokio::time::sleep(Duration::from_millis(200)).await;
    let s = f.hub.get("demo").await.unwrap();
    assert!(s.status.load_error.is_none());
    assert_eq!(s.view.unwrap()["props"]["value"], "n=2");
}

#[tokio::test]
async fn a_module_that_never_loaded_reports_its_error() {
    let hub = Hub::new(Persist::memory()).await.unwrap();
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
    let h = spawn(InstanceSpec { id: "ghost".into(), def: Err("no module named \"ghost\"".into()), config: json!({}) }, hub.clone(), reqwest::Client::new(), Limits::default(), services(), tx);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(hub.get("ghost").await.unwrap().status.load_error.unwrap().contains("no module named"));
    assert!(h.command("x".into(), Value::Null).await.unwrap_err().contains("no module named"));
}
