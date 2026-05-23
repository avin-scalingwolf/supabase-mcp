const SUPABASE_MCP_URL = process.env.SUPABASE_MCP_URL;

if (!SUPABASE_MCP_URL) {
  console.error('FATAL ERROR: SUPABASE_MCP_URL is not defined in the environment variables.');
  process.exit(1);
}

// Parse base URL — strip any trailing /sse or /message path so we always work from the base
let parsedTargetUrl;
try {
  parsedTargetUrl = new URL(SUPABASE_MCP_URL);
} catch (e) {
  console.error(`FATAL ERROR: Invalid SUPABASE_MCP_URL configuration: ${SUPABASE_MCP_URL}`);
  process.exit(1);
}

// Derive clean base URL (e.g. http://supabase-mcp-server:3000)
const MCP_BASE_URL = `${parsedTargetUrl.protocol}//${parsedTargetUrl.host}`;

/**
 * Proxy Request Handler
 *
 * MCP over SSE uses two endpoints on the downstream server:
 *   GET  /sse     — SSE stream that the client subscribes to for server push events
 *   POST /message — JSON-RPC endpoint the client sends tool calls to
 *
 * Routing logic:
 *   GET  /mcp   → downstream GET  /sse      (open SSE stream, pipe back to client)
 *   POST /mcp   → downstream POST /message  (JSON-RPC tool call)
 */
async function proxyRequest(req, res) {
  // Preserve query string (e.g. ?sessionId=xxx that supergateway uses)
  const queryStr = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';

  // Route based on HTTP method
  const isSSE = req.method === 'GET';
  const targetUrlString = isSSE
    ? `${MCP_BASE_URL}/sse${queryStr}`
    : `${MCP_BASE_URL}/message${queryStr}`;

  // Copy and sanitize request headers
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lowerKey = key.toLowerCase();
    // Exclude hop-by-hop and authorization headers (gateway already verified the client token)
    if ([
      'host',
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
      'authorization'
    ].includes(lowerKey)) {
      continue;
    }
    headers[key] = value;
  }

  // Ensure content-type defaults to application/json for request bodies
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  // Secure Downstream Key Injection
  // Inject master Supabase Service Role Key so clients never need to hold it
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
    headers['apikey'] = serviceKey;
    headers['authorization'] = `Bearer ${serviceKey}`;
  }

  // Prepare request body for non-GET requests
  let body = undefined;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (req.body) {
      if (typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        body = JSON.stringify(req.body);
      } else if (typeof req.body === 'string') {
        body = req.body;
      } else if (Buffer.isBuffer(req.body)) {
        body = req.body;
      }
    }
  }

  // SSE connections are long-lived — no timeout; all others get 30s
  const controller = new AbortController();
  const timeoutId = isSSE ? null : setTimeout(() => controller.abort(), 30000);

  try {
    console.log(`[PROXYING] ${req.method} ${req.originalUrl} -> ${targetUrlString}`);

    const response = await fetch(targetUrlString, {
      method: req.method,
      headers,
      body,
      signal: controller.signal,
    });

    if (timeoutId) clearTimeout(timeoutId);

    // Forward response headers (skip hop-by-hop)
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (!['connection', 'transfer-encoding', 'content-encoding', 'content-length'].includes(lowerKey)) {
        res.setHeader(key, value);
      }
    });

    res.status(response.status);

    const contentType = response.headers.get('content-type') || '';

    // SSE stream — pipe chunks directly to the client as they arrive
    if (contentType.includes('text/event-stream')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      // Cancel the upstream reader when the client disconnects
      req.on('close', () => reader.cancel().catch(() => {}));

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
        }
      } finally {
        res.end();
      }
      return;
    }

    // Standard JSON response
    if (contentType.includes('application/json')) {
      const json = await response.json();
      return res.json(json);
    }

    // Fallback: plain text / other
    const text = await response.text();
    return res.send(text);

  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      console.error(`[PROXY TIMEOUT] Downstream request to ${targetUrlString} timed out`);
      return res.status(504).json({
        error: 'Gateway Timeout',
        message: 'The Supabase MCP server did not respond in time'
      });
    }

    console.error(`[PROXY ERROR] Downstream request failed: ${err.message}`);
    return res.status(502).json({
      error: 'Bad Gateway',
      message: 'Failed to communicate with the Supabase MCP server',
      details: err.message
    });
  }
}

module.exports = proxyRequest;
