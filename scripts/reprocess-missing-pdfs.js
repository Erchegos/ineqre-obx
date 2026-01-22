/**
 * Reprocess specific emails to download their missing PDF attachments
 * This deletes the documents so they can be reprocessed by the email importer
 */

require('dotenv').config();
const { Pool } = require('pg');

let connectionString = process.env.DATABASE_URL.trim().replace(/^["]|["]$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }});

// Subject patterns of documents with missing PDFs
const MISSING_SUBJECTS = [
  'Shipping Daily - OET completing accretive transactions',
  'Plejd - Q4\'25 first take',
  'The Ritz-Carlton Yacht Collection - Bonds set to derisk',
  'Morning Comment Sweden - PDX, BILI, ASTOR',
  'Investor - NAV +6% q/q',
  'Morning Comment Norway - TEL, Seafood',
  'Telenor - Telenor divests True',
  'Avanza Bank Holding - Steady Q4',
  'Bilia - Worth a Wager',
  'Seafood Price Update - Salmon price',
  'Morning Update - 22 JAN 2026',
  'VEF - Moving in the right direction'
];

async function reprocessDocuments() {
  console.log('\n=== Reprocessing Documents with Missing PDFs ===\n');

  let deletedCount = 0;

  for (const subjectPattern of MISSING_SUBJECTS) {
    try {
      // Find document
      const findResult = await pool.query(
        `SELECT id, subject, email_message_id
         FROM research_documents
         WHERE subject LIKE $1
         LIMIT 1`,
        [`${subjectPattern}%`]
      );

      if (findResult.rows.length === 0) {
        console.log(`⚠ Not found: ${subjectPattern}`);
        continue;
      }

      const doc = findResult.rows[0];
      console.log(`\n✓ Found: ${doc.subject.substring(0, 70)}`);
      console.log(`  Message ID: ${doc.email_message_id}`);

      // Delete attachments first (foreign key constraint)
      const attachResult = await pool.query(
        'DELETE FROM research_attachments WHERE document_id = $1 RETURNING filename',
        [doc.id]
      );

      if (attachResult.rows.length > 0) {
        console.log(`  Deleted ${attachResult.rows.length} attachment record(s)`);
      }

      // Delete document
      await pool.query(
        'DELETE FROM research_documents WHERE id = $1',
        [doc.id]
      );

      console.log(`  ✓ Deleted document - will be reprocessed on next email import`);
      deletedCount++;

    } catch (err) {
      console.error(`✗ Error processing "${subjectPattern}":`, err.message);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Documents deleted for reprocessing: ${deletedCount}/${MISSING_SUBJECTS.length}`);
  console.log(`\nNext steps:`);
  console.log(`1. The GitHub Actions workflow will run in ~${30 - (new Date().getMinutes() % 30)} minutes`);
  console.log(`2. Or manually trigger it with: gh workflow run import-emails.yml`);
  console.log(`3. The emails will be reprocessed and PDFs uploaded to the correct bucket`);

  await pool.end();
}

reprocessDocuments().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
