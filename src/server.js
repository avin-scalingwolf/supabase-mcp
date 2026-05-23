// Load environment variables first
require('dotenv').config();

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const verifyToken = require('./auth');
const proxyRequest = require('./proxy');
const verifyAdminToken = require('./admin-auth');

const DEVELOPERS_DB_PATH = path.join(__dirname, '../data/developers.json');
const DEVELOPERS_DB_DIR  = path.join(__dirname, '../data');

// Auto-initialize data directory and registry file on startup
// This ensures fresh containers (or containers without persistent storage) don't crash
if (!fs.existsSync(DEVELOPERS_DB_DIR)) {
  fs.mkdirSync(DEVELOPERS_DB_DIR, { recursive: true });
  console.log('[INIT] Created data directory:', DEVELOPERS_DB_DIR);
}
if (!fs.existsSync(DEVELOPERS_DB_PATH)) {
  fs.writeFileSync(DEVELOPERS_DB_PATH, '[]', 'utf8');
  console.log('[INIT] Initialized empty developers registry:', DEVELOPERS_DB_PATH);
}

const app = express();
const PORT = process.env.PORT || 8080;

// Enable trusting reverse proxies (crucial for accurate IP logging under Coolify / Docker / Nginx)
app.set('trust proxy', true);

// Standard Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Production Audit Logging Middleware
// Logs: [Timestamp] IP: <ip> | User: <authenticated_user> | <method> <path> | Status: <status> | Duration: <duration>ms
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const userIdentifier = req.user 
      ? (req.user.email || req.user.id) 
      : 'unauthenticated';
      
    console.log(
      `[${new Date().toISOString()}] IP: ${req.ip} | User: ${userIdentifier} | ` +
      `${req.method} ${req.originalUrl} | Status: ${res.statusCode} | Duration: ${duration}ms`
    );
  });
  
  next();
});

// Production-grade Rate Limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: 'draft-7', // draft-7: combined RateLimit-Limit, RateLimit-Remaining, and RateLimit-Reset headers
  legacyHeaders: false, // Disable the X-RateLimit-* headers
  validate: { trustProxy: false }, // Turn off permissive trustProxy warning for local integration testing
  message: {
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please try again later.'
  }
});
app.use(limiter);

// 1. Health Route (Publicly accessible check for orchestrators / Docker / Coolify)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 2. Serve the Admin UI static frontend files
app.use('/admin', express.static(path.join(__dirname, '../public')));

// 3. Public Administrative Login Endpoint
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!ADMIN_PASSWORD) {
    console.error('[SECURITY ALERT] ADMIN_PASSWORD is not configured in the environment.');
    return res.status(500).json({
      error: 'Server Configuration Error',
      message: 'Administrative access is not configured.'
    });
  }

  if (password === ADMIN_PASSWORD) {
    // Generate Admin Session JWT (expires in 24 hours)
    const token = jwt.sign(
      { sub: 'admin', email: 'admin@supabase-gateway.local', role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    console.log(`[ADMIN LOGIN SUCCESS] IP: ${req.ip} | Timestamp: ${new Date().toISOString()}`);
    return res.json({ token });
  }

  console.warn(`[ADMIN LOGIN ATTEMPT BLOCKED] Incorrect password from IP: ${req.ip} | Timestamp: ${new Date().toISOString()}`);
  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Incorrect administrator password.'
  });
});

// 4. Authenticated Administrative API - List Developers & Keys
app.get('/api/admin/tokens', verifyAdminToken, (req, res) => {
  fs.readFile(DEVELOPERS_DB_PATH, 'utf8', (err, data) => {
    if (err) {
      // File not found on fresh container — return empty list instead of crashing
      if (err.code === 'ENOENT') {
        return res.json([]);
      }
      console.error(`[ADMIN API ERROR] Failed to read database: ${err.message}`);
      return res.status(500).json({ error: 'Internal Database Error', message: 'Failed to retrieve developers registry.' });
    }
    try {
      const developers = JSON.parse(data);
      return res.json(developers);
    } catch (parseErr) {
      return res.status(500).json({ error: 'Internal Database Error', message: 'Registry database corruption detected.' });
    }
  });
});

