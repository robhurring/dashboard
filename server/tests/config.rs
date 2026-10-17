use dashboard::config::Config;
use std::path::PathBuf;

fn config(pairs: &[(&str, &str)]) -> Config {
    let pairs: Vec<(String, String)> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    Config::from_lookup(move |k| pairs.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone())).unwrap()
}

#[test]
fn modules_dir_defaults_to_local_then_the_repo_folder() {
    assert_eq!(config(&[]).modules_dirs, vec![PathBuf::from("local/modules"), PathBuf::from("modules")]);
}

#[test]
fn modules_dir_is_a_colon_separated_list_searched_in_order() {
    let c = config(&[("MODULES_DIR", "/app/modules: /srv/mine/modules ::")]);
    assert_eq!(c.modules_dirs, vec![PathBuf::from("/app/modules"), PathBuf::from("/srv/mine/modules")]);
}

#[test]
fn local_application_lua_replaces_the_repos_when_it_exists() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(dashboard::config::default_application_file(dir.path()), dir.path().join("application.lua"));
    std::fs::create_dir_all(dir.path().join("local")).unwrap();
    std::fs::write(dir.path().join("local/application.lua"), "return {}").unwrap();
    assert_eq!(dashboard::config::default_application_file(dir.path()), dir.path().join("local/application.lua"));
}

#[tokio::test]
async fn the_starter_application_lua_in_local_example_loads() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../local.example/application.lua");
    dashboard::dashboard::load(&path).await.unwrap();
}

#[test]
fn libs_dir_defaults_to_local_then_the_repo_lib() {
    assert_eq!(config(&[]).libs_dirs, vec![PathBuf::from("local/lib"), PathBuf::from("lib")]);
}
