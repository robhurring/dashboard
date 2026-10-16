use chrono_tz::Tz;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub static_dir: PathBuf,
    pub modules_dir: PathBuf,
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
            modules_dir: var("MODULES_DIR").unwrap_or_else(|| "modules".into()).into(),
            application_file: var("APPLICATION_FILE").unwrap_or_else(|| "application.lua".into()).into(),
            redis_url: var("REDIS_URL"),
            redis_prefix: var("REDIS_PREFIX").unwrap_or_else(|| "dashboard:".into()),
            watch_files: var("DASHBOARD_WATCH").is_some_and(|v| v == "1"),
            timezone,
        })
    }
}
