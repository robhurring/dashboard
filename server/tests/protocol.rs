use dashboard::protocol::*;
use serde_json::json;

#[test]
fn snapshot_serialises_with_type_tag_and_numeric_rev() {
    let msg = ServerMsg::Snapshot {
        instance: "weather:home".into(),
        rev: 3,
        kind: Kind::View,
        view: Some(json!({ "type": "stat", "props": { "value": "58°" }, "children": [] })),
        state: None,
        config: json!({}),
        component: None,
        status: Status::ok_at(100),
    };
    let v = serde_json::to_value(&msg).unwrap();
    assert_eq!(v["type"], "snapshot");
    assert_eq!(v["kind"], "view");
    assert_eq!(v["rev"], 3);
    assert_eq!(v["status"]["ok"], true);
    assert_eq!(v["status"]["fetched_at"], 100);
    assert_eq!(v["view"]["props"]["value"], "58°");
}

#[test]
fn hello_without_have_defaults_to_empty() {
    let m: ClientMsg = serde_json::from_str(r#"{"type":"hello","protocol":1,"screen":"wall"}"#).unwrap();
    match m {
        ClientMsg::Hello { protocol, screen, have } => {
            assert_eq!(protocol, 1);
            assert_eq!(screen, "wall");
            assert!(have.is_empty());
        }
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn command_args_default_to_null() {
    let m: ClientMsg =
        serde_json::from_str(r#"{"type":"command","id":"c-1","instance":"slack","action":"dismiss"}"#).unwrap();
    assert!(matches!(m, ClientMsg::Command { args: serde_json::Value::Null, .. }));
}

#[test]
fn unknown_client_message_is_rejected() {
    assert!(serde_json::from_str::<ClientMsg>(r#"{"type":"explode"}"#).is_err());
}

#[test]
fn welcome_lists_instances() {
    let v = serde_json::to_value(ServerMsg::Welcome {
        server: "0.1.0".into(),
        protocol: PROTOCOL_VERSION,
        instances: vec![InstanceInfo { id: "stocks".into(), module: "stocks".into(), kind: Kind::View, component: None, title: None, icon: None, push_only: false }],
    })
    .unwrap();
    assert_eq!(v, json!({ "type": "welcome", "server": "0.1.0", "protocol": 1,
        "instances": [{ "id": "stocks", "module": "stocks", "kind": "view", "component": null, "title": null, "icon": null, "push_only": false }] }));
}

#[test]
fn snapshot_carries_state_and_config_for_view_modules() {
    let msg = ServerMsg::Snapshot {
        instance: "weather:home".into(), rev: 3, kind: Kind::View,
        view: Some(json!({ "type": "stat" })), state: Some(json!({ "temp": 58 })), config: json!({ "zip": "10001" }),
        component: None, status: Status::ok_at(1),
    };
    let v = serde_json::to_value(&msg).unwrap();
    assert_eq!(v["state"]["temp"], 58);
    assert_eq!(v["config"]["zip"], "10001");
}

#[test]
fn watch_carries_slot_declarations() {
    let m: ClientMsg = serde_json::from_str(r#"{"type":"watch","slots":[{"id":"weather:home","module":"weather","props":{"zip":"10001","title":"Home"}},{"id":"stocks","module":"stocks"}]}"#).unwrap();
    let ClientMsg::Watch { slots } = m else { panic!() };
    assert_eq!(slots.len(), 2);
    assert_eq!(slots[0].props["zip"], "10001");
    assert_eq!(slots[1].props, serde_json::Value::Null);
}

#[test]
fn instance_info_carries_a_title_template() {
    let v = serde_json::to_value(InstanceInfo { id: "w".into(), module: "weather".into(), kind: Kind::View, component: None, title: Some("Weather: {{config.zip}}".into()), icon: None, push_only: false }).unwrap();
    assert_eq!(v["title"], "Weather: {{config.zip}}");
}
