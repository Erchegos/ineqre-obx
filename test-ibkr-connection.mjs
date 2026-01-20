#!/usr/bin/env node
import https from 'https';

// Create an HTTPS agent that accepts self-signed certificates
const agent = new https.Agent({
  rejectUnauthorized: false
});

async function testIBKR() {
  console.log('Testing IBKR Gateway connection...\n');

  try {
    const response = await fetch('https://localhost:5000/v1/api/tickle', {
      method: 'POST',
      agent: agent,
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✓ IB Gateway is responding!');
      console.log('Response:', data);
      return true;
    } else {
      console.log('✗ IB Gateway responded but with error:', response.status, response.statusText);
      return false;
    }
  } catch (error) {
    console.log('✗ Failed to connect to IB Gateway');
    console.error('Error:', error.message);
    return false;
  }
}

testIBKR();
