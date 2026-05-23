FROM node:20-alpine

COPY stdioToSse.patch /stdioToSse.patch

# Install git, clone supergateway, bypass husky, apply patch, and install dependencies globally
RUN apk add --no-cache git patch && \
    git clone https://github.com/supercorp-ai/supergateway.git /tmp/supergateway && \
    cd /tmp/supergateway && patch -p1 < /stdioToSse.patch && cd / && \
    sed -i 's/husky/echo/g' /tmp/supergateway/package.json && \
    npm install -g --ignore-scripts \
    @modelcontextprotocol/server-postgres \
    /tmp/supergateway && \
    rm -rf /tmp/supergateway /stdioToSse.patch

# Expose HTTP port
EXPOSE 3000

# Health check: supergateway exposes /health when --health-endpoint flag is set
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

# Start: supergateway bridges stdio postgres MCP over HTTP/SSE
# --health-endpoint /health enables the /health route for Docker healthcheck
CMD ["sh", "-c", "supergateway --stdio \"mcp-server-postgres ${POSTGRES_URL:-$DATABASE_URL}\" --port 3000 --host 0.0.0.0 --health-endpoint /health"]
