use chrono_tz::Tz;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub static_dir: PathBuf,
    /// `MODULES_DIR`: folders of modules, colon-separated, in override order: a module in a later folder
    /// replaces one with the same name in an earlier folder. Missing folders are skipped.
    pub modules_dirs: Vec<PathBuf>,
    /// `WIDGETS_DIR`: folders of custom widgets (`<name>.tsx`), colon-separated. Default `local/widgets`.
    pub widgets_dirs: Vec<PathBuf>,
    /// `DEFAULT_THEME`: the theme a screen opens without `?theme=`. Unset: the web build's choice (home).
    pub default_theme: Option<String>,
    pub application_file: PathBuf,
    pub redis_url: Option<String>,
    pub redis_prefix: String,
    pub watch_files: bool,
    /// `TZ`: the zone cron schedules run in. System settings come from the environment, not application.lua.
    pub timezone: Tz,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Self::from_lookup(|k| std::env::var(k).ok())
    }

    /// Builds config from any key lookup, so tests never touch the process environment.
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> anyhow::Result<Self> {
        let var = |k: &str| get(k).filter(|v| !v.is_empty());
        let port = match var("PORT") {
            Some(p) => p.parse().map_err(|_| anyhow::anyhow!("PORT must be a number, got {p:?}"))?,
            None => 5000,
        };
        let timezone = match var("TZ") {
            Some(tz) => tz.parse::<Tz>().map_err(|_| anyhow::anyhow!("TZ must be an IANA zone like America/New_York, got {tz:?}"))?,
            None => chrono_tz::UTC,
        };
        Ok(Self {
            port,
            static_dir: var("STATIC_DIR").unwrap_or_else(|| "web/dist".into()).into(),
            modules_dirs: path_list(&var("MODULES_DIR").unwrap_or_else(|| "modules:local/modules".into())),
            default_theme: var("DEFAULT_THEME"),
            widgets_dirs: path_list(&var("WIDGETS_DIR").unwrap_or_else(|| "local/widgets".into())),
            // A private overlay's application.lua, when there is one, replaces the repo's.
            application_file: var("APPLICATION_FILE")
                .unwrap_or_else(|| if std::path::Path::new("local/application.lua").is_file() { "local/application.lua".into() } else { "application.lua".into() })
                .into(),
            redis_url: var("REDIS_URL"),
            redis_prefix: var("REDIS_PREFIX").unwrap_or_else(|| "dashboard:".into()),
            watch_files: var("DASHBOARD_WATCH").is_some_and(|v| v == "1"),
            timezone,
        })
    }
}

/// "a:b: c::" -> [a, b, c]
pub fn path_list(value: &str) -> Vec<PathBuf> {
    value.split(':').map(str::trim).filter(|p| !p.is_empty()).map(PathBuf::from).collect()
}
