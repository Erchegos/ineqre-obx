#!/usr/bin/env node

// Disable SSL certificate validation for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL?.trim().replace(/^["']|["']$/g, ''),
  ssl: false
});

async function checkSummaries() {
  try {
    console.log('Checking research documents summary status...\n');

    // Get recent documents
    const result = await pool.query(`
      SELECT
        id,
        subject,
        source,
        CASE WHEN ai_summary IS NULL THEN 'NO' ELSE 'YES' END as has_summary,
        LENGTH(ai_summary) as summary_length,
        received_date
      FROM research_documents
      ORDER BY received_date DESC
      LIMIT 10
    `);

    console.log('Recent documents:');
    console.log('='.repeat(70));
    for (const row of result.rows) {
      console.log(`${row.subject.substring(0, 60)}...`);
      console.log(`  Source: ${row.source}`);
      console.log(`  Summary: ${row.has_summary} (${row.summary_length || 0} chars)`);
      console.log(`  Date: ${row.received_date}`);
      console.log('');
    }

    // Get statistics
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(ai_summary) as with_summary,
        COUNT(*) - COUNT(ai_summary) as without_summary
      FROM research_documents
    `);

    console.log('Summary Statistics:');
    console.log('='.repeat(70));
    console.log(`Total documents: ${stats.rows[0].total}`);
    console.log(`With summaries: ${stats.rows[0].with_summary}`);
    console.log(`Without summaries: ${stats.rows[0].without_summary}`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkSummaries();
