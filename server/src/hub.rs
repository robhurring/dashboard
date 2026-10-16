//! Current state of every instance, its rev, and change notifications.
use crate::{
    persist::Persist,
    protocol::{InstanceInfo, Kind, Status},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};
use tokio::sync::{RwLock, broadcast};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stored {
    pub rev: u64,
    pub kind: Kind,
    pub state: Value,
    #[serde(default)]
    pub config: Value,
    pub view: Option<Value>,
    pub component: Option<String>,
    pub status: Status,
    pub updated_at: i64,
}

impl Stored {
    pub fn empty(kind: Kind) -> Self {
        Self { rev: 0, kind, state: Value::Null, config: Value::Null, view: None, component: None, status: Status::default(), updated_at: 0 }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum HubEvent {
    Snapshot(String),
    Status(String),
    Removed(String),
    Catalog,
}

pub fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

pub struct Hub {
    entries: RwLock<HashMap<String, Stored>>,
    catalog: RwLock<Vec<InstanceInfo>>,
    tx: broadcast::Sender<HubEvent>,
    persist: Persist,
}

impl Hub {
    pub async fn new(persist: Persist) -> anyhow::Result<Arc<Self>> {
        let entries = persist.load_all().await?;
        let (tx, _) = broadcast::channel(1024);
        Ok(Arc::new(Self { entries: RwLock::new(entries), catalog: RwLock::new(Vec::new()), tx, persist }))
    }

    pub fn subscribe(&self) -> broadcast::Receiver<HubEvent> {
        self.tx.subscribe()
    }

    pub async fn catalog(&self) -> Vec<InstanceInfo> {
        self.catalog.read().await.clone()
    }

    pub async fn get(&self, id: &str) -> Option<Stored> {
        self.entries.read().await.get(id).cloned()
    }

    /// Replaces the catalog. Instances no longer listed are dropped; their stored state expires in 7 days.
    pub async fn set_catalog(&self, infos: Vec<InstanceInfo>) {
        tracing::info!(instances = ?infos.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), "catalog set");
        let keep: HashSet<String> = infos.iter().map(|i| i.id.clone()).collect();
        let removed: Vec<String> = {
            let entries = self.entries.read().await;
            entries.keys().filter(|k| !keep.contains(*k)).cloned().collect()
        };
        for id in removed {
            self.entries.write().await.remove(&id);
            if let Err(e) = self.persist.expire_removed(&id).await {
                tracing::warn!(instance = %id, error = %e, "could not expire removed state");
            }
            let _ = self.tx.send(HubEvent::Removed(id));
        }
        *self.catalog.write().await = infos;
        let _ = self.tx.send(HubEvent::Catalog);
    }

    /// Stores new state for an instance. Returns the new rev, or `None` if the data did not change.
    pub async fn publish(
        &self,
        id: &str,
        kind: Kind,
        component: Option<String>,
        config: Value,
        state: Value,
        view: Option<Value>,
        update: impl FnOnce(&mut Status),
    ) -> Option<u64> {
        let mut entries = self.entries.write().await;
        let entry = entries.entry(id.to_string()).or_insert_with(|| Stored::empty(kind));
        let mut status = entry.status.clone();
        update(&mut status);
        let changed = entry.rev == 0
            || entry.state != state
            || entry.view != view
            || entry.kind != kind
            || entry.component != component
            || entry.config != config;
        let status_changed = entry.status != status;
        if !changed && !status_changed {
            return None;
        }
        if changed {
            entry.rev += 1;
            entry.state = state;
            entry.view = view;
            entry.kind = kind;
            entry.component = component;
            entry.config = config;
            entry.updated_at = now_secs();
        }
        entry.status = status;
        let snapshot = entry.clone();
        drop(entries);
        if changed {
            tracing::info!(instance = id, rev = snapshot.rev, subscribers = self.tx.receiver_count(), "state published");
        }
        self.save(id, &snapshot).await;
        let _ = self.tx.send(if changed { HubEvent::Snapshot(id.to_string()) } else { HubEvent::Status(id.to_string()) });
        changed.then_some(snapshot.rev)
    }

    pub async fn update_status(&self, id: &str, update: impl FnOnce(&mut Status)) {
        let mut entries = self.entries.write().await;
        let entry = entries.entry(id.to_string()).or_insert_with(|| Stored::empty(Kind::View));
        let before = entry.status.clone();
        update(&mut entry.status);
        if entry.status == before {
            return;
        }
        let snapshot = entry.clone();
        drop(entries);
        self.save(id, &snapshot).await;
        let _ = self.tx.send(HubEvent::Status(id.to_string()));
    }

    async fn save(&self, id: &str, s: &Stored) {
        if let Err(e) = self.persist.save(id, s).await {
            tracing::error!(instance = id, error = %e, "failed to persist state");
        }
    }
}
