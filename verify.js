const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const GATEWAY_PORT = 8080;
const MOCK_MCP_PORT = 8081;
const JWT_SECRET = 'your_super_secret_key_change_me_in_production';
const ADMIN_PASSWORD = 'admin_secret_passphrase';

let mockServer;
let gatewayProcess;

// Ensure database folder exists and is initialized
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir);
}
fs.writeFileSync(path.join(dbDir, 'developers.json'), '[]', 'utf8');

// 1. Helper to start mock Supabase MCP server
function startMockMcpServer() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      // console.log(`  [Mock MCP Server] Received ${req.method} ${req.url}`);
      
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Mock-Header': 'VerifiedPreserved'
        });
        
        let parsedBody = {};
        try {
          if (body) parsedBody = JSON.parse(body);
        } catch (e) {}

        res.end(JSON.stringify({
          status: 'success',
          echoMethod: req.method,
          echoUrl: req.url,
          echoHeaders: req.headers,
          echoBody: parsedBody,
          result: {
            tools: [
              { name: 'list_tables', description: 'Lists self-hosted database tables' },
              { name: 'execute_sql', description: 'Executes administrative SQL commands' }
            ]
          }
        }));
      });
    });

    mockServer.listen(MOCK_MCP_PORT, () => {
      console.log(`[Mock MCP Server] Listening on port ${MOCK_MCP_PORT}`);
      resolve();
    });
  });
}

// 2. Helper to start Gateway process
function startGateway() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, 'src', 'server.js');
    console.log(`[Gateway Test] Starting gateway at ${serverPath}`);
    
    gatewayProcess = spawn('node', [serverPath], {
      env: {
        ...process.env,
        PORT: GATEWAY_PORT.toString(),
        SUPABASE_MCP_URL: `http://localhost:${MOCK_MCP_PORT}/mcp`,
        JWT_SECRET: JWT_SECRET,
        ADMIN_PASSWORD: ADMIN_PASSWORD
      }
    });

    gatewayProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('MCP Secure Gateway initialized successfully!')) {
        resolve();
      }
    });

    gatewayProcess.stderr.on('data', (data) => {
      console.error(`  [Gateway stderr] ${data.toString()}`);
    });

    gatewayProcess.on('error', (err) => {
      reject(err);
    });
  });
}

// 3. Helper to close servers
function cleanup() {
  console.log('[Cleanup] Terminating test processes...');
  if (mockServer) {
    mockServer.close();
  }
  if (gatewayProcess) {
    gatewayProcess.kill('SIGTERM');
  }
  // Clear the test developers.json database
  fs.writeFileSync(path.join(__dirname, 'data', 'developers.json'), '[]', 'utf8');
}

// Global tokens for verification sequencing
let adminToken = '';
let generatedDevId = '';
let generatedDevToken = '';

