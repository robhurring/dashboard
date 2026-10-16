//! Owns every instance. Screens declare instances by watching them; `application.lua` declares
//! the ones that always exist. Tickers run only while watched (or `poll = "always"`), with backoff.
use crate::{
    dashboard::{DashboardConfig, InstanceDecl, Poll, validate_id},
    hub::{Hub, now_secs},
    instance::{self, FetchOutcome, HostServices, InstanceEvent, InstanceHandle, InstanceSpec, Limits},
    module_def::{ModuleDef, ModuleSet},
    protocol::{InstanceInfo, Kind, SlotDecl},
    schedule::Schedule,
};
use chrono_tz::Tz;
use serde_json::{Map, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    sync::{RwLock, mpsc, oneshot},
    time::Instant,
};

pub const GRACE: Duration = Duration::from_secs(120);
pub const CLIENT_REFRESH_LIMIT: Duration = Duration::from_secs(30);
pub const MAX_SLOTS_PER_SESSION: usize = 50;
const BACKOFF_START: Duration = Duration::from_secs(30);

enum Msg {
    Watch { session: u64, slots: Vec<SlotDecl>, done: oneshot::Sender<()> },
    ClientRefresh { id: String },
    Reload { modules: ModuleSet, application: DashboardConfig },
}

type SessionErrors = Arc<RwLock<HashMap<u64, HashMap<String, String>>>>;

#[derive(Clone)]
pub struct SupervisorHandle {
    tx: mpsc::UnboundedSender<Msg>,
    instances: Arc<RwLock<HashMap<String, InstanceHandle>>>,
    session_errors: SessionErrors,
}

