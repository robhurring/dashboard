//! One actor per instance: its own Lua VM and a serial job queue.
use crate::{
    dashboard::merge_config,
    host_api::{CallContext, build_ctx},
    hub::{Hub, now_secs},
    lua_vm::{Vm, to_lua},
    module_def::ModuleDef,
    protocol::Status,
    widgets::normalize_tree,
};
use mlua::{Function, RegistryKey, Table, Value as LuaValue};
use serde_json::Value;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::sync::{mpsc, oneshot};

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub fetch: Duration,
    pub command: Duration,
    pub view: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self { fetch: Duration::from_secs(20), command: Duration::from_secs(10), view: Duration::from_secs(1) }
    }
}

/// Host-provided services every module call can reach through `ctx`.
#[derive(Clone)]
pub struct HostServices {
    pub sys: crate::sysstats::Sampler,
    pub persist: crate::persist::Persist,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FetchOutcome {
    Updated,
    Unchanged,
    Failed(String),
    Skipped,
}

#[derive(Debug)]
pub enum InstanceEvent {
    FetchFinished { id: String, outcome: FetchOutcome },
    RefreshRequested { id: String },
}

pub struct InstanceSpec {
    pub id: String,
    pub def: Result<Arc<ModuleDef>, String>,
    /// Instance overrides merged over the module's `config` defaults.
    pub config: Value,
}

enum Job {
    Fetch,
    Command { action: String, args: Value, reply: oneshot::Sender<Result<(), String>> },
    Reload { def: Result<Arc<ModuleDef>, String>, config: Value },
    Hook {
        name: String,
        headers: std::collections::HashMap<String, String>,
        body: bytes::Bytes,
        reply: oneshot::Sender<Result<(), crate::hooks::HookError>>,
    },
}

#[derive(Clone)]
pub struct InstanceHandle {
    pub id: String,
    tx: mpsc::UnboundedSender<Job>,
    fetch_pending: Arc<AtomicBool>,
    current_def: Arc<std::sync::RwLock<Option<Arc<ModuleDef>>>>,
}

impl InstanceHandle {
    /// Queues a fetch unless one is already queued or running. Returns false when merged.
    pub fn request_fetch(&self) -> bool {
        if self.fetch_pending.swap(true, Ordering::SeqCst) {
            return false;
        }
        if self.tx.send(Job::Fetch).is_err() {
            self.fetch_pending.store(false, Ordering::SeqCst);
            return false;
        }
        true
    }

    pub async fn command(&self, action: String, args: Value) -> Result<(), String> {
        let (reply, rx) = oneshot::channel();
        self.tx.send(Job::Command { action, args, reply }).map_err(|_| "instance stopped".to_string())?;
        rx.await.map_err(|_| "instance stopped".to_string())?
    }

    /// Runs a webhook: auth checked against the module's declaration, then `handle(ctx, req)` on this instance's queue.
    pub async fn hook(&self, name: String, headers: std::collections::HashMap<String, String>, body: bytes::Bytes) -> Result<(), crate::hooks::HookError> {
        let (reply, rx) = oneshot::channel();
        self.tx.send(Job::Hook { name, headers, body, reply }).map_err(|_| crate::hooks::HookError::NotFound)?;
        rx.await.map_err(|_| crate::hooks::HookError::NotFound)?
    }

    /// The module definition this instance currently runs, if it loaded.
    pub fn def(&self) -> Option<Arc<ModuleDef>> {
        self.current_def.read().ok().and_then(|d| d.clone())
    }

