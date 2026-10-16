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
    modules_dirs: Vec<PathBuf>,
    widgets_dirs: Vec<PathBuf>,
    application_file: PathBuf,
    initial: DashboardConfig,
    supervisor: SupervisorHandle,
) -> anyhow::Result<()> {
    // Folders that don't exist yet can't be watched; creating one needs a restart to be picked up.
    let all_dirs: Vec<PathBuf> = modules_dirs.iter().chain(&widgets_dirs).cloned().collect();
    let watched: Vec<PathBuf> = all_dirs.iter().filter(|d| d.is_dir()).map(|d| canonical(d)).collect();
    for missing in all_dirs.iter().filter(|d| !d.is_dir()) {
        tracing::debug!(dir = %missing.display(), "modules folder does not exist; not watched");
    }
    let dashboard_canon = canonical(&application_file);
    let (tx, mut rx) = mpsc::unbounded_channel::<()>();
    let (m, d) = (watched.clone(), dashboard_canon.clone());
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if matches!(ev.kind, EventKind::Access(_)) {
            return;
        }
        if ev.paths.iter().any(|p| m.iter().any(|dir| p.starts_with(dir)) || *p == d) {
            let _ = tx.send(());
        }
    })?;
    for dir in &watched {
        watcher.watch(dir, RecursiveMode::Recursive)?;
    }
    watcher.watch(dashboard_canon.parent().unwrap_or(Path::new(".")), RecursiveMode::NonRecursive)?;

    tokio::spawn(async move {
        let _watcher = watcher; // keep the OS watcher alive for the life of the task
        let mut last_dashboard = initial;
        while rx.recv().await.is_some() {
            // Editors write in bursts; settle before reloading once.
            tokio::time::sleep(Duration::from_millis(200)).await;
            while rx.try_recv().is_ok() {}
            crate::widgets::set_custom(crate::widgets::scan_custom(&widgets_dirs));
            let modules = module_def::load_all(&modules_dirs).await;
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
