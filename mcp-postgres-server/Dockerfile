FROM node:20-alpine

# Install dependencies globally
RUN npm install -g \
    @modelcontextprotocol/server-postgres \
    supergateway

# Expose HTTP port
EXPOSE 3000

# Health check using wget (available in alpine)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

# Start: supergateway bridges the stdio postgres MCP server over HTTP/SSE on port 3000
CMD ["sh", "-c", "supergateway --stdio \"npx -y @modelcontextprotocol/server-postgres $POSTGRES_URL\" --port 3000 --host 0.0.0.0"]