impl SupervisorHandle {
    /// Replaces the set of slots a session declares. The returned receiver resolves once applied,
    /// after which `session_errors` is current.
    pub fn watch(&self, session: u64, slots: Vec<SlotDecl>) -> oneshot::Receiver<()> {
        let (done, rx) = oneshot::channel();
        let _ = self.tx.send(Msg::Watch { session, slots, done });
        rx
    }
    pub fn unwatch(&self, session: u64) {
        let _ = self.watch(session, Vec::new());
    }
    pub fn client_refresh(&self, id: String) {
        let _ = self.tx.send(Msg::ClientRefresh { id });
    }
    pub fn reload(&self, modules: ModuleSet, application: DashboardConfig) {
        let _ = self.tx.send(Msg::Reload { modules, application });
    }
    pub async fn instance(&self, id: &str) -> Option<InstanceHandle> {
        self.instances.read().await.get(id).cloned()
    }
    /// Every running instance, sorted by id.
    pub async fn instances(&self) -> Vec<InstanceHandle> {
        let mut all: Vec<InstanceHandle> = self.instances.read().await.values().cloned().collect();
        all.sort_by(|a, b| a.id.cmp(&b.id));
        all
    }
    /// Problems with this session's own declarations (conflicts, unknown modules, too many slots).
    pub async fn session_errors(&self, session: u64) -> HashMap<String, String> {
        self.session_errors.read().await.get(&session).cloned().unwrap_or_default()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Origin {
    /// From application.lua: always exists, its config wins.
    Application,
    /// Declared by screens: exists while declared, plus the grace period.
    Declared,
}

struct Sched {
    handle: InstanceHandle,
    decl: InstanceDecl,
    def: Result<Arc<ModuleDef>, String>,
    origin: Origin,
    /// Sessions currently declaring this instance (declared instances only).
    declared_by: HashSet<u64>,
    watchers: HashSet<u64>,
    idle_since: Option<Instant>,
    drop_after: Option<Instant>,
    next: Option<Instant>,
    failures: u32,
    last_client_refresh: Option<Instant>,
}

impl Sched {
    fn schedule(&self) -> Option<&Schedule> {
        self.def.as_ref().ok().and_then(|d| d.schedule.as_ref())
    }
    fn active(&self, now: Instant) -> bool {
        self.schedule().is_some()
            && (self.decl.poll == Poll::Always
                || !self.watchers.is_empty()
                || self.idle_since.is_some_and(|t| now.duration_since(t) < GRACE))
    }
    fn owner(&self) -> Option<u64> {
        self.declared_by.iter().min().copied()
    }
}

struct Supervisor {
    hub: Arc<Hub>,
    http: reqwest::Client,
    limits: Limits,
    services: HostServices,
    tz: Tz,
    modules: ModuleSet,
    scheds: HashMap<String, Sched>,
    sessions: HashMap<u64, HashSet<String>>,
    session_errors: SessionErrors,
    instances: Arc<RwLock<HashMap<String, InstanceHandle>>>,
    events_tx: mpsc::UnboundedSender<InstanceEvent>,
}

pub async fn start(
    modules: ModuleSet,
    application: DashboardConfig,
    tz: Tz,
    hub: Arc<Hub>,
    http: reqwest::Client,
    limits: Limits,
    services: HostServices,
) -> SupervisorHandle {
    let (tx, rx) = mpsc::unbounded_channel();
    let (events_tx, events_rx) = mpsc::unbounded_channel();
    let instances = Arc::new(RwLock::new(HashMap::new()));
    let session_errors: SessionErrors = Arc::default();
    let mut sup = Supervisor {
        hub,
        http,
        limits,
        services,
        tz,
        modules: ModuleSet::new(),
        scheds: HashMap::new(),
        sessions: HashMap::new(),
        session_errors: session_errors.clone(),
        instances: instances.clone(),
        events_tx,
    };
    sup.apply(modules, application).await;
    tokio::spawn(sup.run(rx, events_rx));
    SupervisorHandle { tx, instances, session_errors }
}

fn same_def(a: &Result<Arc<ModuleDef>, String>, b: &Result<Arc<ModuleDef>, String>) -> bool {
    match (a, b) {
        (Ok(x), Ok(y)) => x.source == y.source && x.path == y.path,
        (Err(x), Err(y)) => x == y,
        _ => false,
    }
}

fn schedule_text(def: &Result<Arc<ModuleDef>, String>) -> Option<String> {
    def.as_ref().ok().and_then(|d| d.schedule.as_ref().map(Schedule::describe))
}

/// Up to `max`, varying per call, so restarts do not fire every upstream at once.
fn jitter(max: Duration) -> Duration {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0) as u64;
    Duration::from_millis(nanos % (max.as_millis() as u64 + 1))
}

/// Slot props that match the module's `config` keys become instance config; `poll` is honoured;
/// everything else is a frame prop the server ignores.
fn split_config(def: &Result<Arc<ModuleDef>, String>, props: &Value) -> (Value, Poll) {
    let mut config = Map::new();
    let mut poll = Poll::Watched;
    let keys: Vec<&str> = def
        .as_ref()
        .ok()
        .map(|d| {
            let declared = d.config.as_object().map(|m| m.keys().map(String::as_str)).into_iter().flatten();
            declared.chain(d.required.iter().map(String::as_str)).collect()
        })
        .unwrap_or_default();
    if let Some(obj) = props.as_object() {
        for (k, v) in obj {
            if k == "poll" {
                if v == "always" {
                    poll = Poll::Always;
                }
                continue;
            }
            if keys.contains(&k.as_str()) {
                config.insert(k.clone(), v.clone());
            }
        }
    }
    (Value::Object(config), poll)
}

impl Supervisor {
    async fn run(mut self, mut rx: mpsc::UnboundedReceiver<Msg>, mut events: mpsc::UnboundedReceiver<InstanceEvent>) {
        loop {
            let now = Instant::now();
            self.expire(now).await;
            let next_tick = self.scheds.values().filter(|s| s.active(now)).filter_map(|s| s.next).min();
            let grace_end = self.scheds.values().filter_map(|s| s.idle_since.map(|t| t + GRACE)).min();
            let drop_at = self.scheds.values().filter_map(|s| s.drop_after).min();
            let wake = [next_tick, grace_end, drop_at].into_iter().flatten().min();
            let sleep = async move {
                match wake {
                    Some(t) => tokio::time::sleep_until(t).await,
                    None => std::future::pending::<()>().await,
                }
            };
            tokio::select! {
                msg = rx.recv() => match msg {
                    Some(m) => self.handle_msg(m).await,
                    None => return,
                },
                Some(ev) = events.recv() => self.handle_event(ev).await,
                _ = sleep => self.fire_due(Instant::now()),
            }
        }
    }