    pub fn reload(&self, def: Result<Arc<ModuleDef>, String>, config: Value) {
        let _ = self.tx.send(Job::Reload { def, config });
    }
}

pub fn spawn(
    spec: InstanceSpec,
    hub: Arc<Hub>,
    http: reqwest::Client,
    limits: Limits,
    services: HostServices,
    events: mpsc::UnboundedSender<InstanceEvent>,
) -> InstanceHandle {
    let (tx, rx) = mpsc::unbounded_channel();
    let fetch_pending = Arc::new(AtomicBool::new(false));
    let current_def = Arc::new(std::sync::RwLock::new(None));
    let handle = InstanceHandle { id: spec.id.clone(), tx, fetch_pending: fetch_pending.clone(), current_def: current_def.clone() };
    let actor = Actor { id: spec.id, hub, http, limits, services, events, loaded: None, load_error: None, hook_rate: Default::default(), current_def: current_def.clone() };
    tokio::spawn(actor.run(spec.def, spec.config, rx, fetch_pending));
    handle
}

struct Loaded {
    def: Arc<ModuleDef>,
    vm: Vm,
    module: RegistryKey,
    config: Value,
}

struct Actor {
    id: String,
    hub: Arc<Hub>,
    http: reqwest::Client,
    limits: Limits,
    services: HostServices,
    events: mpsc::UnboundedSender<InstanceEvent>,
    loaded: Option<Loaded>,
    load_error: Option<String>,
    hook_rate: crate::hooks::RateLimit,
    /// The loaded module definition, shared with the handle so routes can describe hooks.
    current_def: Arc<std::sync::RwLock<Option<Arc<ModuleDef>>>>,
}

/// Webhook calls allowed per instance per minute.
const HOOKS_PER_MINUTE: usize = 60;

impl Actor {
    async fn run(
        mut self,
        def: Result<Arc<ModuleDef>, String>,
        config: Value,
        mut rx: mpsc::UnboundedReceiver<Job>,
        fetch_pending: Arc<AtomicBool>,
    ) {
        self.reload(def, &config).await;
        while let Some(job) = rx.recv().await {
            match job {
                Job::Fetch => {
                    let started = std::time::Instant::now();
                    tracing::debug!(instance = %self.id, "fetch started");
                    let outcome = self.fetch().await;
                    let ms = started.elapsed().as_millis();
                    match &outcome {
                        FetchOutcome::Updated => tracing::info!(instance = %self.id, ms, "fetch updated state"),
                        FetchOutcome::Unchanged => tracing::info!(instance = %self.id, ms, "fetch unchanged"),
                        FetchOutcome::Skipped => tracing::debug!(instance = %self.id, "fetch skipped: module has no fetch"),
                        FetchOutcome::Failed(e) => tracing::warn!(instance = %self.id, ms, error = %e, "fetch failed"),
                    }
                    fetch_pending.store(false, Ordering::SeqCst);
                    let _ = self.events.send(InstanceEvent::FetchFinished { id: self.id.clone(), outcome });
                }
                Job::Command { action, args, reply } => {
                    let started = std::time::Instant::now();
                    let result = self.command(&action, args).await;
                    match &result {
                        Ok(()) => tracing::info!(instance = %self.id, %action, ms = started.elapsed().as_millis(), "command ok"),
                        Err(e) => tracing::warn!(instance = %self.id, %action, error = %e, "command failed"),
                    }
                    let _ = reply.send(result);
                }
                Job::Reload { def, config } => self.reload(def, &config).await,
                Job::Hook { name, headers, body, reply } => {
                    let started = std::time::Instant::now();
                    let result = self.hook(&name, headers, body).await;
                    match &result {
                        Ok(()) => tracing::info!(instance = %self.id, hook = %name, ms = started.elapsed().as_millis(), "hook ok"),
                        Err(e) => tracing::warn!(instance = %self.id, hook = %name, error = ?e, "hook refused or failed"),
                    }
                    let _ = reply.send(result);
                }
            }
        }
    }

    fn not_loaded(&self) -> String {
        self.load_error.clone().unwrap_or_else(|| "module not loaded".into())
    }

    /// Loads a new module version. On failure the previous version keeps running.
    async fn reload(&mut self, def: Result<Arc<ModuleDef>, String>, overrides: &Value) {
        let result = match def {
            Ok(def) => load(def, overrides).await,
            Err(e) => Err(e),
        };
        match result {
            Ok(new) => {
                tracing::info!(instance = %self.id, module = %new.def.name, schedule = ?new.def.schedule, "module loaded");
                self.load_error = None;
                self.hub.update_status(&self.id, |s| s.load_error = None).await;
                if let Ok(mut d) = self.current_def.write() { *d = Some(new.def.clone()); }
                self.loaded = Some(new);
                // Re-render existing state so view edits appear without a fetch.
                if let Some(cur) = self.hub.get(&self.id).await.filter(|c| c.rev > 0) {
                    if let Err(e) = self.publish(cur.state, |_| {}).await {
                        self.hub.update_status(&self.id, |s| { s.ok = false; s.error = Some(e); }).await;
                    }
                }
            }
            Err(e) => {
                tracing::warn!(instance = %self.id, error = %e, "module failed to load; keeping the previous version");
                self.load_error = Some(e.clone());
                self.hub.update_status(&self.id, |s| s.load_error = Some(e)).await;
            }
        }
    }

