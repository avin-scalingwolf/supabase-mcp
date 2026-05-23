const https = require('https');

const GATEWAY_URL = 'https://testingmcp.scalingwolf.ai/mcp';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZXZfMTc3OTUzNzM5Mzk1OV9ydXVvNiIsImVtYWlsIjoiYXZpbkBzY2FsaW5nd29sZi5haSIsInJvbGUiOiJkZXZlbG9wZXIiLCJpYXQiOjE3Nzk1MzczOTMsImV4cCI6MTc4MjEyOTM5M30.UssNHiCYEBXej82Sp3IcqSdlMjdnVN0_n6WMTxR4N0M';

function postSecure(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function listSchemas() {
  console.log('Connecting to MCP Gateway via SSE...');
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Accept': 'text/event-stream'
  };

  const parsedUrl = new URL(GATEWAY_URL);
  const options = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname,
    headers
  };

  https.get(options, (res) => {
    console.log('SSE connection status:', res.statusCode);
    
    let buffer = '';
    let sessionId = '';
    
    res.on('data', async (chunk) => {
      const dataStr = chunk.toString();
      console.log('Received data chunk:', dataStr);
      buffer += dataStr;
      
      if (dataStr.includes('jsonrpc')) {
        res.destroy();
        process.exit(0);
      }

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data:')) {
          const content = line.replace('data:', '').trim();
          if (content.startsWith('/message')) {
            sessionId = content;
            console.log('Session established. Session ID:', sessionId);
            
            const messageUrl = `https://${parsedUrl.hostname}${sessionId}`;
            console.log('Sending MCP JSON-RPC call to call_tool/query...');

            const callToolPayload = {
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: {
                name: 'query',
                arguments: {
                  sql: 'SELECT schema_name FROM information_schema.schemata ORDER BY schema_name;'
                }
              }
            };

            try {
              const postRes = await postSecure(messageUrl, { 'Authorization': `Bearer ${TOKEN}` }, callToolPayload);
              console.log('POST Status:', postRes.statusCode, 'Body:', postRes.data);
            } catch (e) {
              console.error('Error calling MCP tool:', e);
            }
          }
        }
      }
    });

    res.on('end', () => {
      console.log('Connection ended by server.');
    });
  }).on('error', (err) => {
    console.error('SSE connection error:', err);
  });
}

listSchemas();