    fn def_for(&self, module: &str) -> Result<Arc<ModuleDef>, String> {
        self.modules.get(module).cloned().unwrap_or_else(|| Err(format!("no module named {module:?} in modules/")))
    }

    async fn spawn(&mut self, decl: InstanceDecl, def: Result<Arc<ModuleDef>, String>, origin: Origin) {
        let id = decl.id.clone();
        let handle = instance::spawn(
            InstanceSpec { id: id.clone(), def: def.clone(), config: decl.config.clone() },
            self.hub.clone(),
            self.http.clone(),
            self.limits,
            self.services.clone(),
            self.events_tx.clone(),
        );
        let prev = self.scheds.remove(&id);
        self.instances.write().await.insert(id.clone(), handle.clone());
        self.scheds.insert(
            id,
            Sched {
                handle,
                decl,
                def,
                origin,
                declared_by: prev.as_ref().map(|p| p.declared_by.clone()).unwrap_or_default(),
                watchers: prev.map(|p| p.watchers).unwrap_or_default(),
                idle_since: None,
                drop_after: None,
                next: None,
                failures: 0,
                last_client_refresh: None,
            },
        );
    }

    /// Applies application.lua. Declared instances are left alone unless the application now claims them.
    async fn apply(&mut self, modules: ModuleSet, application: DashboardConfig) {
        self.modules = modules;
        let mut wanted: HashMap<String, InstanceDecl> = application.instances.into_iter().map(|d| (d.id.clone(), d)).collect();
        // A push-only module needing no config is self-contained: it gets an always-on instance named
        // after itself, so its hooks answer without any application.lua entry.
        for (name, def) in &self.modules {
            let Ok(def) = def else { continue };
            if def.push_only() && def.required.is_empty() && !wanted.contains_key(name) {
                wanted.insert(name.clone(), InstanceDecl { id: name.clone(), module: name.clone(), config: serde_json::Value::Object(Default::default()), poll: Poll::Watched });
            }
        }
        let gone: Vec<String> = self
            .scheds
            .iter()
            .filter(|(id, s)| s.origin == Origin::Application && !wanted.contains_key(*id))
            .map(|(id, _)| id.clone())
            .collect();
        for id in gone {
            self.scheds.remove(&id);
            self.instances.write().await.remove(&id);
        }
        let now = Instant::now();
        let mut start = Vec::new();
        for (id, decl) in wanted {
            let def = self.def_for(&decl.module);
            let existing = self.scheds.get(&id).map(|s| (s.decl.clone(), s.origin, same_def(&s.def, &def)));
            match existing {
                Some((cur, Origin::Application, true)) if cur == decl => {}
                Some((cur, Origin::Application, same)) if cur == decl && !same => {
                    let s = self.scheds.get_mut(&id).expect("exists");
                    let schedule_changed = schedule_text(&s.def) != schedule_text(&def);
                    s.handle.reload(def.clone(), decl.config.clone());
                    s.def = def;
                    s.failures = 0;
                    if schedule_changed {
                        s.next = None;
                        start.push(id.clone());
                    }
                }
                Some((_, _, _)) => {
                    // Config or origin changed: the application's declaration wins.
                    let s = self.scheds.get_mut(&id).expect("exists");
                    s.handle.reload(def.clone(), decl.config.clone());
                    s.def = def;
                    s.decl = decl;
                    s.origin = Origin::Application;
                    s.drop_after = None;
                    s.failures = 0;
                    s.next = None;
                    start.push(id.clone());
                }
                None => {
                    self.spawn(decl, def, Origin::Application).await;
                    start.push(id.clone());
                }
            }
        }
        // Reload declared instances whose module source changed on disk.
        let changed: Vec<(String, Result<Arc<ModuleDef>, String>)> = self
            .scheds
            .iter()
            .filter(|(_, s)| s.origin == Origin::Declared)
            .filter_map(|(id, s)| {
                let def = self.def_for(&s.decl.module);
                (!same_def(&s.def, &def)).then(|| (id.clone(), def))
            })
            .collect();
        for (id, def) in changed {
            let s = self.scheds.get_mut(&id).expect("exists");
            let schedule_changed = schedule_text(&s.def) != schedule_text(&def);
            s.handle.reload(def.clone(), s.decl.config.clone());
            s.def = def;
            s.failures = 0;
            if schedule_changed {
                s.next = None;
                start.push(id);
            }
        }
        for id in start {
            self.start_ticking(&id, now, true).await;
        }
        self.publish_catalog().await;
    }

