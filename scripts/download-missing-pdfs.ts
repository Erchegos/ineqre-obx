#!/usr/bin/env tsx
/**
 * Download PDFs from links in research document body text
 * and store them as attachments
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });
dotenv.config({ path: 'apps/web/.env.local' });

let connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL missing');

// Fix SSL mode for Supabase
if (connectionString.includes('supabase.com') && !connectionString.includes('sslmode=')) {
  connectionString = connectionString.replace('?', '?sslmode=require&');
  if (!connectionString.includes('?')) {
    connectionString += '?sslmode=require';
  }
}

const storageDir = process.env.STORAGE_DIR || './storage/research';

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

// Ensure storage directory exists
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

// Extract PDF link from body text
function extractPdfLink(text: string): string | null {
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

  // Look for any PDF link
  const pdfMatch = text.match(/https?:\/\/[^\s]+\.pdf/i);
  if (pdfMatch) {
    return pdfMatch[0];
  }

  return null;
}

// Generate filename from document info
function generateFilename(doc: any): string {
  const date = new Date(doc.received_date).toISOString().slice(0, 10);
  const ticker = doc.ticker || 'UNKNOWN';
  const subject = doc.subject
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);

  return `${ticker}_${date}_${subject}.pdf`;
}

// Download PDF from URL
async function downloadPdf(url: string): Promise<Buffer | null> {
  try {
    console.log(`    Downloading from: ${url.substring(0, 80)}...`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      console.log(`    ❌ HTTP ${response.status}: ${response.statusText}`);
      return null;
    }

    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('pdf')) {
      console.log(`    ⚠️  Not a PDF: ${contentType}`);
      return null;
    }

    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  } catch (error: any) {
    console.log(`    ❌ Download failed: ${error.message}`);
    return null;
  }
}

// Store PDF as attachment
async function storeAttachment(
  documentId: string,
  filename: string,
  buffer: Buffer
): Promise<boolean> {
  try {
    const filepath = path.join(storageDir, `${documentId}_${filename}`);

    // Write file to disk
    fs.writeFileSync(filepath, buffer);

    // Insert attachment record
    await pool.query(
      `INSERT INTO research_attachments (document_id, filename, content_type, file_size, file_path, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [documentId, filename, 'application/pdf', buffer.length, filepath]
    );

    // Update document attachment count
    await pool.query(
      `UPDATE research_documents
       SET attachment_count = (
         SELECT COUNT(*) FROM research_attachments WHERE document_id = $1
       )
       WHERE id = $1`,
      [documentId]
    );

    console.log(`    ✓ Saved: ${filepath} (${(buffer.length / 1024).toFixed(1)} KB)`);
    return true;
  } catch (error: any) {
    console.log(`    ❌ Storage failed: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('Downloading missing PDFs from research documents...\n');

  // Find documents with links but no PDF attachments
  const result = await pool.query(`
    SELECT d.id, d.ticker, d.subject, d.body_text, d.received_date, d.attachment_count
    FROM research_documents d
    WHERE d.body_text LIKE '%https://%'
      AND (
        d.attachment_count = 0
        OR NOT EXISTS (
          SELECT 1 FROM research_attachments a
          WHERE a.document_id = d.id
          AND (a.content_type = 'application/pdf' OR a.filename LIKE '%.pdf')
        )
      )
    ORDER BY d.received_date DESC
  `);

  console.log(`Found ${result.rows.length} documents with PDF links but no PDF attachments\n`);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of result.rows) {
    console.log(`\n[${doc.ticker || 'N/A'}] ${doc.subject}`);
    console.log(`  Date: ${new Date(doc.received_date).toISOString().slice(0, 10)}`);
    console.log(`  Document ID: ${doc.id}`);

    // Extract PDF link
    const pdfLink = extractPdfLink(doc.body_text);

    if (!pdfLink) {
      console.log(`  ⚠️  No PDF link found`);
      skipped++;
      continue;
    }

    // Download PDF
    const buffer = await downloadPdf(pdfLink);

    if (!buffer) {
      failed++;
      continue;
    }

    // Store as attachment
    const filename = generateFilename(doc);
    const success = await storeAttachment(doc.id, filename, buffer);

    if (success) {
      downloaded++;
    } else {
      failed++;
    }

    // Rate limiting - wait 1 second between downloads
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total documents processed: ${result.rows.length}`);
  console.log(`✓ Successfully downloaded: ${downloaded}`);
  console.log(`⚠️  Skipped (no link): ${skipped}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('');

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
