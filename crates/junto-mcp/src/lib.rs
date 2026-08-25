mod logging;
mod server;
mod tools;

use std::net::SocketAddr;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, RwLock};

use axum::middleware;
use axum::routing::get;
use axum::Json;
use junto_core::Project;
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use serde_json::{json, Value};
use tokio::net::TcpListener;

pub use server::JuntoMcpServer;

pub type SharedProject = Arc<RwLock<Option<Project>>>;

pub async fn start_server(
    project: SharedProject,
    export_running: Option<Arc<AtomicBool>>,
    addr: SocketAddr,
) -> anyhow::Result<()> {
    let app = router(project, export_running);
    let listener = TcpListener::bind(addr).await?;
    tracing::info!("Junto MCP listening on http://{addr}/mcp");
    axum::serve(listener, app).await?;
    Ok(())
}

pub fn router(
    project: SharedProject,
    export_running: Option<Arc<AtomicBool>>,
) -> axum::Router {
    let shared_project = Arc::clone(&project);
    let shared_export = export_running.clone();

    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true);

    let mcp_service = StreamableHttpService::new(
        move || Ok(JuntoMcpServer::new(Arc::clone(&shared_project), shared_export.clone())),
        LocalSessionManager::default().into(),
        config,
    );

    axum::Router::new()
        .route("/health", get(health))
        .nest_service(
            "/mcp",
            axum::Router::new()
                .layer(middleware::from_fn(logging::log_mcp_http))
                .fallback_service(mcp_service),
        )
}

async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "junto-mcp",
        "transport": "streamable-http",
        "mcp_protocol_versions": ["2026-07-28", "2025-11-25"]
    }))
}
