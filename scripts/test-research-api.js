#!/usr/bin/env node
/**
 * Test research API to verify manual uploads are returned
 */

const https = require('https');

// Get JWT token first
async function getToken() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ password: 'RagnerFjeld' });

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/research/auth',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      },
      rejectUnauthorized: false
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(body).token);
        } else {
          reject(new Error(`Auth failed: ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Fetch documents
async function getDocuments(token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/research/documents',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      rejectUnauthorized: false
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Fetch failed: ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('Testing Research API...\n');

  try {
    console.log('1. Getting auth token...');
    const token = await getToken();
    console.log('✓ Got token\n');

    console.log('2. Fetching documents...');
    const docs = await getDocuments(token);
    console.log(`✓ Received ${docs.length} documents\n`);

    // Check for Manual Upload documents
    const manualDocs = docs.filter(d => d.source === 'Manual Upload');
    console.log(`Manual Upload documents: ${manualDocs.length}`);

    if (manualDocs.length > 0) {
      console.log('\nManual uploads found:');
      manualDocs.forEach((doc, i) => {
        console.log(`  ${i+1}. ${doc.subject}`);
        console.log(`     Ticker: ${doc.ticker || 'N/A'}`);
        console.log(`     Summary: ${doc.ai_summary ? 'Yes' : 'No'}`);
        console.log(`     PDFs: ${doc.attachment_count}`);
      });
    } else {
      console.log('❌ No manual upload documents found!');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
