use dashboard::dashboard::parse;
use dashboard::hub::{Hub, HubEvent};
use dashboard::instance::Limits;
use dashboard::module_def::load_all;
use dashboard::persist::Persist;
use dashboard::protocol::Kind;
use dashboard::protocol::SlotDecl;
use dashboard::supervisor::{SupervisorHandle, start};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};

fn services() -> dashboard::instance::HostServices {
    dashboard::instance::HostServices { sys: dashboard::sysstats::Sampler::start(), persist: dashboard::persist::Persist::memory() }
}


const COUNTER: &str = r#"return { name = "counter", every = "1m",
  fetch = function(ctx) return { n = ((ctx.state and ctx.state.n) or 0) + 1 } end }"#;
const FLAKY: &str = r#"return { name = "flaky", every = "10m", fetch = function() error("upstream down") end }"#;
const LABELLED: &str = r#"return { name = "labelled", every = "1m", config = { label = "default" },
  fetch = function(ctx) return { label = ctx.config.label } end }"#;

fn decl(id: &str, module: &str, props: Value) -> SlotDecl { SlotDecl { id: id.into(), module: module.into(), props, visible: true } }
fn hidden(id: &str, module: &str, props: Value) -> SlotDecl { SlotDecl { visible: false, ..decl(id, module, props) } }
fn ids(hub: &Hub) -> impl std::future::Future<Output = Vec<String>> + '_ {
    async move { hub.catalog().await.into_iter().map(|i| i.id).collect() }
}

async fn setup(dash: Value) -> (tempfile::TempDir, Arc<Hub>, SupervisorHandle) {
    let dir = tempfile::tempdir().unwrap();
    for (name, src) in [("counter", COUNTER), ("flaky", FLAKY), ("labelled", LABELLED)] {
        std::fs::create_dir_all(dir.path().join(name)).unwrap();
        std::fs::write(dir.path().join(name).join("module.lua"), src).unwrap();
    }
    let hub = Hub::new(Persist::memory()).await.unwrap();
    let sup = start(load_all(dir.path()).await, parse(&dash).unwrap(), chrono_tz::UTC, hub.clone(), reqwest::Client::new(), Limits::default(), services()).await;
    (dir, hub, sup)
}

async fn rev(hub: &Hub, id: &str) -> u64 {
    hub.get(id).await.map(|s| s.rev).unwrap_or(0)
}

fn secs(n: u64) -> Duration { Duration::from_secs(n) }

#[tokio::test(start_paused = true)]
async fn unwatched_instances_do_not_poll() {
    let (_d, hub, _sup) = setup(json!({ "instances": [ { "id": "counter" } ] })).await;
    tokio::time::sleep(secs(300)).await;
    assert_eq!(rev(&hub, "counter").await, 0);
}

#[tokio::test(start_paused = true)]
async fn first_watch_fetches_then_ticks_on_schedule() {
    let (_d, hub, sup) = setup(json!({ "instances": [ { "id": "counter" } ] })).await;
    sup.watch(1, vec![decl("counter", "counter", Value::Null)]);
    tokio::time::sleep(secs(1)).await;
    assert_eq!(rev(&hub, "counter").await, 1);
    tokio::time::sleep(secs(60)).await;
    assert_eq!(rev(&hub, "counter").await, 2);
    tokio::time::sleep(secs(60)).await;
    assert_eq!(rev(&hub, "counter").await, 3);
}

#[tokio::test(start_paused = true)]
async fn hidden_slots_stay_declared_but_do_not_poll_and_showing_fetches_what_is_due_at_once() {
    let (_d, hub, sup) = setup(json!({ "instances": [] })).await;
    // Declared while its page is hidden: the instance exists (screens still get its pushes), but it does not poll.
    sup.watch(1, vec![hidden("counter", "counter", Value::Null)]);
    tokio::time::sleep(secs(300)).await;
    assert!(ids(&hub).await.contains(&"counter".to_string()), "a hidden slot keeps its instance");
    assert_eq!(rev(&hub, "counter").await, 0, "hidden slots do not poll");
    // The page is shown: nothing fetched yet, so it fetches immediately, then ticks on schedule.
    sup.watch(1, vec![decl("counter", "counter", Value::Null)]);
    tokio::time::sleep(secs(1)).await;
    assert_eq!(rev(&hub, "counter").await, 1);
    tokio::time::sleep(secs(60)).await;
    assert_eq!(rev(&hub, "counter").await, 2);
    // Hidden again: it keeps ticking through the grace period (swiping back and forth costs nothing), then stops.
    sup.watch(1, vec![hidden("counter", "counter", Value::Null)]);
    tokio::time::sleep(secs(400)).await;
    let settled = rev(&hub, "counter").await;
    tokio::time::sleep(secs(600)).await;
    assert_eq!(rev(&hub, "counter").await, settled, "no polling once hidden past the grace period");
    // (Showing it again much later fetches at once because its next tick is already past; that path
    // compares wall-clock fetch times, which a paused test clock cannot age, so it is not asserted here.)
}