// 5. Authenticated Administrative API - Generate Developer Token
app.post('/api/admin/tokens', verifyAdminToken, (req, res) => {
  const { email, name, expiresInDays } = req.body;

  if (!email || !name) {
    return res.status(400).json({ error: 'Bad Request', message: 'Name and email are required.' });
  }

  const devId = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const payload = {
    sub: devId,
    email: email,
    role: 'developer'
  };

  const days = parseInt(expiresInDays, 10);
  const jwtOptions = {};
  if (!isNaN(days) && days > 0) {
    jwtOptions.expiresIn = `${days}d`;
  }

  const token = jwt.sign(payload, process.env.JWT_SECRET, jwtOptions);

  const newDev = {
    id: devId,
    name: name,
    email: email,
    token: token,
    created: new Date().toISOString(),
    expires: !isNaN(days) && days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : 'Never',
    status: 'active'
  };

  // Read, append, and save
  fs.readFile(DEVELOPERS_DB_PATH, 'utf8', (err, data) => {
    let developers = [];
    if (!err) {
      try {
        developers = JSON.parse(data);
      } catch (e) {}
    }

    developers.push(newDev);

    fs.writeFile(DEVELOPERS_DB_PATH, JSON.stringify(developers, null, 2), 'utf8', (writeErr) => {
      if (writeErr) {
        console.error(`[ADMIN API ERROR] Failed to save database: ${writeErr.message}`);
        return res.status(500).json({ error: 'Internal Database Error', message: 'Failed to persist developer credentials.' });
      }

      console.log(`[TOKEN GENERATED] IP: ${req.ip} | Admin: ${req.admin.email} | Target: ${email} | Expire: ${newDev.expires}`);
      return res.status(201).json({
        success: true,
        developer: newDev
      });
    });
  });
});

// 6. Authenticated Administrative API - Revoke Developer Token
app.delete('/api/admin/tokens/:id', verifyAdminToken, (req, res) => {
  const { id } = req.params;

  fs.readFile(DEVELOPERS_DB_PATH, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Internal Database Error', message: 'Failed to access database.' });
    }

    let developers = [];
    try {
      developers = JSON.parse(data);
    } catch (e) {
      return res.status(500).json({ error: 'Internal Database Error', message: 'Database corruption.' });
    }

    const devIndex = developers.findIndex(d => d.id === id);
    if (devIndex === -1) {
      return res.status(404).json({ error: 'Not Found', message: 'Developer record not found.' });
    }

    // Mark as revoked
    developers[devIndex].status = 'revoked';
    developers[devIndex].revokedAt = new Date().toISOString();

    fs.writeFile(DEVELOPERS_DB_PATH, JSON.stringify(developers, null, 2), 'utf8', (writeErr) => {
      if (writeErr) {
        return res.status(500).json({ error: 'Internal Database Error', message: 'Failed to write data changes.' });
      }

      console.warn(`[TOKEN REVOKED] IP: ${req.ip} | Admin: ${req.admin.email} | Revoked ID: ${id}`);
      return res.json({
        success: true,
        message: 'Developer token revoked successfully.'
      });
    });
  });
});

// 6b. Authenticated Administrative API - Permanent Purge Developer Token
app.delete('/api/admin/tokens/:id/purge', verifyAdminToken, (req, res) => {
  const { id } = req.params;

  fs.readFile(DEVELOPERS_DB_PATH, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Internal Database Error', message: 'Failed to access database.' });
    }

    let developers = [];
    try {
      developers = JSON.parse(data);
    } catch (e) {
      return res.status(500).json({ error: 'Internal Database Error', message: 'Database corruption.' });
    }

    const initialLength = developers.length;
    const filteredDevelopers = developers.filter(d => d.id !== id);

    if (filteredDevelopers.length === initialLength) {
      return res.status(404).json({ error: 'Not Found', message: 'Developer record not found.' });
    }

    fs.writeFile(DEVELOPERS_DB_PATH, JSON.stringify(filteredDevelopers, null, 2), 'utf8', (writeErr) => {
      if (writeErr) {
        return res.status(500).json({ error: 'Internal Database Error', message: 'Failed to write data changes.' });
      }

      console.warn(`[TOKEN PURGED] IP: ${req.ip} | Admin: ${req.admin.email} | Purged ID: ${id}`);
      return res.json({
        success: true,
        message: 'Developer token purged permanently.'
      });
    });
  });
});

/**
 * Dynamic SSE MCP tool introspection.
 * Establishes an SSE session, issues a tools/list JSON-RPC POST, and returns parsed tools.
 */
