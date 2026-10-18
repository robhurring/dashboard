use chrono_tz::Tz;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub static_dir: PathBuf,
    /// `MODULES_DIR`: folders of modules, colon-separated, searched like `$PATH`: the first folder that
    /// has a module by a given name wins. Missing folders are skipped.
    pub modules_dirs: Vec<PathBuf>,
    /// `LIBS_DIR`: folders of shared Lua libraries any module can `require`, searched like `$PATH`.
    pub libs_dirs: Vec<PathBuf>,
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
            modules_dirs: path_list(&var("MODULES_DIR").unwrap_or_else(|| "local/modules:modules".into())),
            default_theme: var("DEFAULT_THEME"),
            libs_dirs: path_list(&var("LIBS_DIR").unwrap_or_else(|| "local/lib:lib".into())),
            widgets_dirs: path_list(&var("WIDGETS_DIR").unwrap_or_else(|| "local/widgets".into())),
            // A private overlay's application.lua, when there is one, replaces the repo's.
            application_file: var("APPLICATION_FILE")
                .map(PathBuf::from)
                .unwrap_or_else(|| default_application_file(std::path::Path::new(""))),
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

/// `local/application.lua` under `root` when it exists, else the repo's `application.lua`.
pub fn default_application_file(root: &std::path::Path) -> PathBuf {
    let local = root.join("local/application.lua");
    if local.is_file() { local } else { root.join("application.lua") }
}

/// Loads a `.env` file into the environment if there is one, its values overriding anything already
/// set (a stale export in your shell profile, say); variables it doesn't mention are left alone.
/// Production images have no `.env`, so there it does nothing. Returns whether a file was loaded.
pub fn load_dotenv(path: &std::path::Path) -> bool {
    match dotenvy::from_path_override(path) {
        Ok(()) => true,
        Err(e) if e.not_found() => false,
        Err(e) => {
            eprintln!("warning: could not read {}: {e}", path.display());
            false
        }
    }
}
