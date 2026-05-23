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

async function test() {
  console.log('1. Connecting to SSE endpoint to fetch sessionId...');
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
      buffer += dataStr;
      
      // If we see JSON-RPC response in the SSE stream, print it!
      if (dataStr.includes('jsonrpc')) {
        console.log('\n--- Received Event in SSE Stream ---');
        console.log(dataStr);
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
            console.log('\n2. Received Session SSE Endpoint Path:', sessionId);
            
            const messageUrl = `https://${parsedUrl.hostname}${sessionId}`;
            console.log('Sending tools/list request to:', messageUrl);

            const listToolsPayload = {
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/list',
              params: {}
            };

            try {
              const postRes = await postSecure(messageUrl, { 'Authorization': `Bearer ${TOKEN}` }, listToolsPayload);
              console.log('POST status:', postRes.statusCode, 'Body:', postRes.data);
            } catch (e) {
              console.error('Error posting tools/list:', e);
            }
          }
        }
      }
    });
  }).on('error', (err) => {
    console.error('SSE Error:', err);
  });
}

test();
