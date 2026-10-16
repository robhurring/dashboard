//! Development hot reload: re-read modules and application.lua when files change.
use crate::{dashboard::{self, DashboardConfig}, module_def, supervisor::SupervisorHandle};
use notify::{EventKind, RecursiveMode, Watcher};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::sync::mpsc;

/// Resolves symlinks (macOS reports /private/var for /var) even for files that do not exist yet.
fn canonical(p: &Path) -> PathBuf {
    if let Ok(c) = p.canonicalize() {
        return c;
    }
    match (p.parent(), p.file_name()) {
        (Some(parent), Some(name)) => {
            let parent = if parent.as_os_str().is_empty() { Path::new(".") } else { parent };
            parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf()).join(name)
        }
        _ => p.to_path_buf(),
    }
}

pub fn spawn(
    modules_dir: PathBuf,
    application_file: PathBuf,
    initial: DashboardConfig,
    supervisor: SupervisorHandle,
) -> anyhow::Result<()> {
    let modules_canon = canonical(&modules_dir);
    let dashboard_canon = canonical(&application_file);
    let (tx, mut rx) = mpsc::unbounded_channel::<()>();
    let (m, d) = (modules_canon.clone(), dashboard_canon.clone());
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if matches!(ev.kind, EventKind::Access(_)) {
            return;
        }
        if ev.paths.iter().any(|p| p.starts_with(&m) || *p == d) {
            let _ = tx.send(());
        }
    })?;
    watcher.watch(&modules_canon, RecursiveMode::Recursive)?;
    watcher.watch(dashboard_canon.parent().unwrap_or(Path::new(".")), RecursiveMode::NonRecursive)?;

    tokio::spawn(async move {
        let _watcher = watcher; // keep the OS watcher alive for the life of the task
        let mut last_dashboard = initial;
        while rx.recv().await.is_some() {
            // Editors write in bursts; settle before reloading once.
            tokio::time::sleep(Duration::from_millis(200)).await;
            while rx.try_recv().is_ok() {}
            let modules = module_def::load_all(&modules_dir).await;
            match dashboard::load(&application_file).await {
                Ok(d) => last_dashboard = d,
                Err(e) => tracing::error!(error = %e, "application.lua is invalid; keeping the previous version"),
            }
            tracing::info!("reloading modules and application.lua");
            supervisor.reload(modules, last_dashboard.clone());
        }
    });
    Ok(())
}
