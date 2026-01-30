/**
 * Migrate PDFs from research-documents bucket to research-pdfs bucket
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

async function migratePDFs() {
  console.log('\n=== Migrating PDFs to Correct Bucket ===\n');

  // Get all attachments from recent documents
  const result = await pool.query(`
    SELECT
      a.id as attachment_id,
      a.filename,
      a.file_path,
      d.subject
    FROM research_attachments a
    JOIN research_documents d ON a.document_id = d.id
    WHERE d.received_date >= '2026-01-20'
      AND a.file_path IS NOT NULL
    ORDER BY d.received_date DESC
  `);

  console.log(`Found ${result.rows.length} attachments to check\n`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of result.rows) {
    try {
      // Check if file exists in research-pdfs (correct bucket)
      const { data: correctBucket, error: correctError } = await supabase.storage
        .from('research-pdfs')
        .download(row.file_path);

      if (correctBucket && !correctError) {
        console.log(`✓ SKIP: ${row.subject.substring(0, 60)} (already in correct bucket)`);
        skipped++;
        continue;
      }

      // Try to download from research-documents (wrong bucket)
      const { data: wrongBucket, error: wrongError } = await supabase.storage
        .from('research-documents')
        .download(row.file_path);

      if (!wrongBucket || wrongError) {
        console.log(`✗ NOT FOUND: ${row.subject.substring(0, 60)}`);
        console.log(`  Path: ${row.file_path}\n`);
        errors++;
        continue;
      }

      console.log(`\n⚡ MIGRATING: ${row.subject.substring(0, 60)}`);
      const fileBuffer = Buffer.from(await wrongBucket.arrayBuffer());
      console.log(`  Size: ${(fileBuffer.length / 1024).toFixed(1)} KB`);

      // Upload to correct bucket
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('research-pdfs')
        .upload(row.file_path, fileBuffer, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (uploadError) {
        console.log(`  ✗ Upload failed: ${uploadError.message}\n`);
        errors++;
        continue;
      }

      console.log(`  ✓ Successfully migrated to research-pdfs bucket`);
      migrated++;

      // Optional: Delete from wrong bucket to clean up
      // Uncomment if you want to clean up the old bucket
      // await supabase.storage.from('research-documents').remove([row.file_path]);

    } catch (err) {
      console.log(`✗ ERROR: ${row.subject.substring(0, 60)}`);
      console.log(`  ${err.message}\n`);
      errors++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`✓ PDFs migrated: ${migrated}`);
  console.log(`○ PDFs skipped (already correct): ${skipped}`);
  console.log(`✗ Errors: ${errors}`);

  await pool.end();
}

migratePDFs().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
