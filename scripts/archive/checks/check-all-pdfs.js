/**
 * Check ALL PDFs in database and identify which ones are missing
 */

require('dotenv').config();
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

let connectionString = process.env.DATABASE_URL.trim().replace(/^["]|["]$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAllPDFs() {
  console.log('\n=== Checking ALL PDFs in Database ===\n');

  // Get all documents with attachments
  const result = await pool.query(`
    SELECT
      d.id as document_id,
      d.subject,
      d.received_date,
      a.id as attachment_id,
      a.filename,
      a.file_path
    FROM research_documents d
    JOIN research_attachments a ON d.id = a.document_id
    WHERE a.file_path IS NOT NULL
    ORDER BY d.received_date DESC
  `);

  console.log(`Found ${result.rows.length} total attachments\n`);

  let existCount = 0;
  let missingCount = 0;
  const missingDocs = [];

  for (const row of result.rows) {
    try {
      const { data, error } = await supabase.storage
        .from('research-pdfs')
        .download(row.file_path);

      if (error || !data) {
        missingCount++;
        missingDocs.push({
          subject: row.subject,
          date: row.received_date,
          path: row.file_path
        });
      } else {
        existCount++;
      }
    } catch (err) {
      missingCount++;
      missingDocs.push({
        subject: row.subject,
        date: row.received_date,
        path: row.file_path
      });
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`✓ Files exist: ${existCount}`);
  console.log(`✗ Files missing: ${missingCount}`);

  if (missingDocs.length > 0) {
    console.log(`\n=== Missing PDFs ===`);
    missingDocs.forEach((doc, idx) => {
      const date = new Date(doc.date).toLocaleDateString();
      console.log(`${idx + 1}. [${date}] ${doc.subject.substring(0, 70)}`);
    });
  }

  await pool.end();
}

checkAllPDFs().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
