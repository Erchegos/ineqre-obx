#!/usr/bin/env node
import https from 'https';

const agent = new https.Agent({
  rejectUnauthorized: false
});

async function makeRequest(url, method = 'GET') {
  console.log(`${method} ${url}`);
  try {
    const response = await fetch(url, {
      method,
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
      signal: AbortSignal.timeout(10000)
    });

    const text = await response.text();
    console.log(`Status: ${response.status}`);
    console.log(`Response length: ${text.length} bytes\n`);
    return { ok: response.ok, status: response.status, body: text };
  } catch (error) {
    console.log(`Error: ${error.message}\n`);
    return { ok: false, error: error.message };
  }
}

async function wakeIBKR() {
  const base = 'https://localhost:5000';

  console.log('=== Waking up IB Gateway ===\n');

  // Try different endpoints
  await makeRequest(`${base}/`, 'GET');
  await makeRequest(`${base}/v1/api/iserver/auth/status`, 'POST');
  await makeRequest(`${base}/v1/api/tickle`, 'POST');
  await makeRequest(`${base}/v1/api/iserver/auth/ssodh/init`, 'GET');

  console.log('Done. Check if API Client is now connected.');
}

wakeIBKR();