    async fn fetch(&self) -> FetchOutcome {
        let Some(l) = &self.loaded else { return FetchOutcome::Failed(self.not_loaded()) };
        if !l.def.has_fetch {
            return FetchOutcome::Skipped;
        }
        self.hub.update_status(&self.id, |s| s.loading = true).await;
        let state = self.current_state().await;
        let refresh = Arc::new(AtomicBool::new(false));
        let succeeded = |s: &mut Status| {
            s.loading = false;
            s.ok = true;
            s.error = None;
            s.retry_at = None;
            s.fetched_at = Some(now_secs());
        };
        let result = match module_fn(l, "fetch") {
            Ok(f) => self.call(l, f, state, None, &refresh, self.limits.fetch).await,
            Err(e) => Err(e),
        };
        let outcome = match result {
            Ok(None) => {
                self.hub.update_status(&self.id, succeeded).await;
                Ok(FetchOutcome::Unchanged)
            }
            Ok(Some(new_state)) => self
                .publish(new_state, succeeded)
                .await
                .map(|changed| if changed { FetchOutcome::Updated } else { FetchOutcome::Unchanged }),
            Err(e) => Err(e),
        };
        match outcome {
            Ok(o) => o,
            Err(e) => {
                self.hub
                    .update_status(&self.id, |s| {
                        s.loading = false;
                        s.ok = false;
                        s.error = Some(e.clone());
                    })
                    .await;
                FetchOutcome::Failed(e)
            }
        }
    }

    async fn hook(&mut self, name: &str, headers: std::collections::HashMap<String, String>, body: bytes::Bytes) -> Result<(), crate::hooks::HookError> {
        use crate::hooks::HookError;
        let Some(l) = &self.loaded else { return Err(HookError::NotFound) };
        let Some(spec) = l.def.hooks.get(name) else { return Err(HookError::NotFound) };
        if !spec.auth.verify(&headers, &body) { return Err(HookError::Unauthorized); }
        if !self.hook_rate.allow(HOOKS_PER_MINUTE) { return Err(HookError::RateLimited); }
        let t: mlua::Table = l.vm.lua.registry_value(&l.module).map_err(|e| HookError::Failed(e.to_string()))?;
        let f: Function = t
            .get::<mlua::Table>("hooks")
            .and_then(|h| h.get::<mlua::Table>(name))
            .and_then(|h| h.get::<Function>("handle"))
            .map_err(|e| HookError::Failed(e.to_string()))?;
        let text = String::from_utf8_lossy(&body).to_string();
        let parsed = serde_json::from_str::<Value>(&text).unwrap_or(Value::String(text));
        let forwarded: serde_json::Map<String, Value> = headers
            .iter()
            .filter(|(k, _)| crate::hooks::FORWARDED_HEADERS.contains(&k.as_str()))
            .map(|(k, v)| (k.clone(), Value::String(v.clone())))
            .collect();
        let req = serde_json::json!({ "body": parsed, "headers": forwarded });
        let state = self.current_state().await;
        let refresh = Arc::new(AtomicBool::new(false));
        let result = self.call(l, f, state, Some(req), &refresh, self.limits.command).await.map_err(HookError::Failed)?;
        if let Some(new_state) = result {
            self.publish(new_state, |s| {
                s.ok = true;
                s.error = None;
                s.pushed_at = Some(chrono::Utc::now().timestamp());
            })
            .await
            .map_err(HookError::Failed)?;
        }
        if refresh.load(Ordering::SeqCst) {
            let _ = self.events.send(InstanceEvent::RefreshRequested { id: self.id.clone() });
        }
        Ok(())
    }

