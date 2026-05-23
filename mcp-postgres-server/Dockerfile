FROM node:20-alpine

# Install git and dependencies globally (ignoring npm scripts to bypass husky)
RUN apk add --no-cache git && \
    npm config set ignore-scripts true && \
    npm install -g \
    @modelcontextprotocol/server-postgres \
    github:supercorp-ai/supergateway

# Expose HTTP port
EXPOSE 3000

# Health check: supergateway exposes /health when --health-endpoint flag is set
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

# Start: supergateway bridges stdio postgres MCP over HTTP/SSE
# --health-endpoint /health enables the /health route for Docker healthcheck
CMD ["sh", "-c", "supergateway --stdio \"mcp-server-postgres ${POSTGRES_URL:-$DATABASE_URL}\" --port 3000 --host 0.0.0.0 --health-endpoint /health"]
