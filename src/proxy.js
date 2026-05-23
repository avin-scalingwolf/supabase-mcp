const SUPABASE_MCP_URL = process.env.SUPABASE_MCP_URL;

if (!SUPABASE_MCP_URL) {
  console.error('FATAL ERROR: SUPABASE_MCP_URL is not defined in the environment variables.');
  process.exit(1);
}

// Parse base URL for path resolution
let parsedTargetUrl;
try {
  parsedTargetUrl = new URL(SUPABASE_MCP_URL);
} catch (e) {
  console.error(`FATAL ERROR: Invalid SUPABASE_MCP_URL configuration: ${SUPABASE_MCP_URL}`);
  process.exit(1);
}

/**
 * Proxy Request Handler
 * Proxies the request to the target self-hosted Supabase MCP endpoint.
 */
async function proxyRequest(req, res) {
  // Resolve final target URL with sub-path and query parameters
  // e.g. If SUPABASE_MCP_URL = "http://target/mcp"
  // And incoming request path = "/mcp/tools?foo=bar"
  // The subpath relative to "/mcp" is "/tools"
  // The final target should be "http://target/mcp/tools?foo=bar"
  const subpath = req.path.replace(/^\/mcp/, '');
  const queryStr = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  
  let targetUrlString;
  try {
    const combinedPath = (parsedTargetUrl.pathname.replace(/\/$/, '') + subpath).replace(/\/+/g, '/');
    const finalUrl = new URL(combinedPath + queryStr, parsedTargetUrl.origin);
    targetUrlString = finalUrl.toString();
  } catch (urlErr) {
    console.error(`[PROXY ERROR] Failed to resolve target URL: ${urlErr.message}`);
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Failed to resolve downstream URL path'
    });
  }

  // Copy and sanitize request headers
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    // Exclude hop-by-hop, connection, host, and authorization (gateway already verified it)
    const lowerKey = key.toLowerCase();
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

  // Ensure content-type defaults to application/json if there's a body and it is missing
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  // Secure Downstream Key Shielding & Injection
  // If the master Supabase Service Role Key is configured in the gateway, securely inject it
  // into downstream request headers to authorize database commands.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
    headers['apikey'] = serviceKey;
    headers['authorization'] = `Bearer ${serviceKey}`;
  }

  // Prepare request body
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  const requestOptions = {
    method: req.method,
    headers: headers,
    body: body,
    signal: controller.signal,
    // Note: in local dev with self-signed certs you could use an agent, but in production Node standard fetch handles certs via system pool
  };

  try {
    console.log(`[PROXYING] ${req.method} ${req.originalUrl} -> ${targetUrlString}`);
    const response = await fetch(targetUrlString, requestOptions);
    clearTimeout(timeoutId);

    // Forward downstream response headers
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      // Exclude connection/encoding headers that Express/Node handles
      if (!['connection', 'transfer-encoding', 'content-encoding', 'content-length'].includes(lowerKey)) {
        res.setHeader(key, value);
      }
    });

    // Set status
    res.status(response.status);

    // Stream or read the body
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await response.json();
      return res.json(json);
    } else {
      const text = await response.text();
      return res.send(text);
    }

  } catch (err) {
    clearTimeout(timeoutId);
    
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
