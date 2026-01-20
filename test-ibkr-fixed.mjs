#!/usr/bin/env node
import https from 'https';

const agent = new https.Agent({
  rejectUnauthorized: false
});

async function testHealth() {
  console.log('Testing IBKR health check...\n');

  try {
    const response = await fetch('https://localhost:5000/v1/api/tickle', {
      method: 'POST',
      agent: agent,
      signal: AbortSignal.timeout(5000)
    });

    console.log('Status:', response.status, response.statusText);

    if (response.ok) {
      const data = await response.json();
      console.log('✓ Success! IB Gateway is responding');
      console.log('Response:', data);
    } else {
      const text = await response.text();
      console.log('Response body:', text);
    }
  } catch (error) {
    console.log('✗ Error:', error.message);
  }
}

testHealth();
