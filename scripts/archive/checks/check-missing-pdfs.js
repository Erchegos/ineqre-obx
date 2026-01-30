/**
 * Check for documents with missing PDF attachments
 */

require('dotenv').config();
const { Pool } = require('pg');

let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }});

async function checkAttachments() {
  console.log('\n=== Checking for Missing PDF Files ===\n');

  const result = await pool.query(`
    SELECT
      d.id,
      d.subject,
      d.received_date,
      a.id as attachment_id,
      a.filename,
      a.file_path
    FROM research_documents d
    LEFT JOIN research_attachments a ON d.id = a.document_id
    WHERE d.received_date >= '2026-01-20'
      AND (a.file_path IS NULL OR a.file_path = '')
    ORDER BY d.received_date DESC
    LIMIT 20
  `);

  if (result.rows.length === 0) {
    console.log('✓ All recent documents have PDF files!\n');
  } else {
    console.log(`Found ${result.rows.length} documents with missing PDF files:\n`);
    result.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.subject.substring(0, 70)}`);
      console.log(`   Date: ${new Date(row.received_date).toLocaleString()}`);
      console.log(`   Attachment ID: ${row.attachment_id || 'None'}`);
      console.log(`   File path: ${row.file_path || 'MISSING'}\n`);
    });
  }

  await pool.end();
}

checkAttachments().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
