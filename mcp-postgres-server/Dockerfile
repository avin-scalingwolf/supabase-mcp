FROM node:20-alpine

# Install dependencies globally
RUN npm install -g \
    @modelcontextprotocol/server-postgres \
    supergateway

# Expose HTTP port
EXPOSE 3000

# Health check: supergateway exposes /health when --health-endpoint flag is set
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

# Start: supergateway bridges stdio postgres MCP over HTTP/SSE
# --health-endpoint /health enables the /health route for Docker healthcheck
CMD ["sh", "-c", "supergateway --stdio \"npx -y @modelcontextprotocol/server-postgres $POSTGRES_URL\" --port 3000 --host 0.0.0.0 --health-endpoint /health"]