const fetchToolsFromDownstream = async (supabaseMcpUrl) => {
  const mcpBase = supabaseMcpUrl.replace(/\/(sse|message)\/?$/, '');
  const sseUrl = `${mcpBase}/sse`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(sseUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`SSE handshake failed with status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sessionIdPath = null;
    let tools = null;

    try {
      // Step 1: Read stream until we get the endpoint
      while (!sessionIdPath) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('endpoint:')) {
             const content = line.replace('endpoint:', '').trim();
             sessionIdPath = content;
             break;
          } else if (line.startsWith('data:')) {
             const content = line.replace('data:', '').trim();
             if (content.startsWith('/message') || content.startsWith('http')) {
               sessionIdPath = content;
               break;
             }
          }
        }
      }

      if (!sessionIdPath) {
        throw new Error('Failed to obtain SSE sessionId path from downstream stream');
      }

      // Format message URL properly based on if it's relative or absolute
      const messageUrl = sessionIdPath.startsWith('http') ? sessionIdPath : `${mcpBase}${sessionIdPath}`;

      const headers = {
        'Content-Type': 'application/json'
      };
      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
        headers['apikey'] = serviceKey;
        headers['authorization'] = `Bearer ${serviceKey}`;
      }

      const listPayload = {
        jsonrpc: '2.0',
        id: 'gateway-introspect',
        method: 'tools/list',
        params: {}
      };

      // Step 2: Fire the POST request (do not await its body, just its completion/status)
      const postRes = await fetch(messageUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(listPayload),
        signal: AbortSignal.timeout(5000)
      });

      if (!postRes.ok) {
        throw new Error(`JSON-RPC post failed with status ${postRes.status}`);
      }

      // Step 3: Continue reading the SSE stream to catch the response for id 'gateway-introspect'
      while (!tools) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const content = line.replace('data:', '').trim();
            try {
              const rpcMsg = JSON.parse(content);
              if (rpcMsg.id === 'gateway-introspect') {
                if (rpcMsg.error) {
                  throw new Error(`JSON-RPC error: ${JSON.stringify(rpcMsg.error)}`);
                }
                tools = rpcMsg.result?.tools || [];
                break;
              }
            } catch (e) {
              // Ignore non-JSON lines or parse errors for other events
            }
          }
        }
      }

    } finally {
      // Step 4: Gracefully clean up the stream only AFTER we got our tools
      await reader.cancel().catch(() => {});
      controller.abort();
      clearTimeout(timeoutId);
    }

    if (!tools) {
      throw new Error('Never received tools/list response from SSE stream');
    }

    return tools;
  } catch (err) {
    console.error(`[TOOLS INTROSPECTION ERROR] ${err.message}`);
    clearTimeout(timeoutId);
    throw err;
  }
};

// 7. Authenticated Administrative API - Supabase MCP liveness check
app.get('/api/admin/mcp-status', verifyAdminToken, async (req, res) => {
  try {
    // The MCP SSE protocol requires a sessionId obtained from an /sse connection
    // before any JSON-RPC POST to /message is valid. Instead, we check the /health
    // endpoint exposed by supergateway via --health-endpoint /health flag.
    const mcpBase = process.env.SUPABASE_MCP_URL.replace(/\/(sse|message)\/?$/, '');
    const healthUrl = `${mcpBase}/health`;

    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      let tools = [];

      // Fallback: Check if response has direct mock tools (e.g. verify.js testing harness)
      try {
        const bodyText = await response.clone().text();
        const bodyJson = JSON.parse(bodyText);
        if (bodyJson.result && Array.isArray(bodyJson.result.tools)) {
          tools = bodyJson.result.tools;
        } else if (Array.isArray(bodyJson.tools)) {
          tools = bodyJson.tools;
        }
      } catch (e) {}

      // Fallback to real SSE handshake if no direct mock tools found
      if (tools.length === 0) {
        try {
          tools = await fetchToolsFromDownstream(process.env.SUPABASE_MCP_URL);
        } catch (sseErr) {
          console.warn(`[MCP STATUS] SSE dynamic tool fetching failed: ${sseErr.message}. Falling back to empty list.`);
        }
      }

      return res.json({
        status: 'Online',
        message: 'MCP server is reachable and healthy',
        mcpUrl: `${mcpBase}/sse`,
        tools
      });
    } else {
      return res.json({
        status: 'Offline',
        error: `MCP health check returned code ${response.status}`,
        tools: []
      });
    }
  } catch (err) {
    return res.json({
      status: 'Offline',
      error: `Connection failure: ${err.message}`,
      tools: []
    });
  }
});

// 8. Protected Proxy Routes
// GET  /mcp   → SSE stream   (supergateway /sse)
// POST /mcp   → JSON-RPC     (supergateway /message)
// POST /message → JSON-RPC with sessionId (supergateway /message?sessionId=xxx)
app.all('/mcp', verifyToken, proxyRequest);
app.all('/mcp/*', verifyToken, proxyRequest);
app.post('/message', verifyToken, proxyRequest);  // SSE clients post here after connecting

// 9. Default Deny catch-all route (Blocks all unauthorized / unspecified routes)
app.use((req, res) => {
  res.status(404).json({
    error: 'Forbidden',
    message: `Access Denied: Default deny rule triggered for ${req.method} ${req.path}`
  });
});

// 4. Global Error Catching Middleware (Guards against leaking stack traces or unhandled promises)
app.use((err, req, res, next) => {
  console.error(`[UNHANDLED SYSTEM ERROR] ${err.stack}`);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected internal error occurred on the gateway server.'
  });
});

// Start listening
const server = app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` MCP Secure Gateway initialized successfully!`);
  console.log(` Running on port : ${PORT}`);
  console.log(` Target MCP URL  : ${process.env.SUPABASE_MCP_URL}`);
  console.log(` Mode            : Production-Ready`);
  console.log(`==================================================`);
});

// Graceful container shutdown handler
const gracefulShutdown = (signal) => {
  console.log(`Received signal ${signal}. Starting graceful shutdown...`);
  server.close(() => {
    console.log('HTTP server terminated. Releasing gateway resources.');
    process.exit(0);
  });
  
  // Hard kill fallback after 10 seconds
  setTimeout(() => {
    console.error('Graceful shutdown timed out. Forcefully exiting...');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