#[tokio::test(start_paused = true)]
async fn ticking_stops_after_the_grace_period() {
    let (_d, hub, sup) = setup(json!({ "instances": [ { "id": "counter" } ] })).await;
    sup.watch(1, vec![decl("counter", "counter", Value::Null)]);
    tokio::time::sleep(secs(1)).await;
    sup.unwatch(1);
    tokio::time::sleep(secs(61)).await;
    assert_eq!(rev(&hub, "counter").await, 2, "still ticking during the grace period");
    tokio::time::sleep(secs(200)).await;
    let settled = rev(&hub, "counter").await;
    tokio::time::sleep(secs(600)).await;
    assert_eq!(rev(&hub, "counter").await, settled, "no ticks after the grace period");
}

#[tokio::test(start_paused = true)]
async fn poll_always_runs_without_watchers() {
    let (_d, hub, _sup) = setup(json!({ "instances": [ { "id": "counter", "poll": "always" } ] })).await;
    tokio::time::sleep(secs(1)).await;
    assert_eq!(rev(&hub, "counter").await, 1);
    tokio::time::sleep(secs(70)).await;
    assert_eq!(rev(&hub, "counter").await, 2);
}

#[tokio::test(start_paused = true)]
async fn fresh_state_is_not_refetched_on_watch() {
    let (_d, hub, sup) = setup(json!({ "instances": [ { "id": "counter" } ] })).await;
    let now = chrono::Utc::now().timestamp();
    hub.publish("counter", Kind::View, None, json!({}), json!({ "n": 10 }), None, |s| { s.ok = true; s.fetched_at = Some(now); }).await;
    sup.watch(1, vec![decl("counter", "counter", Value::Null)]);
    tokio::time::sleep(secs(1)).await;
    assert_eq!(rev(&hub, "counter").await, 1, "cached state is fresh; no fetch");
    tokio::time::sleep(secs(70)).await;
    assert_eq!(hub.get("counter").await.unwrap().state, json!({ "n": 11 }));
}

#[tokio::test(start_paused = true)]
async fn failures_back_off_from_thirty_seconds() {
    let (_d, hub, sup) = setup(json!({ "instances": [ { "id": "flaky" } ] })).await;
    sup.watch(1, vec![decl("flaky", "flaky", Value::Null)]);
    tokio::time::sleep(secs(1)).await;
    let first = hub.get("flaky").await.unwrap().status;
    assert!(!first.ok && first.error.as_deref().unwrap().contains("upstream down"));
    let wait = first.retry_at.unwrap() - chrono::Utc::now().timestamp();
    assert!((25..=35).contains(&wait), "first retry in about 30s, got {wait}");
    tokio::time::sleep(secs(31)).await;
    let wait = hub.get("flaky").await.unwrap().status.retry_at.unwrap() - chrono::Utc::now().timestamp();
    assert!((55..=65).contains(&wait), "second retry in about 60s, got {wait}");
}

#[tokio::test(start_paused = true)]
async fn client_refresh_is_rate_limited() {
    let (_d, hub, sup) = setup(json!({ "instances": [ { "id": "counter" } ] })).await;
    sup.watch(1, vec![decl("counter", "counter", Value::Null)]);
    tokio::time::sleep(secs(1)).await;
    sup.client_refresh("counter".into());
    tokio::time::sleep(secs(1)).await;
    sup.client_refresh("counter".into());
    tokio::time::sleep(secs(1)).await;
    assert_eq!(rev(&hub, "counter").await, 2, "second refresh within 30s is ignored");
    tokio::time::sleep(secs(31)).await;
    let before = rev(&hub, "counter").await;
    sup.client_refresh("counter".into());
    tokio::time::sleep(secs(1)).await;
    assert_eq!(rev(&hub, "counter").await, before + 1);
}

#[tokio::test(start_paused = true)]
async fn unknown_module_shows_a_load_error() {
    let (_d, hub, _sup) = setup(json!({ "instances": [ { "id": "ghost" }, { "id": "counter" } ] })).await;
    tokio::time::sleep(secs(1)).await;
    let ids: Vec<String> = hub.catalog().await.into_iter().map(|i| i.id).collect();
    assert_eq!(ids, vec!["counter", "ghost"]);
    assert!(hub.get("ghost").await.unwrap().status.load_error.unwrap().contains("no module named \"ghost\""));
}

#[tokio::test(start_paused = true)]
async fn reload_adds_and_removes_instances() {
    let (dir, hub, sup) = setup(json!({ "instances": [ { "id": "counter" } ] })).await;
    let mut events = hub.subscribe();
    sup.reload(load_all(dir.path()).await, parse(&json!({ "instances": [ { "id": "counter:two", "module": "counter" } ] })).unwrap());
    tokio::time::sleep(secs(1)).await;
    let ids: Vec<String> = hub.catalog().await.into_iter().map(|i| i.id).collect();
    assert_eq!(ids, vec!["counter:two"]);
    let mut seen = vec![];
    while let Ok(e) = events.try_recv() { seen.push(e); }
    assert!(seen.contains(&HubEvent::Catalog));
    assert!(sup.instance("counter").await.is_none());
    assert!(sup.instance("counter:two").await.is_some());
}


