# Secure MCP Gateway for Self-Hosted Supabase

A production-ready, lightweight authentication and reverse proxy gateway for self-hosted Supabase Model Context Protocol (MCP) servers. Built with **Node.js (Express)**, it acts as a secure guardhouse enforcing JWT verification, default-deny routing rules, and active rate limiting.

---

## Features

- **Authentication Guard**: Blocks all unauthorized access by default. Validates HS256 Bearer JWTs using a shared secret.
- **Header & Body Preservation**: Powered by Node.js native `fetch` API, enabling zero-dependency, high-fidelity request proxying (method, body, and custom headers) without body parser interference.
- **Default Deny Rule**: All paths except `/health`, `/mcp`, and `/mcp/*` are strictly blocked with `404 Not Found`/`403 Forbidden` responses.
- **Audit Logger**: Outputs structured access logs containing incoming request IPs, authenticated user identities (JWT subject/email), HTTP status, and duration.
- **Throttling (Rate Limiting)**: In-memory IP throttling prevents denial-of-service and brute force attempts.
- **Production Docker Image**: Hardened multi-stage Alpine Docker build running under a non-root system user, complete with a zero-dependency health check.

---

## Project Structure

```text
mcp-gateway/
├── src/
│   ├── server.js      # Main Express server and route definitions
│   ├── auth.js        # JWT verification middleware
│   └── proxy.js       # Native fetch-based proxy forwarding
├── package.json       # App manifests and dependencies
├── Dockerfile         # Multi-stage secure Docker image config
├── .env.example       # Example variables configuration
├── .env               # Local runtime config (not in source control)
└── README.md          # Operation guide & runbook (this file)
```

---

## Quick Start (Local Development)

### 1. Prerequisite
Ensure you have **Node.js (v18 or higher)** installed.

### 2. Install Dependencies
```bash
npm install
```

### 3. Setup Configuration
Copy the sample environment file and configure variables:
```bash
cp .env.example .env
```
Open `.env` and set:
- `PORT`: Gateway listener port (defaults to `8080`).
- `SUPABASE_MCP_URL`: Target self-hosted Supabase MCP endpoint (e.g. `https://supabase.yourdomain.com/mcp`).
- `JWT_SECRET`: A strong, randomly-generated secret key.

### 4. Run the Server
```bash
# Start in development mode
npm run dev
```

---

## Production Deployment (Docker & Coolify)

This gateway is ready to deploy natively onto Docker-based PaaS platforms like **Coolify**:

### Local Docker Build & Test
```bash
# 1. Build the production image
docker build -t mcp-gateway .

# 2. Run the container with environment variables
docker run -d \
  -p 8080:8080 \
  -e PORT=8080 \
  -e SUPABASE_MCP_URL=https://supabase.yourdomain.com/mcp \
  -e JWT_SECRET=your_super_secret_key \
  --name mcp-gateway-instance \
  mcp-gateway
```

### Deploying to Coolify
1. Create a **New Resource** in Coolify.
2. Select **Private Repository** (e.g., GitHub) or **Dockerfile/Raw** deployment.
3. If deploying via Git, connect the repository and choose the `Dockerfile` build pack.
4. Set the **Destination Port** to `8080`.
5. Under the container **Environment Variables**, define:
   - `PORT=8080`
   - `SUPABASE_MCP_URL=https://your-supabase-domain/mcp`
   - `JWT_SECRET=your_production_secret_key`
6. Click **Deploy**. Coolify will automatically configure the routing and utilize the Dockerfile's built-in health check to orchestrate zero-downtime rolls!

---

## Token Generation Guide

Clients must provide a valid HS256 JWT signed with the shared `JWT_SECRET`. 

Here is a quick Node.js script to sign a production-grade token. You can run it locally:

```javascript
// generate-token.js
const jwt = require('jsonwebtoken');

const secret = 'your_super_secret_key_change_me_in_production'; // Match JWT_SECRET in .env
const payload = {
  sub: 'usr_9812401',                // Client ID / System ID
  email: 'developer@company.com',     // Developer / Service email
  role: 'mcp-client'
};

const token = jwt.sign(payload, secret, { expiresIn: '1y' }); // Expires in 1 year
console.log('Your JWT token is:\n');
console.log(`Bearer ${token}`);
```

---

## curl Verification Recipes

Once the gateway is running on `http://localhost:8080`, test its security behaviors using the following scenarios:

### 1. Public Health Check
The health route is open and doesn't require authentication:
```bash
curl -i http://localhost:8080/health
```
**Expected Response:** `200 OK`
```json
{
  "status": "OK",
  "timestamp": "2026-05-23T13:21:59.000Z",
  "uptime": 12.34
}
```

### 2. Missing Authentication (Default Deny)
Trying to access the MCP server without a token:
```bash
curl -i -X POST http://localhost:8080/mcp
```
**Expected Response:** `401 Unauthorized`
```json
{
  "error": "Unauthorized",
  "message": "Authorization header is missing"
}
```

### 3. Invalid Token Attempt
Providing an incorrect or manipulated token:
```bash
curl -i -X POST \
  -H "Authorization: Bearer invalid_jwt_token_here" \
  http://localhost:8080/mcp
```
**Expected Response:** `401 Unauthorized`
```json
{
  "error": "Unauthorized",
  "message": "Invalid or malformed token"
}
```

### 4. Route Blocking (Default Deny)
Attempting to hit routes outside of the `/health` and `/mcp` specs:
```bash
curl -i http://localhost:8080/unauthorized-route
```
**Expected Response:** `404 Not Found` (Default Deny)
```json
{
  "error": "Forbidden",
  "message": "Access Denied: Default deny rule triggered for GET /unauthorized-route"
}
```

### 5. Authorized MCP Request (Successful Proxy)
Passing a valid token created with the shared secret:
```bash
curl -i -X POST \
  -H "Authorization: Bearer <VALID_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"list_tools","params":{},"id":1}' \
  http://localhost:8080/mcp
```
**Expected Response:** `200 OK` (transparent proxy response from the Supabase MCP backend)
```json
{
  "jsonrpc": "2.0",
  "result": {
    "tools": [
      {
        "name": "list_tables",
        "description": "Lists the tables in the Supabase database"
      }
    ]
  },
  "id": 1
}
```
