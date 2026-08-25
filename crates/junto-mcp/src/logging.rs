use std::time::Instant;

use axum::{
    body::{Body, Bytes},
    extract::Request,
    middleware::Next,
    response::Response,
};
use http_body_util::BodyExt;

const MAX_BODY_LOG_BYTES: usize = 4096;

fn header_value(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

fn preview_body(body: &Bytes) -> String {
    if body.is_empty() {
        return String::new();
    }

    let preview_len = body.len().min(MAX_BODY_LOG_BYTES);
    let preview = String::from_utf8_lossy(&body[..preview_len]);
    if body.len() > MAX_BODY_LOG_BYTES {
        format!("{preview}… ({len} bytes total)", len = body.len())
    } else {
        preview.into_owned()
    }
}

pub async fn log_mcp_http(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let uri = request.uri().clone();
    let mcp_method = header_value(request.headers(), "mcp-method");
    let mcp_session = header_value(request.headers(), "mcp-session-id");
    let protocol_version = header_value(request.headers(), "mcp-protocol-version");
    let accept = header_value(request.headers(), "accept");
    let content_type = header_value(request.headers(), "content-type");

    let (parts, body) = request.into_parts();
    let collected = match body.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(err) => {
            tracing::error!(
                method = %method,
                uri = %uri,
                error = %err,
                "failed to read MCP request body"
            );
            return Response::builder()
                .status(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from(format!("failed to read request body: {err}")))
                .expect("valid error response");
        }
    };

    tracing::info!(
        method = %method,
        uri = %uri,
        mcp_method = mcp_method.as_deref().unwrap_or("-"),
        mcp_session = mcp_session.as_deref().unwrap_or("-"),
        protocol_version = protocol_version.as_deref().unwrap_or("-"),
        accept = accept.as_deref().unwrap_or("-"),
        content_type = content_type.as_deref().unwrap_or("-"),
        body_bytes = collected.len(),
        body = %preview_body(&collected),
        "MCP HTTP request"
    );

    let request = Request::from_parts(parts, Body::from(collected));
    let started = Instant::now();
    let response = next.run(request).await;
    let latency_ms = started.elapsed().as_millis();

    tracing::info!(
        status = %response.status(),
        latency_ms,
        "MCP HTTP response"
    );

    if response.status().is_server_error() {
        tracing::error!(
            status = %response.status(),
            latency_ms,
            "MCP HTTP server error"
        );
    }

    response
}
