//! CPU, memory and load, sampled in the background so modules read them instantly.
use serde::Serialize;
use std::{
    sync::{Arc, RwLock},
    time::Duration,
};
use sysinfo::{MINIMUM_CPU_UPDATE_INTERVAL, System};

#[derive(Debug, Clone, Default, Serialize)]
pub struct SysStats {
    pub cpu_pct: f32,
    pub mem_used_mb: u64,
    pub mem_total_mb: u64,
    pub load1: f64,
    pub load5: f64,
    pub load15: f64,
    pub uptime_secs: u64,
}

#[derive(Clone)]
pub struct Sampler(Arc<RwLock<SysStats>>);

impl Sampler {
    pub fn start() -> Self {
        let cell = Arc::new(RwLock::new(SysStats::default()));
        let shared = cell.clone();
        tokio::spawn(async move {
            let mut sys = System::new();
            sys.refresh_cpu_usage();
            tokio::time::sleep(MINIMUM_CPU_UPDATE_INTERVAL).await;
            loop {
                sys.refresh_cpu_usage();
                sys.refresh_memory();
                let load = System::load_average();
                *shared.write().unwrap() = SysStats {
                    cpu_pct: sys.global_cpu_usage(),
                    mem_used_mb: sys.used_memory() / 1_048_576,
                    mem_total_mb: sys.total_memory() / 1_048_576,
                    load1: load.one,
                    load5: load.five,
                    load15: load.fifteen,
                    uptime_secs: System::uptime(),
                };
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        });
        Sampler(cell)
    }

    pub fn latest(&self) -> SysStats {
        self.0.read().unwrap().clone()
    }
}
