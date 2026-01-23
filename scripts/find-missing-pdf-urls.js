#!/usr/bin/env node
/**
 * Find PDF URLs in documents missing attachments
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: 'apps/web/.env.local' });

let connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL missing');

if (connectionString.includes('supabase.com') && !connectionString.includes('sslmode=')) {
  connectionString = connectionString.replace('?', '?sslmode=require&');
  if (!connectionString.includes('?')) {
    connectionString += '?sslmode=require';
  }
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function main() {
  const result = await pool.query(`
    SELECT id, subject, body_text, raw_email_path, received_date
    FROM research_documents
    WHERE (body_text LIKE '%CLICK HERE FOR THE FULL REPORT%' OR body_text LIKE '%Click to open report%')
      AND attachment_count = 0
    ORDER BY received_date DESC
  `);

  console.log(`Found ${result.rows.length} documents without PDFs\n`);

  // First, check raw email paths
  console.log('Raw email path status:');
  result.rows.forEach((doc, i) => {
    console.log(`  ${i+1}. ${doc.subject}`);
    console.log(`     Raw email: ${doc.raw_email_path || 'NULL'}`);
    console.log(`     Date: ${doc.received_date}`);
  });
  console.log();

  result.rows.forEach((doc, i) => {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Document ${i+1}: ${doc.subject}`);
    console.log(`ID: ${doc.id}`);
    console.log('='.repeat(80));

    // Show last 1000 characters to find the URL at the end
    const endText = doc.body_text.substring(doc.body_text.length - 1000);
    console.log(`\nLast 1000 chars of body:`);
    console.log(endText);

    // Try to extract any URLs
    const urlMatches = doc.body_text.match(/https?:\/\/[^\s<>"']+/gi);
    if (urlMatches) {
      console.log(`\nAll URLs found in document:`);
      urlMatches.forEach(url => console.log(`  - ${url}`));
    } else {
      console.log(`\nNo URLs found in document`);
    }
  });

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
