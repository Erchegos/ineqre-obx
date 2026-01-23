#!/usr/bin/env node
/**
 * Extract URLs from the FULL body_text (no truncation)
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=\w+/g, '') + '?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const result = await pool.query(`
    SELECT id, subject, body_text
    FROM research_documents
    WHERE attachment_count = 0
      AND (body_text LIKE '%CLICK HERE%' OR body_text LIKE '%Click to open%')
    ORDER BY received_date DESC
  `);

  console.log(`Analyzing ${result.rows.length} documents for URLs...\n`);

  result.rows.forEach((doc, i) => {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`${i+1}. ${doc.subject}`);
    console.log('='.repeat(80));

    // Get FULL body text length
    const fullLength = doc.body_text.length;
    console.log(`Body text length: ${fullLength} characters`);

    // Extract ALL URLs (http and https)
    const urlRegex = /https?:\/\/[^\s<>"'\)]+/gi;
    const urls = doc.body_text.match(urlRegex) || [];

    if (urls.length > 0) {
      console.log(`\nFound ${urls.length} URL(s):`);
      urls.forEach((url, idx) => {
        console.log(`  ${idx+1}. ${url}`);
      });

      // Check for PDF URLs specifically
      const pdfUrls = urls.filter(url =>
        url.toLowerCase().includes('.pdf') ||
        url.includes('factset.com') ||
        url.includes('paretosec.com/research')
      );

      if (pdfUrls.length > 0) {
        console.log(`\n✓ PDF URL candidates:`);
        pdfUrls.forEach(url => console.log(`  → ${url}`));
      }
    } else {
      console.log('\n❌ No URLs found');

      // Show last 500 characters
      console.log('\nLast 500 characters of body:');
      console.log(doc.body_text.substring(fullLength - 500));
    }
  });

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
