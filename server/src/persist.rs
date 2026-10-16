//! Where instance state lives between restarts.
use crate::hub::Stored;
use redis::{AsyncCommands, aio::MultiplexedConnection};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::Mutex;

/// Every saved key expires unless it is written again, so Redis cannot accumulate forgotten
/// state. Live instances are re-saved on every change; a push-only instance nobody writes to
/// for this long is stale anyway. Removed instances get the shorter TTL below.
pub const DEFAULT_TTL_SECS: i64 = 30 * 24 * 3600;
pub const REMOVED_TTL_SECS: i64 = 7 * 24 * 3600;

#[derive(Debug, Clone, serde::Serialize)]
pub struct RedisInfo {
    pub used_mb: f64,
    pub max_mb: f64,
    pub keys: u64,
    pub version: String,
    pub uptime_secs: u64,
}

#[derive(Clone)]
pub enum Persist {
    Redis { con: MultiplexedConnection, prefix: String },
    Memory(Arc<Mutex<HashMap<String, String>>>),
}

impl Persist {
    pub async fn redis(url: &str, prefix: &str) -> anyhow::Result<Self> {
        let client = redis::Client::open(url)?;
        let con = tokio::time::timeout(Duration::from_secs(5), client.get_multiplexed_async_connection())
            .await
            .map_err(|_| anyhow::anyhow!("redis did not answer within 5s"))??;
        Ok(Persist::Redis { con, prefix: prefix.to_string() })
    }

    pub fn memory() -> Self {
        Persist::Memory(Arc::default())
    }

    /// Read-only server statistics. `None` when the host is not using Redis.
    pub async fn redis_info(&self) -> anyhow::Result<Option<RedisInfo>> {
        let Persist::Redis { con, .. } = self else { return Ok(None) };
        let mut con = con.clone();
        let memory: redis::InfoDict = redis::cmd("INFO").arg("memory").query_async(&mut con).await?;
        let server: redis::InfoDict = redis::cmd("INFO").arg("server").query_async(&mut con).await?;
        let keys: u64 = redis::cmd("DBSIZE").query_async(&mut con).await?;
        Ok(Some(RedisInfo {
            used_mb: memory.get::<u64>("used_memory").unwrap_or(0) as f64 / 1_048_576.0,
            max_mb: memory.get::<u64>("maxmemory").unwrap_or(0) as f64 / 1_048_576.0,
            keys,
            version: server.get::<String>("redis_version").unwrap_or_default(),
            uptime_secs: server.get::<u64>("uptime_in_seconds").unwrap_or(0),
        }))
    }

    fn key(prefix: &str, id: &str) -> String {
        format!("{prefix}inst:{id}")
    }

    pub async fn load_all(&self) -> anyhow::Result<HashMap<String, Stored>> {
        let mut out = HashMap::new();
        match self {
            Persist::Redis { con, prefix } => {
                let mut con = con.clone();
                let keys: Vec<String> = con.keys(format!("{prefix}inst:*")).await?;
                for key in keys {
                    let raw: Option<String> = con.get(&key).await?;
                    let Some(raw) = raw else { continue };
                    match serde_json::from_str::<Stored>(&raw) {
                        Ok(s) => {
                            out.insert(key[prefix.len() + "inst:".len()..].to_string(), s);
                        }
                        Err(e) => tracing::warn!(%key, error = %e, "skipping unreadable stored state"),
                    }
                }
            }
            Persist::Memory(m) => {
                for (k, raw) in m.lock().await.iter() {
                    out.insert(k.clone(), serde_json::from_str(raw)?);
                }
            }
        }
        Ok(out)
    }

    /// Saves state with the default TTL, which also replaces any shorter expiry from an earlier removal.
    pub async fn save(&self, id: &str, s: &Stored) -> anyhow::Result<()> {
        let raw = serde_json::to_string(s)?;
        match self {
            Persist::Redis { con, prefix } => {
                let mut con = con.clone();
                let _: () = con.set_ex(Self::key(prefix, id), raw, DEFAULT_TTL_SECS as u64).await?;
            }
            Persist::Memory(m) => {
                m.lock().await.insert(id.to_string(), raw);
            }
        }
        Ok(())
    }

    /// Remaining lifetime of an instance's key in seconds (`None` when the key does not exist or never expires).
    pub async fn ttl_secs(&self, id: &str) -> anyhow::Result<Option<i64>> {
        match self {
            Persist::Redis { con, prefix } => {
                let mut con = con.clone();
                let ttl: i64 = con.ttl(Self::key(prefix, id)).await?;
                Ok((ttl >= 0).then_some(ttl))
            }
            Persist::Memory(_) => Ok(None),
        }
    }

    pub async fn expire_removed(&self, id: &str) -> anyhow::Result<()> {
        match self {
            Persist::Redis { con, prefix } => {
                let mut con = con.clone();
                let _: () = con.expire(Self::key(prefix, id), REMOVED_TTL_SECS).await?;
            }
            Persist::Memory(m) => {
                m.lock().await.remove(id);
            }
        }
        Ok(())
    }
}
