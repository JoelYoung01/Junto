# MCP specification reference (Junto)

This document summarizes the Model Context Protocol requirements Junto targets and records how `junto-mcp` complies. Use it when reviewing transport or tool-surface changes.

**Primary spec version:** [`2026-07-28`](https://modelcontextprotocol.io/specification/2026-07-28)  
**Transport:** [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) (introduced in `2025-03-26`, revised in `2026-07-28`)  
**Rust SDK:** [`rmcp` 3.x](https://docs.rs/rmcp) (official MCP Rust SDK)

Older clients negotiating `2025-11-25` or earlier may still work when `rmcp` legacy compatibility is enabled; Junto does not implement the deprecated HTTP+SSE transport (`2024-11-05`).

---

## Streamable HTTP (2026-07-28) — requirements

| Requirement | Spec rule | Junto |
|---------------|-----------|-------|
| Single MCP endpoint | One path accepts **POST** only | `POST http://127.0.0.1:7799/mcp` via `StreamableHttpService` |
| No GET on MCP endpoint | GET/DELETE removed in `2026-07-28` | Enforced by `rmcp`; no GET handler on `/mcp` |
| JSON-RPC body | Each POST carries one JSON-RPC request or notification | Handled by `rmcp` |
| `Accept` header | Client must accept `application/json` and `text/event-stream` | Client responsibility |
| Response format | JSON object **or** SSE stream scoped to the request | `rmcp` with `with_json_response(true)` for simple tool replies |
| Request metadata | `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` (when applicable) | Validated by `rmcp` |
| Stateless mode | No `Mcp-Session-Id`; per-request `_meta` carries client info | `with_legacy_session_mode(false)` |
| Local bind | Servers **SHOULD** bind to loopback | `127.0.0.1:7799` only |
| Origin validation | Servers **MUST** validate `Origin` on incoming connections | Provided by `rmcp` / tower stack |
| Tool discovery | `tools/list` JSON-RPC method | `#[tool_router]` on `JuntoMcpServer` |
| Tool invocation | `tools/call` with `name` + `arguments` | Standard MCP tool handlers |
| Tool errors | Tool failures → `CallToolResult` with `isError: true` | `CallToolResult::error(...)` |
| Resources / prompts | Optional server capabilities | **Not implemented** (tools only) |
| Subscriptions | `subscriptions/listen` for change notifications | **Not implemented** |
| Tasks (long-running) | SEP-2663 task handles | **Not implemented** (`export_video` is blocking) |
| Sampling / elicitation / roots | Server→client via MRTR | **Not implemented** |

---

## Junto-specific extensions (non-standard)

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `GET /health` | Desktop setup UI liveness check | **Not** part of MCP; keep for Junto app only |

Do not point external MCP clients at `/health` or expect MCP methods there.

---

## Removed legacy API (pre-refactor)

These were **not** MCP-compliant and were removed:

| Old endpoint | Problem |
|--------------|---------|
| `POST /mcp` with `{ "name", "arguments" }` | Custom body; not JSON-RPC `tools/call` |
| `GET /tools` | Non-standard discovery; replaced by `tools/list` over POST `/mcp` |

---

## Client configuration examples

**OpenCode** (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "junto": {
      "type": "remote",
      "url": "http://127.0.0.1:7799/mcp",
      "oauth": false
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "junto": {
      "url": "http://127.0.0.1:7799/mcp"
    }
  }
}
```

Start Junto desktop (`cargo run -p junto-desktop`) before connecting. Open a project in the app so tools have project context.

---

## Compliance audit checklist

When changing `junto-mcp`, verify:

1. `/mcp` is mounted only via `StreamableHttpService` (no custom POST handler).
2. Tool names and JSON Schemas match `#[tool]` definitions in `crates/junto-mcp/src/server.rs`.
3. Tool-level failures use `CallToolResult::error`, not panics or plain HTTP 500.
4. `GET /health` remains optional and documented as non-MCP.
5. E2E tests use an MCP client (`rmcp` transport), not raw `{ name, arguments }` POSTs.
6. Supported protocol version stays aligned with `rmcp` release notes.

---

## References

- [MCP specification index](https://modelcontextprotocol.io/specification/2026-07-28)
- [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Server tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [rmcp crate](https://docs.rs/rmcp)
- [rust-sdk repository](https://github.com/modelcontextprotocol/rust-sdk)

*Last updated: 2026-08-25 — aligned with MCP `2026-07-28` and `rmcp` 3.x.*