    async fn publish_catalog(&self) {
        let mut catalog: Vec<InstanceInfo> = self
            .scheds
            .iter()
            .map(|(id, s)| InstanceInfo {
                id: id.clone(),
                module: s.decl.module.clone(),
                kind: s.def.as_ref().map(|d| d.kind()).unwrap_or(Kind::View),
                component: s.def.as_ref().ok().and_then(|d| d.component.clone()),
                title: s.def.as_ref().ok().and_then(|d| d.title.clone()),
                icon: s.def.as_ref().ok().and_then(|d| d.icon.clone()),
                push_only: s.def.as_ref().map(|d| d.push_only()).unwrap_or(false),
            })
            .collect();
        catalog.sort_by(|a, b| a.id.cmp(&b.id));
        self.hub.set_catalog(catalog).await;
    }

    /// Starts the ticker for an instance that just became active: fetch now if stale, else schedule.
    async fn start_ticking(&mut self, id: &str, now: Instant, with_jitter: bool) {
        let Some(s) = self.scheds.get(id) else { return };
        if !s.active(now) || s.next.is_some() {
            return;
        }
        let Some(schedule) = s.schedule().cloned() else { return };
        let stale_after = s.def.as_ref().map(|d| d.stale_after).unwrap_or_default();
        let fetched_at = self.hub.get(id).await.and_then(|st| st.status.fetched_at);
        let fresh_since = fetched_at.filter(|t| Duration::from_secs((now_secs() - t).max(0) as u64) < stale_after);
        match fresh_since {
            None => self.kick(id),
            Some(t) => {
                let last = chrono::DateTime::from_timestamp(t, 0).unwrap_or_else(chrono::Utc::now);
                let mut delay = (schedule.next_after(last, self.tz) - chrono::Utc::now()).to_std().unwrap_or(Duration::ZERO);
                if with_jitter {
                    delay += jitter(schedule.interval_hint() / 10);
                }
                if let Some(s) = self.scheds.get_mut(id) {
                    s.next = Some(now + delay);
                    tracing::info!(instance = id, in_secs = delay.as_secs(), "fresh in cache; next tick scheduled");
                }
            }
        }
    }

    fn kick(&mut self, id: &str) {
        if let Some(s) = self.scheds.get_mut(id) {
            s.next = None;
            if s.handle.request_fetch() {
                tracing::debug!(instance = id, "fetch queued");
            } else {
                tracing::debug!(instance = id, "fetch merged into the one already running");
            }
        }
    }

