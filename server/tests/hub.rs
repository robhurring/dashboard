use dashboard::hub::{Hub, HubEvent, now_secs};
use dashboard::persist::Persist;
use dashboard::protocol::{InstanceInfo, Kind};
use serde_json::json;

fn info(id: &str) -> InstanceInfo {
    InstanceInfo { id: id.into(), module: "m".into(), kind: Kind::View, component: None, title: None, icon: None, push_only: false }
}

#[tokio::test]
async fn publish_bumps_rev_only_when_state_changes() {
    let hub = Hub::new(Persist::memory()).await.unwrap();
    let mut events = hub.subscribe();

    let r1 = hub.publish("a", Kind::View, None, json!({}), json!({ "n": 1 }), Some(json!({ "type": "stat" })), |s| s.ok = true).await;
    assert_eq!(r1, Some(1));
    assert_eq!(events.recv().await.unwrap(), HubEvent::Snapshot("a".into()));

    let same = hub.publish("a", Kind::View, None, json!({}), json!({ "n": 1 }), Some(json!({ "type": "stat" })), |_| {}).await;
    assert_eq!(same, None);

    let r2 = hub.publish("a", Kind::View, None, json!({}), json!({ "n": 2 }), Some(json!({ "type": "stat" })), |_| {}).await;
    assert_eq!(r2, Some(2));
    assert_eq!(events.recv().await.unwrap(), HubEvent::Snapshot("a".into()));
    assert!(hub.get("a").await.unwrap().updated_at >= now_secs() - 5);
}

#[tokio::test]
async fn status_changes_do_not_bump_rev() {
    let hub = Hub::new(Persist::memory()).await.unwrap();
    hub.publish("a", Kind::View, None, json!({}), json!({}), None, |_| {}).await;
    let mut events = hub.subscribe();
    hub.update_status("a", |s| s.error = Some("down".into())).await;
    assert_eq!(events.recv().await.unwrap(), HubEvent::Status("a".into()));
    let a = hub.get("a").await.unwrap();
    assert_eq!(a.rev, 1);
    assert_eq!(a.status.error.as_deref(), Some("down"));
    // No-op status updates are silent.
    hub.update_status("a", |s| s.error = Some("down".into())).await;
    assert!(events.try_recv().is_err());
}

#[tokio::test]
async fn state_survives_a_restart() {
    let persist = Persist::memory();
    let hub = Hub::new(persist.clone()).await.unwrap();
    hub.publish("a", Kind::View, None, json!({}), json!({ "n": 7 }), None, |s| s.fetched_at = Some(123)).await;
    let restarted = Hub::new(persist).await.unwrap();
    let a = restarted.get("a").await.unwrap();
    assert_eq!((a.rev, a.state.clone(), a.status.fetched_at), (1, json!({ "n": 7 }), Some(123)));
}

#[tokio::test]
async fn catalog_changes_remove_missing_instances() {
    let hub = Hub::new(Persist::memory()).await.unwrap();
    hub.publish("a", Kind::View, None, json!({}), json!({}), None, |_| {}).await;
    hub.publish("b", Kind::View, None, json!({}), json!({}), None, |_| {}).await;
    let mut events = hub.subscribe();
    hub.set_catalog(vec![info("a")]).await;
    assert_eq!(events.recv().await.unwrap(), HubEvent::Removed("b".into()));
    assert_eq!(events.recv().await.unwrap(), HubEvent::Catalog);
    assert!(hub.get("b").await.is_none());
    assert_eq!(hub.catalog().await, vec![info("a")]);
}

#[tokio::test]
async fn redis_round_trip() {
    let Ok(url) = std::env::var("TEST_REDIS_URL") else {
        eprintln!("skipping: TEST_REDIS_URL not set");
        return;
    };
    let prefix = format!("test:{}:", now_secs());
    let persist = Persist::redis(&url, &prefix).await.unwrap();
    let hub = Hub::new(persist.clone()).await.unwrap();
    hub.publish("weather:home", Kind::View, None, json!({}), json!({ "t": 58 }), None, |_| {}).await;
    let restored = persist.load_all().await.unwrap();
    assert_eq!(restored["weather:home"].state, json!({ "t": 58 }));
    // Every save carries the default TTL so an abandoned key cannot live forever.
    let ttl = persist.ttl_secs("weather:home").await.unwrap().unwrap();
    assert!(ttl > dashboard::persist::DEFAULT_TTL_SECS - 60 && ttl <= dashboard::persist::DEFAULT_TTL_SECS, "ttl {ttl}");
    persist.expire_removed("weather:home").await.unwrap();
    let ttl = persist.ttl_secs("weather:home").await.unwrap().unwrap();
    assert!(ttl <= dashboard::persist::REMOVED_TTL_SECS, "removed ttl {ttl}");
}
