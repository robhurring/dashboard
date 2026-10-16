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