// 4. Test execution
async function runTests() {
  const badToken = jwt.sign({ sub: 'usr_dev_1001' }, 'wrong_secret', { expiresIn: '1h' });

  const tests = [
    // --- Test 1: Public Health check ---
    {
      name: 'GET /health',
      url: `http://localhost:${GATEWAY_PORT}/health`,
      options: { method: 'GET' },
      assert: async (res, data) => {
        if (res.statusCode !== 200) throw new Error(`Expected status 200, got ${res.statusCode}`);
        const parsed = JSON.parse(data);
        if (parsed.status !== 'OK') throw new Error(`Expected status OK, got ${parsed.status}`);
        console.log('  ✅ GET /health Passed');
      }
    },

    // --- Test 2: Default Deny Route Blocking ---
    {
      name: 'GET /unauthorized-route (Default Deny)',
      url: `http://localhost:${GATEWAY_PORT}/unauthorized-route`,
      options: { method: 'GET' },
      assert: async (res, data) => {
        if (res.statusCode !== 404) throw new Error(`Expected status 404, got ${res.statusCode}`);
        const parsed = JSON.parse(data);
        if (parsed.error !== 'Forbidden') throw new Error(`Expected error Forbidden, got ${parsed.error}`);
        console.log('  ✅ Default Deny Route blocking Passed');
      }
    },

    // --- Test 3: Admin Login with Incorrect Password ---
    {
      name: 'POST /api/admin/login (Wrong Password)',
      url: `http://localhost:${GATEWAY_PORT}/api/admin/login`,
      options: { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong_password_here' })
      },
      assert: async (res, data) => {
        if (res.statusCode !== 401) throw new Error(`Expected status 401, got ${res.statusCode}`);
        const parsed = JSON.parse(data);
        if (parsed.error !== 'Unauthorized') throw new Error(`Expected error Unauthorized, got ${parsed.error}`);
        console.log('  ✅ Admin login rejection Passed');
      }
    },

    // --- Test 4: Admin Login with Correct Password ---
    {
      name: 'POST /api/admin/login (Correct Password)',
      url: `http://localhost:${GATEWAY_PORT}/api/admin/login`,
      options: { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD })
      },
      assert: async (res, data) => {
        if (res.statusCode !== 200) throw new Error(`Expected status 200, got ${res.statusCode}`);
        const parsed = JSON.parse(data);
        if (!parsed.token) throw new Error(`Expected token in response, got ${data}`);
        
        adminToken = parsed.token; // Save for subsequent test requests
        console.log('  ✅ Admin login authorization Passed');
      }
    },

    // --- Test 5: Fetch MCP Status via Admin API ---
    {
      name: 'GET /api/admin/mcp-status (Live MCP Introspection)',
      url: `http://localhost:${GATEWAY_PORT}/api/admin/mcp-status`,
      options: { 
        method: 'GET',
        headers: { 'Authorization': 'Bearer [admin_token]' }
      },
      assert: async (res, data) => {
        if (res.statusCode !== 200) throw new Error(`Expected status 200, got ${res.statusCode}`);
        const parsed = JSON.parse(data);
        if (parsed.status !== 'Online') throw new Error(`Expected status Online, got ${parsed.status}`);
        if (!parsed.tools || parsed.tools.length === 0) throw new Error('Expected active tools list');
        
        console.log('  ✅ Live Downstream MCP Tool Introspection Passed');
      }
    },

    // --- Test 6: Generate Developer Token via Admin API ---
    {
      name: 'POST /api/admin/tokens (Generate Developer Key)',
      url: `http://localhost:${GATEWAY_PORT}/api/admin/tokens`,
      options: { 
        method: 'POST',
        headers: { 
          'Authorization': 'Bearer [admin_token]',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: 'Jane Dev', email: 'jane@enterprise.com', expiresInDays: 30 })
      },
      assert: async (res, data) => {
        if (res.statusCode !== 201) throw new Error(`Expected status 201 Created, got ${res.statusCode}`);
        const parsed = JSON.parse(data);
        if (!parsed.success || !parsed.developer.token) throw new Error('Expected successful developer payload');
        
        generatedDevId = parsed.developer.id;
        generatedDevToken = parsed.developer.token; // Save for dev routing checks
        console.log('  ✅ Admin Token Generation API Passed');
      }
    },

    // --- Test 7: Verify Developer List contains new record ---
    {
      name: 'GET /api/admin/tokens (Inspect Active Developers List)',
      url: `http://localhost:${GATEWAY_PORT}/api/admin/tokens`,
      options: { 
        method: 'GET',
        headers: { 'Authorization': 'Bearer [admin_token]' }
      },
      assert: async (res, data) => {
        if (res.statusCode !== 200) throw new Error(`Expected status 200, got ${res.statusCode}`);
        const parsed = JSON.parse(data);
        const match = parsed.find(d => d.id === generatedDevId);
        if (!match || match.email !== 'jane@enterprise.com' || match.status !== 'active') {
          throw new Error('Newly created developer record is missing or incorrect in database list');
        }
        console.log('  ✅ Admin Registry Listing Passed');
      }
    },

    // --- Test 8: Query /mcp using Generated Developer Token ---
    {
      name: 'POST /mcp (Client Query with Generated Developer Token)',
      url: `http://localhost:${GATEWAY_PORT}/mcp`,
      options: {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer [dev_token]',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'list_tools', params: {}, id: 1 })
      },
      assert: async (res, data) => {
        if (res.statusCode !== 200) throw new Error(`Expected status 200, got ${res.statusCode}`);
        const parsed = JSON.parse(data);
        if (!parsed.result || !parsed.result.tools) throw new Error('Failed to proxy request successfully');
        console.log('  ✅ Client Access via Generated Token Passed');
      }
    },

    // --- Test 9: Revoke Developer Token via Admin API ---
    {
      name: 'DELETE /api/admin/tokens/:id (Revoke Developer Token)',
      url: `http://localhost:${GATEWAY_PORT}/api/admin/tokens/[dev_id]`,
      options: { 
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer [admin_token]' }
      },
      assert: async (res, data) => {
        if (res.statusCode !== 200) throw new Error(`Expected status 200, got ${res.statusCode}`);
        const parsed = JSON.parse(data);
        if (!parsed.success) throw new Error('Revocation was not successful');
        console.log('  ✅ Admin Token Revocation API Passed');
      }
    },

    // --- Test 10: Attempt access using Revoked Developer Token ---
    {
      name: 'POST /mcp (Access Rejection for Revoked Token)',
      url: `http://localhost:${GATEWAY_PORT}/mcp`,
      options: {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer [dev_token]',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'list_tools', params: {}, id: 1 })
      },
      assert: async (res, data) => {
        if (res.statusCode !== 401) throw new Error(`Expected status 401 Unauthorized, got ${res.statusCode}`);
        const parsed = JSON.parse(data);
        if (parsed.message !== 'This token has been revoked by the administrator.') {
          throw new Error(`Expected revocation message, got: ${parsed.message}`);
        }
        console.log('  ✅ Revoked Token Blocking Passed');
      }
    }
  ];

  console.log('\n[Gateway Test Harness] Starting test execution suite...');
  
  for (const test of tests) {
    console.log(`[TEST] Running: ${test.name}`);
    
    // Dynamically resolve URL path parameters
    test.url = test.url.replace('[dev_id]', generatedDevId);
    
    // Dynamically resolve Authorization tokens since they are populated during the test sequence!
    if (test.options.headers && test.options.headers['Authorization']) {
      if (test.options.headers['Authorization'] === 'Bearer [admin_token]') {
        test.options.headers['Authorization'] = `Bearer ${adminToken}`;
      } else if (test.options.headers['Authorization'] === 'Bearer [dev_token]') {
        test.options.headers['Authorization'] = `Bearer ${generatedDevToken}`;
      }
    }

    await new Promise((resolve, reject) => {
      const req = http.request(test.url, test.options, (res) => {
        let resData = '';
        res.on('data', (chunk) => { resData += chunk; });
        res.on('end', async () => {
          try {
            await test.assert(res, resData);
            resolve();
          } catch (e) {
            console.error(`  ❌ Failed assertions: ${e.message}`);
            console.error(`  [Response Status] : ${res.statusCode}`);
            console.error(`  [Response Headers]: ${JSON.stringify(res.headers)}`);
            console.error(`  [Response Body]   : ${resData}`);
            reject(e);
          }
        });
      });

      req.on('error', (e) => {
        console.error(`  ❌ Request error: ${e.message}`);
        reject(e);
      });

      if (test.options.body) {
        req.write(test.options.body);
      }
      req.end();
    });
  }

  console.log('\n🎉 ALL PHASE 2 SECURITY AND SYSTEM TESTS PASSED SUCCESSFULLY! 🎉\n');
}

// 5. Orchestrator
async function main() {
  try {
    await startMockMcpServer();
    await startGateway();
    await runTests();
    cleanup();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ INTEGRATION TESTS FAILED! ❌');
    console.error(err);
    cleanup();
    process.exit(1);
  }
}

main();
