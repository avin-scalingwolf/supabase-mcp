FROM node:20-alpine

# Install dependencies globally and patch supergateway compiled JS to fix transport crash
RUN npm install -g @modelcontextprotocol/server-postgres supergateway && \
    sed -i '/const server = new Server({ name:/d' /usr/local/lib/node_modules/supergateway/dist/gateways/stdioToSse.js && \
    sed -i 's/await server.connect(sseTransport);/const server = new Server({ name: '\''supergateway'\'', version: getVersion() }, { capabilities: {} });\n        await server.connect(sseTransport);/' /usr/local/lib/node_modules/supergateway/dist/gateways/stdioToSse.js

# Expose HTTP port
EXPOSE 3000

# Health check: supergateway exposes /health when --health-endpoint flag is set
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

# Start: supergateway bridges stdio postgres MCP over HTTP/SSE
# --health-endpoint /health enables the /health route for Docker healthcheck
CMD ["sh", "-c", "supergateway --stdio \"mcp-server-postgres ${POSTGRES_URL:-$DATABASE_URL}\" --port 3000 --host 0.0.0.0 --health-endpoint /health"]
