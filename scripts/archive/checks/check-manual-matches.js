#!/usr/bin/env node
/**
 * Check manual uploads and potential email matches
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=\w+/g, '') + '?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  // Check manual uploads
  const manual = await pool.query(`
    SELECT
      subject,
      ticker,
      received_date::date,
      attachment_count,
      source,
      email_message_id
    FROM research_documents
    WHERE email_message_id LIKE 'manual-%'
    ORDER BY received_date DESC
  `);

  console.log('=== MANUAL UPLOADS ===');
  console.log(`Found ${manual.rows.length} manual uploads\n`);
  manual.rows.forEach(r => {
    console.log(`  ${r.subject}`);
    console.log(`    Ticker: ${r.ticker || 'NULL'}`);
    console.log(`    Date: ${r.received_date}`);
    console.log(`    PDFs: ${r.attachment_count}`);
    console.log(`    Source: ${r.source}\n`);
  });

  // Check for potential email matches
  console.log('\n=== CHECKING FOR EMAIL MATCHES ===\n');

  for (const m of manual.rows) {
    if (!m.ticker) continue;

    const emails = await pool.query(`
      SELECT
        subject,
        ticker,
        received_date::date,
        attachment_count,
        email_message_id
      FROM research_documents
      WHERE ticker = $1
        AND received_date::date = $2
        AND email_message_id NOT LIKE 'manual-%'
    `, [m.ticker, m.received_date]);

    if (emails.rows.length > 0) {
      console.log(`Manual: ${m.subject} (${m.ticker}, ${m.received_date})`);
      emails.rows.forEach(e => {
        console.log(`  → Email match: ${e.subject} (PDFs: ${e.attachment_count})`);
      });
      console.log('');
    }
  }

  await pool.end();
}

main().catch(console.error);
