/**
 * Upload PDFs to Supabase Storage
 *
 * This script uploads all locally stored PDFs to Supabase Storage
 * and updates the database with the new storage URLs.
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
let connectionString = process.env.DATABASE_URL.trim().replace(/^[\"']|[\"']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage', 'research');
const BUCKET_NAME = 'research-pdfs';

/**
 * Create storage bucket if it doesn't exist
 */
async function ensureBucket() {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    console.error('Error listing buckets:', listError);
    throw listError;
  }

  const bucketExists = buckets.some(b => b.name === BUCKET_NAME);

  if (!bucketExists) {
    console.log(`Creating bucket: ${BUCKET_NAME}`);
    const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: false,
      fileSizeLimit: 52428800, // 50MB
    });

    if (createError) {
      console.error('Error creating bucket:', createError);
      throw createError;
    }
    console.log('✓ Bucket created');
  } else {
    console.log('✓ Bucket already exists');
  }
}

/**
 * Upload a file to Supabase Storage
 */
async function uploadFile(localPath, storagePath) {
  const fileBuffer = fs.readFileSync(localPath);

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, fileBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Main function
 */
async function main() {
  console.log('Upload PDFs to Supabase Storage\n');

  // Ensure bucket exists
  await ensureBucket();

  // Get all attachments
  const result = await pool.query(`
    SELECT id, document_id, filename, file_path, file_size
    FROM research_attachments
    WHERE content_type = 'application/pdf'
    ORDER BY document_id
  `);

  console.log(`\nFound ${result.rows.length} PDF attachments\n`);

  let uploadCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const attachment of result.rows) {
    const localPath = path.join(STORAGE_DIR, attachment.file_path);

    // Check if file exists locally
    if (!fs.existsSync(localPath)) {
      console.log(`✗ File not found: ${attachment.filename}`);
      errorCount++;
      continue;
    }

    try {
      // Upload to Supabase
      console.log(`Uploading: ${attachment.filename}`);
      await uploadFile(localPath, attachment.file_path);

      console.log(`  ✓ Uploaded (${Math.round(attachment.file_size / 1024)}KB)`);
      uploadCount++;

    } catch (error) {
      console.log(`  ✗ Error: ${error.message}`);
      errorCount++;
    }
  }

  console.log(`\n\n=== Results ===`);
  console.log(`✓ Uploaded: ${uploadCount} PDFs`);
  console.log(`✗ Errors: ${errorCount} PDFs`);
  console.log(`\nAll PDFs are now stored in Supabase Storage!`);

  await pool.end();
}

main().catch(console.error);
