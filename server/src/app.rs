//! Builds the running application for production and for tests.
use crate::{
    config::Config,
    dashboard::{self, DashboardConfig},
    http_app,
    hub::Hub,
    instance::{HostServices, Limits},
    module_def,
    persist::Persist,
    supervisor::{self, SupervisorHandle},
    ws::AppState,
};
use axum::Router;
use std::{
    net::SocketAddr,
    sync::{Arc, atomic::AtomicU64},
    time::Duration,
};

pub struct Built {
    pub router: Router,
    pub hub: Arc<Hub>,
    pub supervisor: SupervisorHandle,
    pub application: DashboardConfig,
}

pub async fn build(cfg: &Config, persist: Persist) -> anyhow::Result<Built> {
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(concat!("dashboard/", env!("CARGO_PKG_VERSION")))
        .build()?;
    let services = HostServices { sys: crate::sysstats::Sampler::start(), persist: persist.clone() };
    let hub = Hub::new(persist).await?;
    crate::widgets::set_custom(crate::widgets::scan_custom(&cfg.widgets_dirs));
    let modules = module_def::load_all(&cfg.modules_dirs).await;
    for (name, m) in &modules {
        if let Err(e) = m {
            tracing::error!(module = %name, error = %e, "module failed to load");
        }
    }
    let dashboard = dashboard::load(&cfg.application_file).await.map_err(|e| anyhow::anyhow!(e))?;
    let supervisor =
        supervisor::start(modules, dashboard.clone(), cfg.timezone, hub.clone(), http, Limits::default(), services).await;
    if cfg.watch_files {
        crate::watcher::spawn(cfg.modules_dirs.clone(), cfg.widgets_dirs.clone(), cfg.application_file.clone(), dashboard.clone(), supervisor.clone())?;
        tracing::info!("watching modules and application.lua for changes");
    }
    let state = AppState { hub: hub.clone(), supervisor: supervisor.clone(), sessions: Arc::new(AtomicU64::new(1)) };
    let router = http_app::router(state, &cfg.static_dir, cfg.default_theme.clone());
    Ok(Built { router, hub, supervisor, application: dashboard })
}

pub async fn run(cfg: Config) -> anyhow::Result<()> {
    let url = cfg.redis_url.clone().ok_or_else(|| anyhow::anyhow!("REDIS_URL is required"))?;
    let persist = Persist::redis(&url, &cfg.redis_prefix)
        .await
        .map_err(|e| anyhow::anyhow!("cannot reach Redis, refusing to start: {e}"))?;
    let built = build(&cfg, persist).await?;
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", cfg.port)).await?;
    tracing::info!(port = cfg.port, "listening");
    axum::serve(listener, built.router).await?;
    Ok(())
}

pub struct TestServer {
    pub addr: SocketAddr,
    pub hub: Arc<Hub>,
    pub supervisor: SupervisorHandle,
}

/// Starts the app on a random local port with in-memory persistence.
pub async fn serve_for_test(cfg: Config) -> anyhow::Result<TestServer> {
    let built = build(&cfg, Persist::memory()).await?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let router = built.router;
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    Ok(TestServer { addr, hub: built.hub, supervisor: built.supervisor })
}