    /// Grace expiry: stop idle tickers and drop declared instances nobody declares any more.
    async fn expire(&mut self, now: Instant) {
        let mut dropped = Vec::new();
        for (id, s) in self.scheds.iter_mut() {
            if s.idle_since.is_some_and(|t| now.duration_since(t) >= GRACE) {
                s.idle_since = None;
                if !s.active(now) {
                    s.next = None;
                    tracing::info!(instance = %id, "ticker stopped: no watchers for the grace period");
                }
            }
            if s.origin == Origin::Declared && s.declared_by.is_empty() && s.drop_after.is_some_and(|t| t <= now) {
                dropped.push(id.clone());
            }
        }
        if dropped.is_empty() {
            return;
        }
        for id in &dropped {
            tracing::info!(instance = %id, "dropped: no screen declares it");
            self.scheds.remove(id);
            self.instances.write().await.remove(id);
        }
        self.publish_catalog().await;
    }

    fn fire_due(&mut self, now: Instant) {
        let due: Vec<String> = self
            .scheds
            .iter()
            .filter(|(_, s)| s.active(now) && s.next.is_some_and(|t| t <= now))
            .map(|(id, _)| id.clone())
            .collect();
        for id in due {
            self.kick(&id);
        }
    }

    async fn handle_watch(&mut self, session: u64, slots: Vec<SlotDecl>) {
        let now = Instant::now();
        let mut errors: HashMap<String, String> = HashMap::new();
        let before = self.sessions.remove(&session).unwrap_or_default();
        let mut after: HashSet<String> = HashSet::new();
        let mut newly_watched = Vec::new();
        let mut catalog_changed = false;

        let total = slots.len();
        for (i, slot) in slots.into_iter().enumerate() {
            if i >= MAX_SLOTS_PER_SESSION {
                errors.insert(slot.id, format!("this screen declares {total} slots; at most {MAX_SLOTS_PER_SESSION} are allowed"));
                continue;
            }
            if let Err(e) = validate_id(&slot.id) {
                errors.insert(slot.id.clone(), e);
                continue;
            }
            if !self.modules.contains_key(&slot.module) {
                errors.insert(slot.id.clone(), format!("no module named {:?} in modules/", slot.module));
                continue;
            }
            let def = self.def_for(&slot.module);
            let (config, poll) = split_config(&def, &slot.props);
            match self.scheds.get_mut(&slot.id) {
                None => {
                    let decl = InstanceDecl { id: slot.id.clone(), module: slot.module.clone(), config, poll };
                    self.spawn(decl, def, Origin::Declared).await;
                    self.scheds.get_mut(&slot.id).expect("just spawned").declared_by.insert(session);
                    catalog_changed = true;
                    tracing::info!(instance = %slot.id, session, "instance declared by a screen");
                }
                Some(s) if s.origin == Origin::Application => {}
                Some(s) => {
                    let differs = s.decl.config != config || s.decl.poll != poll;
                    let others: Vec<u64> = s.declared_by.iter().copied().filter(|x| *x != session).collect();
                    if differs && others.is_empty() {
                        tracing::info!(instance = %slot.id, session, "declaration changed; reloading with new config");
                        s.decl.config = config;
                        s.decl.poll = poll;
                        s.handle.reload(def, s.decl.config.clone());
                        s.failures = 0;
                        s.next = None;
                        s.declared_by.insert(session);
                        s.drop_after = None;
                        s.handle.request_fetch();
                    } else if differs {
                        let owner = s.owner().unwrap_or(others[0]);
                        errors.insert(
                            slot.id.clone(),
                            format!(
                                "this screen asks for config {} but session {owner} already runs {} with {}; the first declaration wins",
                                config, slot.id, s.decl.config
                            ),
                        );
                        s.declared_by.insert(session);
                        s.drop_after = None;
                    } else {
                        s.declared_by.insert(session);
                        s.drop_after = None;
                    }
                }
            }
            after.insert(slot.id.clone());
            if let Some(s) = self.scheds.get_mut(&slot.id) {
                // Watchers are sessions showing the slot; only they keep the ticker running.
                if slot.visible {
                    let was_unwatched = s.watchers.is_empty();
                    s.watchers.insert(session);
                    if was_unwatched {
                        s.idle_since = None;
                        newly_watched.push(slot.id.clone());
                        tracing::info!(instance = %slot.id, session, "first watcher; ticker active");
                    }
                } else if s.watchers.remove(&session) && s.watchers.is_empty() {
                    s.idle_since = Some(now);
                    tracing::info!(instance = %slot.id, session, grace_secs = GRACE.as_secs(), "slot hidden; ticker stops after grace");
                }
            }
        }

        for id in before.difference(&after) {
            if let Some(s) = self.scheds.get_mut(id) {
                s.watchers.remove(&session);
                s.declared_by.remove(&session);
                if s.watchers.is_empty() {
                    s.idle_since = Some(now);
                    tracing::info!(instance = %id, session, grace_secs = GRACE.as_secs(), "last watcher left; ticker stops after grace");
                }
                if s.origin == Origin::Declared && s.declared_by.is_empty() {
                    s.drop_after = Some(now + GRACE);
                }
            }
        }
        if !after.is_empty() {
            self.sessions.insert(session, after);
        }
        {
            let mut all = self.session_errors.write().await;
            if errors.is_empty() {
                all.remove(&session);
            } else {
                all.insert(session, errors);
            }
        }
        for id in newly_watched {
            self.start_ticking(&id, now, false).await;
        }
        if catalog_changed {
            self.publish_catalog().await;
        }
    }

