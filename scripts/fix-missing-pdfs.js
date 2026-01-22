/**
 * Find and re-download missing PDFs from Supabase Storage
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

async function fixMissingPDFs() {
  console.log('\n=== Finding Missing PDFs ===\n');

  // Get documents with attachments that should have PDFs
  const result = await pool.query(`
    SELECT
      d.id as document_id,
      d.subject,
      d.body_text,
      a.id as attachment_id,
      a.filename,
      a.file_path
    FROM research_documents d
    JOIN research_attachments a ON d.id = a.document_id
    WHERE d.received_date >= '2026-01-20'
      AND a.file_path IS NOT NULL
    ORDER BY d.received_date DESC
  `);

  console.log(`Checking ${result.rows.length} attachments...\n`);

  let fixed = 0;
  let errors = 0;
  let skipped = 0;

  for (const row of result.rows) {
    try {
      // Check if file exists in Supabase Storage
      const { data: existingFile, error: checkError } = await supabase.storage
        .from('research-pdfs')
        .download(row.file_path);

      if (existingFile && !checkError) {
        console.log(`✓ SKIP: ${row.subject.substring(0, 60)} (already exists)`);
        skipped++;
        continue;
      }

      console.log(`\n⚠ MISSING: ${row.subject.substring(0, 60)}`);
      console.log(`  File path: ${row.file_path}`);

      // Try to extract PDF URL from body_text
      let pdfUrl = null;

      if (row.body_text) {
        // Look for PDF links in email body
        const urlMatch = row.body_text.match(/https?:\/\/[^\s<>"]+\.pdf/i);
        if (urlMatch) {
          pdfUrl = urlMatch[0];
        }
      }

      if (!pdfUrl) {
        console.log(`  ✗ No PDF URL found in email body`);
        errors++;
        continue;
      }

      console.log(`  Downloading from: ${pdfUrl.substring(0, 80)}...`);

      // Download PDF from URL
      const response = await fetch(pdfUrl);
      if (!response.ok) {
        console.log(`  ✗ Download failed: ${response.status} ${response.statusText}`);
        errors++;
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      console.log(`  Downloaded ${(buffer.length / 1024).toFixed(1)} KB`);

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('research-pdfs')
        .upload(row.file_path, buffer, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (uploadError) {
        console.log(`  ✗ Upload failed: ${uploadError.message}`);
        errors++;
        continue;
      }

      console.log(`  ✓ Successfully uploaded to Supabase Storage`);
      fixed++;

    } catch (err) {
      console.log(`  ✗ ERROR: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`✓ PDFs fixed: ${fixed}`);
  console.log(`○ PDFs skipped (already exist): ${skipped}`);
  console.log(`✗ Errors: ${errors}`);

  await pool.end();
}

fixMissingPDFs().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
