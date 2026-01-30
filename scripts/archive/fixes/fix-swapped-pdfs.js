/**
 * Fix swapped PDFs - swap the associations between the two articles
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

async function main() {
  console.log('Fixing swapped PDFs...\n');

  // Document IDs
  const trelleborgId = 'cd711ec8-cd00-47ea-8bf9-999f58c0c7dc';
  const indutradeId = '1bedf3c4-f52b-4f9f-b65c-41c3f17c0591';

  // Original source files
  const indutradePdfPath = '/Users/olaslettebak/Documents/Intelligence_Equity_Research/code/Manual_PDF_Analysis/Individual_Stocks_Pareto/467915.pdf';
  const trelleborgPdfPath = '/Users/olaslettebak/Documents/Intelligence_Equity_Research/code/Manual_PDF_Analysis/Individual_Stocks_Pareto/467917.pdf';

  console.log('Step 1: Delete wrong attachments from database');
  await pool.query('DELETE FROM research_attachments WHERE document_id IN ($1, $2)', [trelleborgId, indutradeId]);
  console.log('  ✓ Deleted wrong attachments\n');

  console.log('Step 2: Delete wrong files from local storage');
  const trelleborgStorageDir = path.join(CONFIG.storageDir, '2026/01', trelleborgId);
  const indutradeStorageDir = path.join(CONFIG.storageDir, '2026/01', indutradeId);

  if (fs.existsSync(trelleborgStorageDir)) {
    fs.rmSync(trelleborgStorageDir, { recursive: true });
    console.log('  ✓ Deleted Trelleborg storage dir');
  }
  if (fs.existsSync(indutradeStorageDir)) {
    fs.rmSync(indutradeStorageDir, { recursive: true });
    console.log('  ✓ Deleted Indutrade storage dir');
  }
  console.log();

  console.log('Step 3: Delete wrong files from Supabase Storage');
  await supabase.storage.from('research-pdfs').remove([
    `2026/01/${trelleborgId}/467915.pdf`,
    `2026/01/${indutradeId}/467917.pdf`
  ]);
  console.log('  ✓ Deleted from Supabase\n');

  console.log('Step 4: Add correct PDFs to Trelleborg article (467917.pdf)');
  const trelleborgBuffer = fs.readFileSync(trelleborgPdfPath);
  const trelleborgRelativePath = `2026/01/${trelleborgId}/467917.pdf`;

  // Save to local storage
  const trelleborgFullPath = path.join(CONFIG.storageDir, trelleborgRelativePath);
  fs.mkdirSync(path.dirname(trelleborgFullPath), { recursive: true });
  fs.writeFileSync(trelleborgFullPath, trelleborgBuffer);
  console.log('  ✓ Saved to local storage');

  // Upload to Supabase
  await supabase.storage.from('research-pdfs').upload(trelleborgRelativePath, trelleborgBuffer, {
    contentType: 'application/pdf',
    upsert: true
  });
  console.log('  ✓ Uploaded to Supabase');

  // Insert into database
  await pool.query(
    `INSERT INTO research_attachments (document_id, filename, content_type, file_size, file_path)
     VALUES ($1, $2, $3, $4, $5)`,
    [trelleborgId, '467917.pdf', 'application/pdf', trelleborgBuffer.length, trelleborgRelativePath]
  );
  await pool.query(
    `UPDATE research_documents SET attachment_count = 1, has_attachments = true WHERE id = $1`,
    [trelleborgId]
  );
  console.log('  ✓ Updated database\n');

  console.log('Step 5: Add correct PDFs to Indutrade article (467915.pdf)');
  const indutradeBuffer = fs.readFileSync(indutradePdfPath);
  const indutradeRelativePath = `2026/01/${indutradeId}/467915.pdf`;

  // Save to local storage
  const indutradeFullPath = path.join(CONFIG.storageDir, indutradeRelativePath);
  fs.mkdirSync(path.dirname(indutradeFullPath), { recursive: true });
  fs.writeFileSync(indutradeFullPath, indutradeBuffer);
  console.log('  ✓ Saved to local storage');

  // Upload to Supabase
  await supabase.storage.from('research-pdfs').upload(indutradeRelativePath, indutradeBuffer, {
    contentType: 'application/pdf',
    upsert: true
  });
  console.log('  ✓ Uploaded to Supabase');

  // Insert into database
  await pool.query(
    `INSERT INTO research_attachments (document_id, filename, content_type, file_size, file_path)
     VALUES ($1, $2, $3, $4, $5)`,
    [indutradeId, '467915.pdf', 'application/pdf', indutradeBuffer.length, indutradeRelativePath]
  );
  await pool.query(
    `UPDATE research_documents SET attachment_count = 1, has_attachments = true WHERE id = $1`,
    [indutradeId]
  );
  console.log('  ✓ Updated database\n');

  console.log('=== Fix Complete ===');
  console.log('✓ Trelleborg article now has 467917.pdf (correct)');
  console.log('✓ Indutrade article now has 467915.pdf (correct)');

  await pool.end();
}

main().catch(console.error);
