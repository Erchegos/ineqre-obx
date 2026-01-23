#!/usr/bin/env node
/**
 * Test cleaning summaries with "Main Investment Thesis" text
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=\w+/g, '') + '?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  // Find summaries with 'Main Investment Thesis'
  const result = await pool.query(`
    SELECT id, subject, ai_summary
    FROM research_documents
    WHERE ai_summary LIKE '%Main Investment Thesis%'
       OR ai_summary LIKE '%Key Point%'
    LIMIT 10
  `);

  console.log(`Found ${result.rows.length} summaries with problematic text\n`);

  let cleaned = 0;

  for (const doc of result.rows) {
    console.log(`Subject: ${doc.subject.substring(0, 60)}...`);
    console.log(`First 200 chars: ${doc.ai_summary.substring(0, 200)}...\n`);

    // Clean it
    let summary = doc.ai_summary;
    // Remove "Summary:" at the start
    summary = summary.replace(/^Summary:\s*\n+/i, '');
    // Remove headers at start of lines or paragraphs
    summary = summary.replace(/^(Main Investment Thesis\/Recommendation|Main Investment Thesis or Key Recommendation|Main Thesis and Recommendation|Main Thesis and Recommendations|Key Financial(s| Metrics)( and Estimates)?|Significant Events(, Catalysts,? or Changes)?|Target Price or Rating|Target Price\/Rating|Catalysts and Key Events|Key Points?|Important Financial (Metrics|Information)):\s*/gim, '');
    summary = summary.replace(/\n\s*(Main Investment Thesis\/Recommendation|Main Investment Thesis or Key Recommendation|Main Thesis and Recommendation|Main Thesis and Recommendations|Key Financial(s| Metrics)(,? and Estimates|, Estimates,? and Valuation)?|Significant Events(, Catalysts,? (or|and) Changes)?|Target Price or Rating|Target Price\/Rating|Catalysts and Key Events|Key Points?|Important Financial (Metrics|Information)):\s*/gim, '\n');
    summary = summary.replace(/\n{3,}/g, '\n\n');
    summary = summary.trim();

    if (summary !== doc.ai_summary) {
      await pool.query(
        `UPDATE research_documents SET ai_summary = $1 WHERE id = $2`,
        [summary, doc.id]
      );
      console.log(`✓ Cleaned: ${doc.subject.substring(0, 60)}...\n`);
      cleaned++;
    }
  }

  console.log(`\n✓ Total cleaned: ${cleaned}`);

  await pool.end();
}

main().catch(console.error);
