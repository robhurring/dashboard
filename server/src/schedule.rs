use crate::duration::parse_duration;
use chrono::{DateTime, TimeDelta, Utc};
use chrono_tz::Tz;
use std::{fmt, str::FromStr, sync::Arc, time::Duration};

#[derive(Clone)]
pub enum Schedule {
    Every { text: String, every: Duration },
    Cron { text: String, cron: Arc<croner::Cron> },
}

impl fmt::Debug for Schedule {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.describe())
    }
}

impl Schedule {
    pub fn every(text: &str) -> Result<Self, String> {
        Ok(Schedule::Every { text: text.to_string(), every: parse_duration(text)? })
    }

    pub fn cron(text: &str) -> Result<Self, String> {
        let cron = croner::Cron::from_str(text).map_err(|e| format!("cron {text:?}: {e}"))?;
        Ok(Schedule::Cron { text: text.to_string(), cron: Arc::new(cron) })
    }

    /// The next run strictly after `after`, evaluated in `tz` for cron schedules.
    pub fn next_after(&self, after: DateTime<Utc>, tz: Tz) -> DateTime<Utc> {
        match self {
            Schedule::Every { every, .. } => after + TimeDelta::from_std(*every).unwrap_or(TimeDelta::hours(1)),
            Schedule::Cron { cron, text } => cron
                .find_next_occurrence(&after.with_timezone(&tz), false)
                .map(|t| t.with_timezone(&Utc))
                .unwrap_or_else(|e| {
                    tracing::warn!(cron = %text, error = %e, "cron has no next occurrence; retrying in a day");
                    after + TimeDelta::days(1)
                }),
        }
    }

    /// Typical gap between runs; caps failure backoff.
    pub fn interval_hint(&self) -> Duration {
        match self {
            Schedule::Every { every, .. } => *every,
            Schedule::Cron { .. } => Duration::from_secs(3600),
        }
    }

    pub fn default_stale_after(&self) -> Duration {
        match self {
            Schedule::Every { every, .. } => *every * 2,
            Schedule::Cron { .. } => Duration::from_secs(3600),
        }
    }

    pub fn describe(&self) -> String {
        match self {
            Schedule::Every { text, .. } => format!("every {text}"),
            Schedule::Cron { text, .. } => format!("cron {text}"),
        }
    }
}
