# Junto agent plugin

Agent Plugins / Cursor plugin that wires agents to the **local Junto MCP** server and teaches how to drive the open project.

## Contents

- `mcp.json` — Streamable HTTP MCP at `http://127.0.0.1:7799/mcp` (requires Junto desktop running)
- `skills/junto/` — MCP tool usage + usage-focused architecture overview
- `plugin.json` — [Agent Plugins](https://agent-plugins.org) manifest
- `.cursor-plugin/plugin.json` — Cursor plugin manifest (marketplace-compatible)

## Install / use

1. Start Junto and open a project (MCP binds to `127.0.0.1:7799`).
2. Install this plugin (local path, team marketplace import of this repo, or Cursor marketplace once listed).
3. Invoke the **junto** skill when editing via MCP.

Repo marketplace index: [`.cursor-plugin/marketplace.json`](../../.cursor-plugin/marketplace.json) (`pluginRoot`: `plugins`).

## Health

```bash
curl -s http://127.0.0.1:7799/health
```

MCP endpoint (JSON-RPC / Streamable HTTP): `http://127.0.0.1:7799/mcp`
