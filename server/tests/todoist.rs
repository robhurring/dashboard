//! The todoist module against a stub of the Todoist API: grouping into columns and the three commands.
use axum::{Json, Router, extract::Path, routing::{get, post}};
use dashboard::hub::Hub;
use dashboard::instance::{FetchOutcome, InstanceEvent, InstanceSpec, Limits, spawn};
use dashboard::module_def::ModuleDef;
use dashboard::persist::Persist;
use serde_json::{Value, json};
use std::{path::Path as FsPath, sync::{Arc, Mutex}, time::Duration};

async fn stub(calls: Arc<Mutex<Vec<String>>>) -> String {
    let c = calls.clone();
    let app = Router::new()
        .route("/tasks", get(|| async {
            Json(json!({ "results": [
                { "id": "t1", "content": "Overdue thing", "description": "", "project_id": "p-other", "section_id": null, "priority": 2, "labels": [], "due": { "date": "2000-01-01", "is_recurring": false }, "added_at": "2026-10-01T00:00:00Z", "updated_at": "2026-10-02T00:00:00Z" },
                { "id": "t2", "content": "In progress", "description": "Details **here**", "project_id": "p-board", "section_id": "s-doing", "priority": 4, "labels": ["work"], "due": null, "added_at": "2026-10-01T00:00:00Z", "updated_at": null },
                { "id": "t3", "content": "Inbox item", "description": "", "project_id": "p-inbox", "section_id": null, "priority": 1, "labels": [], "due": { "date": "2999-01-01T09:00:00", "is_recurring": true }, "added_at": null, "updated_at": null },
                { "id": "t4", "content": "Board, no section", "description": "", "project_id": "p-board", "section_id": null, "priority": 3, "labels": [], "due": null, "added_at": null, "updated_at": null },
                { "id": "t5", "content": "Unrelated", "description": "", "project_id": "p-other", "section_id": null, "priority": 1, "labels": [], "due": null, "added_at": null, "updated_at": null }
            ], "next_cursor": null }))
        }))
        .route("/projects", get(|| async {
            Json(json!({ "results": [ { "id": "p-inbox", "name": "Inbox" }, { "id": "p-board", "name": "Board" }, { "id": "p-other", "name": "Errands" } ], "next_cursor": null }))
        }))
        .route("/sections", get(|| async {
            Json(json!({ "results": [ { "id": "s-done", "name": "Done", "project_id": "p-board", "order": 3 }, { "id": "s-doing", "name": "Doing", "project_id": "p-board", "order": 2 }, { "id": "s-x", "name": "Elsewhere", "project_id": "p-other", "order": 1 } ], "next_cursor": null }))
        }))
        .route("/tasks/{id}/{action}", post(move |Path((id, action)): Path<(String, String)>, body: String| {
            let c = c.clone();
            async move { c.lock().unwrap().push(format!("{action} {id} {body}")); Json(json!({})) }
        }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

#[tokio::test]
async fn groups_tasks_into_columns_and_runs_commands() {
    // SAFETY: this binary runs a single test; nothing else reads the environment concurrently.
    unsafe { std::env::set_var("TODOIST_API_TOKEN", "test-todoist-token"); }
    let calls = Arc::new(Mutex::new(Vec::new()));
    let base = stub(calls.clone()).await;

    let real = FsPath::new(env!("CARGO_MANIFEST_DIR")).join("../modules/todoist/module.lua");
    let patched = std::fs::read_to_string(&real).unwrap().replace("https://api.todoist.com/api/v1", &base);
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("todoist")).unwrap();
    let path = dir.path().join("todoist/module.lua");
    std::fs::write(&path, patched).unwrap();
    let def = Arc::new(ModuleDef::load(&path).await.unwrap());
    assert_eq!(def.component.as_deref(), Some("TodoistBoard"));
    assert_eq!(def.commands, vec!["complete", "move", "reopen"]);

    let hub = Hub::new(Persist::memory()).await.unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let services = dashboard::instance::HostServices { sys: dashboard::sysstats::Sampler::start(), persist: Persist::memory() };
    let h = spawn(InstanceSpec { id: "todoist".into(), def: Ok(def), config: json!({ "project": "Board" }) }, hub.clone(), reqwest::Client::new(), Limits::default(), services, tx);
    h.request_fetch();
    match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap() {
        InstanceEvent::FetchFinished { outcome, .. } => assert_eq!(outcome, FetchOutcome::Updated),
        other => panic!("{other:?}"),
    }
    let state = hub.get("todoist").await.unwrap().state;
    assert_eq!(state["project_id"], "p-board");
    assert_eq!(state["total"], 4);
    let cols: Vec<(String, Vec<String>)> = state["columns"].as_array().unwrap().iter()
        .map(|c| (c["key"].as_str().unwrap().to_string(), c["items"].as_array().unwrap().iter().map(|i| i["id"].as_str().unwrap().to_string()).collect()))
        .collect();
    // Backlog: overdue first, then by priority. Sections in Todoist order.
    assert_eq!(cols, vec![
        ("backlog".to_string(), vec!["t1".to_string(), "t4".to_string(), "t3".to_string()]),
        ("Doing".to_string(), vec!["t2".to_string()]),
        ("Done".to_string(), vec![]),
    ]);
    let backlog = &state["columns"][0];
    assert_eq!(backlog["label"], "Backlog");
    assert!(backlog.get("section_id").is_none() || backlog["section_id"].is_null());
    assert_eq!(state["columns"][1]["section_id"], "s-doing");
    let t1 = &backlog["items"][0];
    assert_eq!(t1["overdue"], true);
    assert!(t1["days_overdue"].as_i64().unwrap() > 9000, "{}", t1["days_overdue"]);
    assert_eq!(t1["project_name"], "Errands");
    let t3 = &backlog["items"][2];
    assert_eq!(t3["due"], "2999-01-01");
    assert_eq!(t3["is_recurring"], true);
    assert_eq!(t3["overdue"], false);

    h.command("move".into(), json!({ "id": "t4", "section_id": "s-doing" })).await.unwrap();
    h.command("move".into(), json!({ "id": "t2" })).await.unwrap();
    h.command("complete".into(), json!({ "id": "t1" })).await.unwrap();
    h.command("reopen".into(), json!({ "id": "t1" })).await.unwrap();
    let got = calls.lock().unwrap().clone();
    assert_eq!(got, vec![
        "move t4 {\"section_id\":\"s-doing\"}",
        "move t2 {\"project_id\":\"p-board\"}",
        "close t1 ",
        "reopen t1 ",
    ]);
    // Every command asks for a refetch so the board re-syncs.
    let mut refreshes = 0;
    while let Ok(Some(ev)) = tokio::time::timeout(Duration::from_millis(300), rx.recv()).await {
        if matches!(ev, InstanceEvent::RefreshRequested { .. }) { refreshes += 1; }
    }
    assert_eq!(refreshes, 4);
    let _ = Value::Null;
}