#[tokio::test(start_paused = true)]
async fn a_declared_slot_creates_an_instance_with_split_config() {
    let (_d, hub, sup) = setup(json!({ "instances": [] })).await;
    sup.watch(1, vec![decl("labelled:a", "labelled", json!({ "label": "A", "title": "Frame only" }))]);
    tokio::time::sleep(secs(1)).await;
    assert_eq!(ids(&hub).await, vec!["labelled:a"]);
    assert_eq!(hub.get("labelled:a").await.unwrap().state["label"], "A");
    assert_eq!(hub.get("labelled:a").await.unwrap().config, json!({ "label": "A" }), "frame props never reach config");
}

#[tokio::test(start_paused = true)]
async fn declaration_without_config_uses_module_defaults() {
    let (_d, hub, sup) = setup(json!({ "instances": [] })).await;
    sup.watch(1, vec![decl("labelled", "labelled", Value::Null)]);
    tokio::time::sleep(secs(1)).await;
    assert_eq!(hub.get("labelled").await.unwrap().state["label"], "default");
}

#[tokio::test(start_paused = true)]
async fn later_session_with_different_config_gets_an_error_for_itself() {
    let (_d, hub, sup) = setup(json!({ "instances": [] })).await;
    sup.watch(1, vec![decl("labelled", "labelled", json!({ "label": "wall" }))]);
    tokio::time::sleep(secs(1)).await;
    sup.watch(2, vec![decl("labelled", "labelled", json!({ "label": "phone" }))]);
    tokio::time::sleep(secs(1)).await;
    let errors = sup.session_errors(2).await;
    assert!(errors["labelled"].contains("session 1"), "{errors:?}");
    assert!(sup.session_errors(1).await.is_empty());
    assert_eq!(hub.get("labelled").await.unwrap().state["label"], "wall");
    assert!(hub.get("labelled").await.unwrap().status.load_error.is_none(), "shared status untouched");
}

#[tokio::test(start_paused = true)]
async fn same_session_redeclaring_new_config_reloads_the_instance() {
    let (_d, hub, sup) = setup(json!({ "instances": [] })).await;
    sup.watch(1, vec![decl("labelled", "labelled", json!({ "label": "one" }))]);
    tokio::time::sleep(secs(1)).await;
    assert_eq!(hub.get("labelled").await.unwrap().state["label"], "one");
    sup.watch(1, vec![decl("labelled", "labelled", json!({ "label": "two" }))]);
    tokio::time::sleep(secs(1)).await;
    assert_eq!(hub.get("labelled").await.unwrap().state["label"], "two");
}

#[tokio::test(start_paused = true)]
async fn undeclared_instances_are_dropped_after_grace_and_keep_state() {
    let (_d, hub, sup) = setup(json!({ "instances": [] })).await;
    sup.watch(1, vec![decl("counter", "counter", Value::Null)]);
    tokio::time::sleep(secs(1)).await;
    sup.unwatch(1);
    tokio::time::sleep(secs(119)).await;
    assert_eq!(ids(&hub).await, vec!["counter"], "still listed during grace");
    tokio::time::sleep(secs(2)).await;
    assert!(ids(&hub).await.is_empty(), "dropped after grace");
    // Redeclare: state comes back from persistence and is fresh, so no refetch.
    sup.watch(2, vec![decl("counter", "counter", Value::Null)]);
    tokio::time::sleep(secs(1)).await;
    assert_eq!(rev(&hub, "counter").await, 1);
}

#[tokio::test(start_paused = true)]
async fn application_instances_are_never_dropped_and_win_on_config() {
    let (_d, hub, sup) = setup(json!({ "instances": [ { "id": "labelled", "config": { "label": "app" } } ] })).await;
    sup.watch(1, vec![decl("labelled", "labelled", json!({ "label": "screen" }))]);
    tokio::time::sleep(secs(1)).await;
    assert_eq!(hub.get("labelled").await.unwrap().state["label"], "app");
    assert!(sup.session_errors(1).await.is_empty(), "application config simply wins; not an error");
    sup.unwatch(1);
    tokio::time::sleep(secs(300)).await;
    assert_eq!(ids(&hub).await, vec!["labelled"]);
}

#[tokio::test(start_paused = true)]
async fn unknown_module_and_too_many_slots_are_session_errors() {
    let (_d, _hub, sup) = setup(json!({ "instances": [] })).await;
    let mut slots: Vec<SlotDecl> = (0..51).map(|i| decl(&format!("counter:s{i}"), "counter", Value::Null)).collect();
    slots.push(decl("ghost", "ghost", Value::Null));
    sup.watch(1, slots);
    tokio::time::sleep(secs(1)).await;
    let errors = sup.session_errors(1).await;
    assert!(errors.values().any(|e| e.contains("at most 50")), "{errors:?}");
    assert!(errors.get("ghost").map(|e| e.contains("no module named") || e.contains("at most 50")).unwrap_or(false), "{errors:?}");
}
