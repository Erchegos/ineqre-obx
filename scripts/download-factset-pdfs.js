#!/usr/bin/env node
/**
 * Download PDFs from FactSet tracking URLs with proper headers
 */

const { Pool } = require('pg');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=\w+/g, '') + '?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

const storageDir = process.env.STORAGE_DIR || './storage/research';

if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

// Download PDF with proper headers and follow redirects
function downloadPdf(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      }
    };

    https.get(url, options, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) {
        const redirectUrl = res.headers.location;
        console.log(`    Following redirect to: ${redirectUrl.substring(0, 80)}...`);
        downloadPdf(redirectUrl).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);

        // Check if it's actually a PDF
        if (buffer.length > 4 && buffer.toString('utf8', 0, 4) === '%PDF') {
          resolve(buffer);
        } else {
          reject(new Error(`Response is not a PDF (starts with: ${buffer.toString('utf8', 0, 100)})`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log('Downloading PDFs from FactSet URLs...\n');

  const result = await pool.query(`
    SELECT d.id, d.ticker, d.subject, d.received_date,
           substring(d.body_text from 'Full Report: ([^\\n]+)') as pdf_url
    FROM research_documents d
    WHERE d.attachment_count = 0
      AND d.body_text LIKE '%Full Report: https://parp.hosting.factset.com%'
      AND d.received_date::date = '2026-01-23'
    ORDER BY d.received_date DESC
  `);

  console.log(`Found ${result.rows.length} documents with FactSet URLs\n`);

  let downloaded = 0;
  let failed = 0;

  for (const doc of result.rows) {
    console.log(`\n[${doc.ticker || 'N/A'}] ${doc.subject}`);
    console.log(`  Date: ${new Date(doc.received_date).toISOString().slice(0, 10)}`);
    console.log(`  URL: ${doc.pdf_url.substring(0, 80)}...`);

    try {
      console.log('  Downloading...');
      const buffer = await downloadPdf(doc.pdf_url);

      console.log(`  ✓ Downloaded ${(buffer.length / 1024).toFixed(1)} KB`);

      // Generate filename
      const cleanSubject = doc.subject.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
      const filename = `${doc.ticker || 'UNKNOWN'}_${new Date(doc.received_date).toISOString().slice(0, 10)}_${cleanSubject}.pdf`;
      const filepath = path.join(storageDir, `${doc.id}_${filename}`);

      // Save file
      fs.writeFileSync(filepath, buffer);

      // Insert into database
      await pool.query(
        `INSERT INTO research_attachments (document_id, filename, content_type, file_size, file_path, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [doc.id, filename, 'application/pdf', buffer.length, filepath]
      );

      // Update attachment count
      await pool.query(
        `UPDATE research_documents
         SET attachment_count = (SELECT COUNT(*) FROM research_attachments WHERE document_id = $1)
         WHERE id = $1`,
        [doc.id]
      );

      console.log(`  ✓ Saved to database`);
      downloaded++;

    } catch (error) {
      console.log(`  ❌ Failed: ${error.message}`);
      failed++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  await pool.end();

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total: ${result.rows.length}`);
  console.log(`✓ Downloaded: ${downloaded}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
