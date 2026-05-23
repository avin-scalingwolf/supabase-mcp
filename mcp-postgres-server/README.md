# Supabase MCP Server (Self-Hosted PostgreSQL)

A lightweight MCP server that bridges **PostgreSQL** over HTTP/SSE using:
- [`@modelcontextprotocol/server-postgres`](https://github.com/modelcontextprotocol/servers/tree/main/src/postgres) — Official MCP postgres server
- [`supergateway`](https://github.com/supercorp-ai/supergateway) — Bridges stdio MCP servers to HTTP/SSE

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `POSTGRES_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |

## Deploy via Coolify

1. **Source**: This GitHub repo
2. **Build Pack**: `Dockerfile`
3. **Network**: Same Docker network as your Supabase stack
4. **Container Name**: `testing-supabase-mcp-server`
5. **Port**: `3000`
6. **Env Vars**: Set `POSTGRES_URL`

## Usage

Once running, the MCP server exposes:
- `GET /health` — Health check
- `POST /sse` — SSE MCP transport endpoint
