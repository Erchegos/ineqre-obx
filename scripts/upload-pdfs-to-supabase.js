/**
 * Upload PDFs to Supabase Storage
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Supabase setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Database setup
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

const CONFIG = {
  storageDir: process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage', 'research'),
};

/**
 * Upload PDF to Supabase Storage
 */
async function uploadToSupabase(documentId, attachmentId, filename, filePath) {
  console.log(`\nUploading ${filename} to Supabase Storage...`);
  console.log(`  Document ID: ${documentId}`);
  console.log(`  Attachment ID: ${attachmentId}`);
  console.log(`  File path: ${filePath}`);

  try {
    // Read the file from local storage
    const fullPath = path.join(CONFIG.storageDir, filePath);
    if (!fs.existsSync(fullPath)) {
      console.log(`  ✗ Local file not found: ${fullPath}`);
      return false;
    }

    const fileBuffer = fs.readFileSync(fullPath);
    console.log(`  File size: ${Math.round(fileBuffer.length / 1024)}KB`);

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('research-pdfs')
      .upload(filePath, fileBuffer, {
        contentType: 'application/pdf',
        upsert: true // Overwrite if exists
      });

    if (error) {
      console.log(`  ✗ Upload error: ${error.message}`);
      return false;
    }

    console.log(`  ✓ Successfully uploaded to Supabase Storage`);
    return true;
  } catch (error) {
    console.log(`  ✗ Error: ${error.message}`);
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('Uploading PDFs for the last two articles to Supabase Storage...\n');

  // Get the attachments for the last two articles
  const result = await pool.query(`
    SELECT a.id, a.document_id, a.filename, a.file_path, d.subject
    FROM research_attachments a
    JOIN research_documents d ON a.document_id = d.id
    WHERE d.id IN ('cd711ec8-cd00-47ea-8bf9-999f58c0c7dc', '1bedf3c4-f52b-4f9f-b65c-41c3f17c0591')
    ORDER BY d.received_date DESC
  `);

  console.log(`Found ${result.rows.length} attachments to upload\n`);

  let successCount = 0;

  for (const row of result.rows) {
    console.log(`Article: ${row.subject}`);

    const success = await uploadToSupabase(
      row.document_id,
      row.id,
      row.filename,
      row.file_path
    );

    if (success) successCount++;
  }

  console.log(`\n\n=== Results ===`);
  console.log(`✓ Successfully uploaded: ${successCount} PDFs`);
  console.log(`✗ Failed: ${result.rows.length - successCount} PDFs`);

  await pool.end();
}

main().catch(console.error);