    async fn handle_msg(&mut self, msg: Msg) {
        match msg {
            Msg::Watch { session, slots, done } => {
                self.handle_watch(session, slots).await;
                let _ = done.send(());
            }
            Msg::ClientRefresh { id } => {
                let now = Instant::now();
                let Some(s) = self.scheds.get_mut(&id) else { return };
                if s.last_client_refresh.is_some_and(|t| now.duration_since(t) < CLIENT_REFRESH_LIMIT) {
                    tracing::debug!(instance = %id, "client refresh ignored: rate limited");
                    return;
                }
                s.last_client_refresh = Some(now);
                tracing::info!(instance = %id, "client refresh");
                self.kick(&id);
            }
            Msg::Reload { modules, application } => self.apply(modules, application).await,
        }
    }

    async fn handle_event(&mut self, ev: InstanceEvent) {
        match ev {
            InstanceEvent::RefreshRequested { id } => self.kick(&id),
            InstanceEvent::FetchFinished { id, outcome } => {
                let now = Instant::now();
                let tz = self.tz;
                let Some(s) = self.scheds.get_mut(&id) else { return };
                let Some(schedule) = s.schedule().cloned() else { return };
                let failed = matches!(outcome, FetchOutcome::Failed(_));
                let delay = if failed {
                    s.failures += 1;
                    let backoff = BACKOFF_START.saturating_mul(2u32.saturating_pow((s.failures - 1).min(10)));
                    backoff.min(schedule.interval_hint())
                } else {
                    s.failures = 0;
                    let wall_now = chrono::Utc::now();
                    (schedule.next_after(wall_now, tz) - wall_now).to_std().unwrap_or(Duration::ZERO)
                };
                s.next = if s.active(now) { Some(now + delay) } else { None };
                match (&outcome, s.next) {
                    (FetchOutcome::Failed(_), Some(_)) => tracing::warn!(instance = %id, failures = s.failures, retry_in_secs = delay.as_secs(), "backing off"),
                    (_, Some(_)) => tracing::debug!(instance = %id, next_in_secs = delay.as_secs(), "next tick scheduled"),
                    (_, None) => tracing::debug!(instance = %id, "not rescheduled: no watchers"),
                }
                if failed && s.next.is_some() {
                    let retry_at = now_secs() + delay.as_secs() as i64;
                    self.hub.update_status(&id, |st| st.retry_at = Some(retry_at)).await;
                }
            }
        }
    }
}
