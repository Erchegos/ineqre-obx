/**
 * Verify that PDFs actually exist in Supabase Storage
 */

require('dotenv').config();
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyFiles() {
  console.log('\n=== Verifying PDFs in Supabase Storage ===\n');

  // Get recent documents with attachments
  const result = await pool.query(`
    SELECT
      d.subject,
      a.id as attachment_id,
      a.filename,
      a.file_path
    FROM research_documents d
    JOIN research_attachments a ON d.id = a.document_id
    WHERE d.received_date >= '2026-01-22'
      AND a.file_path IS NOT NULL
    ORDER BY d.received_date DESC
    LIMIT 10
  `);

  console.log(`Checking ${result.rows.length} files...\n`);

  let existCount = 0;
  let missingCount = 0;

  for (const row of result.rows) {
    try {
      const { data, error } = await supabase.storage
        .from('research-pdfs')
        .download(row.file_path);

      if (error || !data) {
        console.log(`✗ MISSING: ${row.subject.substring(0, 60)}`);
        console.log(`  Path: ${row.file_path}\n`);
        missingCount++;
      } else {
        console.log(`✓ EXISTS: ${row.subject.substring(0, 60)}`);
        existCount++;
      }
    } catch (err) {
      console.log(`✗ ERROR: ${row.subject.substring(0, 60)}`);
      console.log(`  ${err.message}\n`);
      missingCount++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`✓ Files exist: ${existCount}`);
  console.log(`✗ Files missing: ${missingCount}`);

  await pool.end();
}

verifyFiles().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
