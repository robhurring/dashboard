use dashboard::config::Config;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Before logging starts, so RUST_LOG from .env applies too.
    dashboard::config::load_dotenv(std::path::Path::new(".env"));
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    dashboard::app::run(Config::from_env()?).await
}
