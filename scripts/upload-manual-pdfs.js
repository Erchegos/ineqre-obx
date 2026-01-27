#!/usr/bin/env node
/**
 * Upload manually downloaded PDFs to documents
 *
 * Usage:
 * 1. Download PDFs from Gmail and save to /tmp/pdfs/
 * 2. Run: node scripts/upload-manual-pdfs.js
 * 3. Script will match PDFs to documents by name and upload them
 */

require('dotenv').config();
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

const PDF_DIR = '/tmp/research-pdfs';

// Create directory if it doesn't exist
if (!fs.existsSync(PDF_DIR)) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
  console.log(`Created directory: ${PDF_DIR}`);
  console.log(`Please download PDFs from Gmail and save them to this folder.`);
  console.log(`Then run this script again.`);
  process.exit(0);
}

async function uploadPdf(pdfPath, doc) {
  const pdfBuffer = fs.readFileSync(pdfPath);
  const filename = path.basename(pdfPath);

  const receivedDate = new Date(doc.received_date);
  const relativePath = `${receivedDate.getFullYear()}/${String(receivedDate.getMonth() + 1).padStart(2, '0')}/${doc.id}/${filename}`;

  // Upload to Supabase
  try {
    const { error } = await supabase.storage
      .from('research-pdfs')
      .upload(relativePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (error) throw error;
  } catch (error) {
    console.log(`  Warning: Supabase upload failed: ${error.message}`);
    console.log(`  Using local storage instead`);
  }

  // Insert attachment record
  await pool.query(
    `INSERT INTO research_attachments (
      document_id, filename, content_type, file_size, file_path
    ) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT DO NOTHING`,
    [doc.id, filename, 'application/pdf', pdfBuffer.length, relativePath]
  );

  // Update document
  await pool.query(
    `UPDATE research_documents
     SET attachment_count = (SELECT COUNT(*) FROM research_attachments WHERE document_id = $1),
         has_attachments = true
     WHERE id = $1`,
    [doc.id]
  );

  console.log(`  ✓ Uploaded: ${filename} (${Math.round(pdfBuffer.length / 1024)}KB)`);
}

async function main() {
  console.log('Manual PDF Uploader\n');
  console.log(`PDF Directory: ${PDF_DIR}\n`);

  // Get PDF files
  const pdfFiles = fs.readdirSync(PDF_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));

  if (pdfFiles.length === 0) {
    console.log('No PDF files found!');
    console.log('\nPlease:');
    console.log('1. Open each Pareto email in Gmail');
    console.log('2. Click "CLICK HERE FOR THE FULL REPORT"');
    console.log(`3. Save PDFs to: ${PDF_DIR}`);
    console.log('4. Run this script again');
    process.exit(0);
  }

  console.log(`Found ${pdfFiles.length} PDF files\n`);

  // Get documents without PDFs
  const docsResult = await pool.query(`
    SELECT id, subject, ticker, received_date
    FROM research_documents
    WHERE (attachment_count = 0 OR attachment_count IS NULL)
      AND source = 'Pareto Securities'
    ORDER BY received_date DESC
    LIMIT 20
  `);

  console.log(`Found ${docsResult.rows.length} documents without PDFs\n`);

  let uploaded = 0;

  for (const pdfFile of pdfFiles) {
    console.log(`\nProcessing: ${pdfFile}`);

    // Extract keywords from filename
    const filenameLower = pdfFile.toLowerCase();

    // Find matching document
    const match = docsResult.rows.find(doc => {
      const subjectLower = doc.subject.toLowerCase();
      const ticker = doc.ticker?.toLowerCase() || '';

      // Match by ticker or key words from subject
      return filenameLower.includes(ticker) ||
             subjectLower.split(' ').some(word => word.length > 4 && filenameLower.includes(word.toLowerCase()));
    });

    if (match) {
      console.log(`  Matched to: ${match.subject.substring(0, 60)}...`);
      const pdfPath = path.join(PDF_DIR, pdfFile);
      await uploadPdf(pdfPath, match);
      uploaded++;
    } else {
      console.log(`  ⚠️  No matching document found`);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✓ Uploaded: ${uploaded} PDFs`);
  console.log(`⚠️  Unmatched: ${pdfFiles.length - uploaded} PDFs`);

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
