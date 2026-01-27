#!/usr/bin/env node
/**
 * Download PDFs from links already stored in document body_text
 */

require('dotenv').config();
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
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

const storageDir = process.env.STORAGE_DIR || './storage/research';

// Ensure storage directory exists
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

/**
 * Extract PDF link from body text
 */
function extractPdfLink(text) {
  if (!text) return null;

  // Look for "Full Report:" followed by URL
  const fullReportMatch = text.match(/Full Report:\s*(https?:\/\/[^\s]+)/i);
  if (fullReportMatch) {
    return fullReportMatch[1];
  }

  // Fallback to FactSet hosting links
  const factsetMatch = text.match(/https:\/\/parp\.hosting\.factset\.com[^\s]+/);
  if (factsetMatch) {
    return factsetMatch[0];
  }

  // Look for research.paretosec.com links
  const paretoMatch = text.match(/https:\/\/research\.paretosec\.com[^\s]+/);
  if (paretoMatch) {
    return paretoMatch[0];
  }

  return null;
}

/**
 * Download PDF from URL
 */
async function downloadPDF(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      console.log(`  ✗ HTTP ${response.status}: ${response.statusText}`);
      return null;
    }

    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('pdf')) {
      console.log(`  ⚠️  Not a PDF: ${contentType}`);
      return null;
    }

    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  } catch (error) {
    console.log(`  ✗ Download failed: ${error.message}`);
    return null;
  }
}

/**
 * Save to Supabase Storage
 */
async function saveToSupabaseStorage(content, relativePath) {
  try {
    const { data, error } = await supabase.storage
      .from('research-pdfs')
      .upload(relativePath, content, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (error) throw error;
    return relativePath;
  } catch (error) {
    console.error(`  Failed to upload to Supabase: ${error.message}`);

    // Fallback to local storage
    const fullPath = path.join(storageDir, relativePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content);
    console.log(`  Saved to local storage: ${relativePath}`);
    return relativePath;
  }
}

async function main() {
  console.log('Downloading PDFs from links in body_text...\n');

  // Get documents without PDFs
  const result = await pool.query(`
    SELECT id, subject, ticker, body_text, received_date
    FROM research_documents
    WHERE (attachment_count = 0 OR attachment_count IS NULL)
      AND body_text IS NOT NULL
    ORDER BY received_date DESC
    LIMIT 20
  `);

  console.log(`Found ${result.rows.length} documents without PDFs\n`);

  let successCount = 0;
  let failCount = 0;
  let noLinkCount = 0;

  for (const doc of result.rows) {
    console.log(`\nProcessing: ${doc.subject.substring(0, 60)}...`);

    // Extract PDF link from body text
    const pdfUrl = extractPdfLink(doc.body_text);

    if (!pdfUrl) {
      console.log('  ⚠️  No PDF link found in body text');
      noLinkCount++;
      continue;
    }

    console.log(`  Found URL: ${pdfUrl.substring(0, 80)}...`);
    console.log('  Downloading...');

    // Download PDF
    const pdfBuffer = await downloadPDF(pdfUrl);

    if (!pdfBuffer || pdfBuffer.length < 1000) {
      console.log('  ✗ Download failed or file too small');
      failCount++;
      continue;
    }

    // Generate filename
    const cleanSubject = doc.subject.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
    const filename = `${doc.ticker || 'report'}_${cleanSubject}.pdf`;

    // Generate path
    const receivedDate = new Date(doc.received_date);
    const relativePath = `${receivedDate.getFullYear()}/${String(receivedDate.getMonth() + 1).padStart(2, '0')}/${doc.id}/${filename}`;

    // Save to storage
    await saveToSupabaseStorage(pdfBuffer, relativePath);

    // Insert attachment record
    await pool.query(
      `INSERT INTO research_attachments (
        document_id, filename, content_type, file_size, file_path
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT DO NOTHING`,
      [doc.id, filename, 'application/pdf', pdfBuffer.length, relativePath]
    );

    // Update document attachment count
    await pool.query(
      `UPDATE research_documents
       SET attachment_count = (SELECT COUNT(*) FROM research_attachments WHERE document_id = $1),
           has_attachments = true
       WHERE id = $1`,
      [doc.id]
    );

    console.log(`  ✓ Success: ${Math.round(pdfBuffer.length / 1024)}KB`);
    successCount++;

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`✓ Downloaded: ${successCount}`);
  console.log(`✗ Failed: ${failCount}`);
  console.log(`⚠️  No link: ${noLinkCount}`);

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
