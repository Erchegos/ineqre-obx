#!/usr/bin/env node

// Disable SSL certificate validation for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL?.trim().replace(/^["']|["']$/g, ''),
  ssl: false
});

async function checkMissingSummaries() {
  try {
    console.log('Checking documents without summaries...\n');

    // Get documents without summaries
    const result = await pool.query(`
      SELECT
        id,
        subject,
        source,
        CASE WHEN body_text IS NULL THEN 'NULL'
             WHEN body_text = '' THEN 'EMPTY'
             ELSE 'HAS_TEXT'
        END as body_text_status,
        LENGTH(body_text) as body_length,
        received_date
      FROM research_documents
      WHERE ai_summary IS NULL
      ORDER BY received_date DESC
      LIMIT 20
    `);

    console.log(`Found ${result.rows.length} documents without summaries:\n`);
    console.log('='.repeat(70));

    for (const row of result.rows) {
      console.log(`${row.subject.substring(0, 60)}...`);
      console.log(`  Source: ${row.source}`);
      console.log(`  Body text: ${row.body_text_status} (${row.body_length || 0} chars)`);
      console.log(`  Date: ${row.received_date}`);
      console.log('');
    }

    // Get breakdown by body_text status
    const breakdown = await pool.query(`
      SELECT
        CASE WHEN body_text IS NULL THEN 'NULL'
             WHEN body_text = '' THEN 'EMPTY'
             ELSE 'HAS_TEXT'
        END as status,
        COUNT(*) as count
      FROM research_documents
      WHERE ai_summary IS NULL
      GROUP BY status
      ORDER BY count DESC
    `);

    console.log('Breakdown by body_text status:');
    console.log('='.repeat(70));
    for (const row of breakdown.rows) {
      console.log(`${row.status}: ${row.count} documents`);
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkMissingSummaries();