    async fn command(&self, action: &str, args: Value) -> Result<(), String> {
        let Some(l) = &self.loaded else { return Err(self.not_loaded()) };
        let f = command_fn(l, action)?;
        let state = self.current_state().await;
        let refresh = Arc::new(AtomicBool::new(false));
        if let Some(new_state) = self.call(l, f, state, Some(args), &refresh, self.limits.command).await? {
            self.publish(new_state, |_| {}).await?;
        }
        if refresh.load(Ordering::SeqCst) {
            let _ = self.events.send(InstanceEvent::RefreshRequested { id: self.id.clone() });
        }
        Ok(())
    }

    async fn current_state(&self) -> Value {
        self.hub.get(&self.id).await.map(|s| s.state).unwrap_or(Value::Null)
    }

    async fn call(
        &self,
        l: &Loaded,
        f: Function,
        state: Value,
        args: Option<Value>,
        refresh: &Arc<AtomicBool>,
        limit: Duration,
    ) -> Result<Option<Value>, String> {
        let cc = CallContext {
            instance: self.id.clone(),
            state,
            config: l.config.clone(),
            http: self.http.clone(),
            refresh: refresh.clone(),
            sys: Some(self.services.sys.clone()),
            persist: Some(self.services.persist.clone()),
        };
        let ctx = build_ctx(&l.vm.lua, &cc).map_err(|e| e.to_string())?;
        let lua_args = match &args {
            Some(a) => to_lua(&l.vm.lua, a).map_err(|e| e.to_string())?,
            None => LuaValue::Nil,
        };
        let out: LuaValue = l.vm.run(limit, f.call_async((ctx, lua_args))).await?;
        l.vm.to_json(out)
    }

    /// Renders the view (for view modules) and stores the result. Returns whether the data changed.
    async fn publish(&self, state: Value, update: impl FnOnce(&mut Status)) -> Result<bool, String> {
        let Some(l) = &self.loaded else { return Err(self.not_loaded()) };
        let view = if l.def.has_view {
            let f = module_fn(l, "view")?;
            let lua_state = to_lua(&l.vm.lua, &state).map_err(|e| e.to_string())?;
            let lua_config = to_lua(&l.vm.lua, &l.config).map_err(|e| e.to_string())?;
            let v: LuaValue = l
                .vm
                .run(self.limits.view, f.call_async((lua_state, lua_config)))
                .await
                .map_err(|e| format!("view: {e}"))?;
            let json = l.vm.to_json(v).map_err(|e| format!("view: {e}"))?.ok_or("view: returned nothing")?;
            Some(normalize_tree(json).map_err(|e| format!("view: {e}"))?)
        } else {
            None
        };
        Ok(self
            .hub
            .publish(&self.id, l.def.kind(), l.def.component.clone(), l.config.clone(), state, view, update)
            .await
            .is_some())
    }
}

async fn load(def: Arc<ModuleDef>, overrides: &Value) -> Result<Loaded, String> {
    let vm = Vm::new().map_err(|e| e.to_string())?;
    let chunk = vm.lua.load(&*def.source).set_name(def.path.display().to_string());
    let value: LuaValue = vm.run(Duration::from_secs(1), chunk.eval_async()).await?;
    let LuaValue::Table(t) = value else { return Err("module must return a table".into()) };
    let module = vm.lua.create_registry_value(t).map_err(|e| e.to_string())?;
    let config = merge_config(&def.config, overrides);
    for key in &def.required {
        let present = match config.get(key) {
            Some(Value::String(s)) => !s.trim().is_empty(),
            Some(Value::Null) | None => false,
            Some(_) => true,
        };
        if !present {
            return Err(format!("config `{key}` is required: pass it on the <Slot> or in application.lua"));
        }
    }
    Ok(Loaded { def, vm, module, config })
}

fn module_fn(l: &Loaded, name: &str) -> Result<Function, String> {
    let t: Table = l.vm.lua.registry_value(&l.module).map_err(|e| e.to_string())?;
    t.get::<Function>(name).map_err(|_| format!("module has no `{name}` function"))
}

fn command_fn(l: &Loaded, action: &str) -> Result<Function, String> {
    let t: Table = l.vm.lua.registry_value(&l.module).map_err(|e| e.to_string())?;
    let commands: Option<Table> = t.get("commands").map_err(|e| e.to_string())?;
    commands
        .and_then(|c| c.get::<Option<Function>>(action).ok().flatten())
        .ok_or_else(|| format!("unknown command {action:?}"))
}
