#!/usr/bin/env node
/**
 * Test IBKR Gateway connection
 * Tests both port 4002 and 5000 to determine correct configuration
 */

const https = require('https');

const agent = new https.Agent({
  rejectUnauthorized: false,
});

async function testPort(port) {
  console.log(`\nTesting port ${port}...`);

  const endpoints = [
    '/v1/api/iserver/auth/status',
    '/v1/api/tickle',
    '/v1/api/portal/iserver/auth/status',
  ];

  for (const endpoint of endpoints) {
    const url = `https://localhost:${port}${endpoint}`;
    console.log(`  Testing: ${endpoint}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: 'POST',
        agent,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        console.log(`    [SUCCESS] Status: ${response.status}`);
        console.log(`    Response:`, JSON.stringify(data, null, 2));
        return { port, endpoint, success: true, data };
      } else {
        console.log(`    [FAILED] Status: ${response.status}`);
      }
    } catch (error) {
      console.log(`    [ERROR] ${error.message}`);
    }
  }

  return null;
}

async function main() {
  console.log('IBKR Gateway Connection Test');
  console.log('='.repeat(60));

  // Test common IBKR Gateway ports
  const ports = [4002, 5000, 5001];

  for (const port of ports) {
    const result = await testPort(port);
    if (result) {
      console.log(`\n[OK] Found working IBKR Gateway on port ${result.port}`);
      console.log(`Endpoint: ${result.endpoint}`);
      return;
    }
  }

  console.log('\n[ERROR] Could not connect to IBKR Gateway on any port');
  console.log('Make sure IB Gateway is running and properly configured');
}

main().catch(console.error);
