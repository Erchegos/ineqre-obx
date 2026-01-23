#!/usr/bin/env node
/**
 * Clean existing AI summaries that contain prompt language
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=\w+/g, '') + '?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  console.log('Cleaning AI summaries with prompt language...\n');

  // Find summaries that start with "Here is"
  const result = await pool.query(`
    SELECT id, subject, ai_summary
    FROM research_documents
    WHERE ai_summary LIKE 'Here is%'
       OR ai_summary LIKE 'Based on%'
    ORDER BY received_date DESC
  `);

  console.log(`Found ${result.rows.length} summaries to clean\n`);

  let cleaned = 0;

  for (const doc of result.rows) {
    let summary = doc.ai_summary;

    // Remove prompt language
    summary = summary.replace(/^Here is (a|the) (concise,?\s*)?(professional\s*)?summary[^:]*:\s*/i, '');
    summary = summary.replace(/^Based on the (content|report)[^:]*:\s*/i, '');
    summary = summary.trim();

    if (summary !== doc.ai_summary) {
      await pool.query(
        `UPDATE research_documents SET ai_summary = $1 WHERE id = $2`,
        [summary, doc.id]
      );

      console.log(`✓ Cleaned: ${doc.subject.substring(0, 60)}...`);
      cleaned++;
    }
  }

  console.log(`\n✓ Cleaned ${cleaned} summaries`);

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
