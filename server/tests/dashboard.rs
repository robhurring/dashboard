use dashboard::dashboard::{Poll, load, merge_config, parse, validate_id};
use serde_json::json;

#[test]
fn instances_infer_their_module_from_the_id() {
    let d = parse(&json!({
        "instances": [
            { "id": "weather:home", "config": { "zip": "10001" } },
            { "id": "stocks", "poll": "always" },
            { "id": "home-weather", "module": "weather" },
        ]
    }))
    .unwrap();
    assert_eq!(d.instances[0].module, "weather");
    assert_eq!(d.instances[0].config, json!({ "zip": "10001" }));
    assert_eq!(d.instances[0].poll, Poll::Watched);
    assert_eq!(d.instances[1].module, "stocks");
    assert_eq!(d.instances[1].poll, Poll::Always);
    assert_eq!(d.instances[2].module, "weather");
}

#[test]
fn mistakes_name_the_instance() {
    let cases = [
        (json!({ "instances": [ { "id": "a" }, { "id": "a" } ] }), "instances[2]: duplicate"),
        (json!({ "instances": [ { "id": "Weather" } ] }), "instances[1]"),
        (json!({ "instances": [ { "id": "a:b:c" } ] }), "module:name"),
        (json!({ "instances": [ { "id": "a", "poll": "sometimes" } ] }), "poll must be"),
        (json!({ "instances": [ {} ] }), "needs an `id`"),
        (json!({ "timezone": "America/New_York" }), "TZ environment variable"),
    ];
    for (v, expected) in cases {
        let err = parse(&v).unwrap_err();
        assert!(err.contains(expected), "{v}: {err}");
    }
}

#[test]
fn ids_follow_module_colon_name() {
    assert!(validate_id("weather").is_ok());
    assert!(validate_id("weather:home_2").is_ok());
    assert!(validate_id("weather:").is_err());
    assert!(validate_id(":home").is_err());
    assert!(validate_id("we ather").is_err());
}

#[test]
fn instance_config_overrides_module_defaults() {
    let merged = merge_config(&json!({ "zip": "10001", "units": "imperial" }), &json!({ "zip": "96815" }));
    assert_eq!(merged, json!({ "zip": "96815", "units": "imperial" }));
}

#[tokio::test]
async fn missing_file_is_an_empty_dashboard_and_lua_files_load() {
    let dir = tempfile::tempdir().unwrap();
    let d = load(&dir.path().join("application.lua")).await.unwrap();
    assert!(d.instances.is_empty());

    let path = dir.path().join("application.lua");
    std::fs::write(&path, r#"return { instances = { { id = "weather:home", config = { zip = "10001" } } } }"#).unwrap();
    let d = load(&path).await.unwrap();
    assert_eq!(d.instances[0].id, "weather:home");

    std::fs::write(&path, "return {").unwrap();
    assert!(load(&path).await.unwrap_err().contains("application.lua"));
}
