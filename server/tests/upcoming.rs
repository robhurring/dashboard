//! The upcoming module: events pushed in (a work schedule, say), shown by ui.agenda as a countdown to the next.
use dashboard::app::serve_for_test;
use dashboard::config::Config;
use serde_json::{Value, json};
use std::{path::Path, time::{Duration, SystemTime, UNIX_EPOCH}};

#[tokio::test]
async fn pushed_events_count_down_to_the_next_one() {
    // SAFETY: single test in this binary.
    unsafe { std::env::set_var("HOOKS_TOKEN", "k"); }
    let dir = tempfile::tempdir().unwrap();
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    std::fs::create_dir_all(dir.path().join("modules/upcoming")).unwrap();
    std::fs::copy(repo.join("modules/upcoming/module.lua"), dir.path().join("modules/upcoming/module.lua")).unwrap();
    std::fs::write(dir.path().join("application.lua"), r#"return { instances = { { id = "upcoming:work" } } }"#).unwrap();
    std::fs::create_dir_all(dir.path().join("static")).unwrap();
    std::fs::write(dir.path().join("static/index.html"), "x").unwrap();
    let root = dir.path().to_path_buf();
    let cfg = Config::from_lookup(|k| match k {
        "MODULES_DIR" => Some(root.join("modules").display().to_string()),
        "APPLICATION_FILE" => Some(root.join("application.lua").display().to_string()),
        "STATIC_DIR" => Some(root.join("static").display().to_string()),
        _ => None,
    }).unwrap();
    let s = serve_for_test(cfg).await.unwrap();
    for _ in 0..50 { if s.supervisor.instance("upcoming:work").await.and_then(|i| i.def()).is_some() { break; } tokio::time::sleep(Duration::from_millis(20)).await; }

    let push = |body: Value| {
        let body = body.to_string();
        let url = format!("http://{}/hooks/upcoming:work/push", s.addr);
        async move { reqwest::Client::new().post(url).bearer_auth("k").body(body).send().await.unwrap().status().as_u16() }
    };
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    let iso_in = |mins: i64| chrono::DateTime::from_timestamp(now + mins * 60, 0).unwrap().to_rfc3339();
    let titles = |v: &Value| -> Vec<String> { v["events"].as_array().unwrap().iter().map(|e| e["title"].as_str().unwrap().to_string()).collect() };

    // Out of order, one already over: kept sorted by start, the ended one dropped. `at` may be ISO or unix seconds.
    assert_eq!(push(json!({ "source": "work", "events": [
        { "title": "Planning", "at": iso_in(90), "end": iso_in(120) },
        { "title": "Standup", "at": now + 10 * 60, "end": now + 25 * 60, "icon": "users" },
        { "title": "Retro", "at": iso_in(-60), "end": iso_in(-30) },
    ] })).await, 204);
    let entry = s.hub.get("upcoming:work").await.unwrap();
    assert_eq!(titles(&entry.state), vec!["Standup", "Planning"]);
    assert_eq!(entry.state["events"][0]["at"], now + 10 * 60, "times are kept as unix seconds");

    // The view hands the events to ui.agenda, which picks the next one and counts down in the browser.
    let view = entry.view.expect("a view");
    assert_eq!(view["type"], "agenda");
    let shown: Vec<&str> = view["props"]["events"].as_array().unwrap().iter().map(|e| e["title"].as_str().unwrap()).collect();
    assert_eq!(shown, vec!["Standup", "Planning"]);
    assert_eq!(view["props"]["events"][0]["icon"], "users");

    // Another source's events join in; a source's next push replaces only its own.
    assert_eq!(push(json!({ "source": "home", "events": [{ "title": "Dentist", "at": now + 5 * 60 }] })).await, 204);
    assert_eq!(titles(&s.hub.get("upcoming:work").await.unwrap().state), vec!["Dentist", "Standup", "Planning"]);
    assert_eq!(push(json!({ "source": "work", "events": [] })).await, 204);
    assert_eq!(titles(&s.hub.get("upcoming:work").await.unwrap().state), vec!["Dentist"]);

    // replace: true makes this push the whole agenda, dropping every other source.
    assert_eq!(push(json!({ "source": "work", "events": [{ "title": "Standup", "at": now + 600 }] })).await, 204);
    assert_eq!(push(json!({ "source": "home", "replace": true, "events": [{ "title": "Dentist", "at": now + 300 }] })).await, 204);
    assert_eq!(titles(&s.hub.get("upcoming:work").await.unwrap().state), vec!["Dentist"]);

    // An event with no end lingers a little after it starts, then goes.
    assert_eq!(push(json!({ "source": "home", "events": [{ "title": "Just started", "at": now - 60 }, { "title": "Long gone", "at": now - 3600 }] })).await, 204);
    assert_eq!(titles(&s.hub.get("upcoming:work").await.unwrap().state), vec!["Just started"]);

    // Bad shapes are refused and keep the last state.
    assert_eq!(push(json!({ "source": "home", "events": [{ "title": "x" }] })).await, 500);
    assert_eq!(push(json!({ "source": "home", "events": [{ "title": "x", "at": "whenever" }] })).await, 500);
    assert_eq!(push(json!({ "events": {} })).await, 204, "an empty object is an empty list");
    assert_eq!(titles(&s.hub.get("upcoming:work").await.unwrap().state), vec!["Just started"]);

    // Nothing left: the view says so.
    assert_eq!(push(json!({ "source": "home", "events": [] })).await, 204);
    let view = s.hub.get("upcoming:work").await.unwrap().view.unwrap();
    assert_eq!(view["props"]["events"], json!([]));

    // Discoverable, token-protected, and the example is itself a valid push.
    let url = format!("http://{}/hooks/upcoming:work/push", s.addr);
    let doc: Value = reqwest::get(&url).await.unwrap().json().await.unwrap();
    assert_eq!(doc["auth"]["type"], "bearer");
    assert_eq!(reqwest::Client::new().post(&url).body("{}").send().await.unwrap().status().as_u16(), 401);
    assert_eq!(push(doc["example"].clone()).await, 204);
}
