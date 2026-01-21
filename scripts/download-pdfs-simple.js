/**
 * Simple PDF Download Script
 *
 * Downloads PDFs by directly fetching the URLs.
 * Uses a simple fetch with proper headers to mimic browser requests.
 */

require('dotenv').config();
const https = require('https');
const http = require('http');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

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

// Ensure storage directory exists
if (!fs.existsSync(CONFIG.storageDir)) {
  fs.mkdirSync(CONFIG.storageDir, { recursive: true });
}

/**
 * Save file to local storage
 */
async function saveToLocalStorage(content, relativePath) {
  const fullPath = path.join(CONFIG.storageDir, relativePath);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(fullPath, content);
  return relativePath;
}

/**
 * Download PDF with proper headers
 */
async function downloadPDF(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/pdf,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Referer': 'https://mail.google.com/',
      }
    };

    const req = client.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        return downloadPDF(res.headers.location)
          .then(resolve)
          .catch(reject);
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          buffer: buffer,
          contentType: res.headers['content-type']
        });
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

/**
 * Main function
 */
async function main() {
  console.log('Starting PDF download...\n');

  // Get documents without PDF attachments
  const result = await pool.query(`
    SELECT d.id, d.subject, d.ticker, d.body_text, d.received_date
    FROM research_documents d
    LEFT JOIN research_attachments a ON d.id = a.document_id AND a.content_type = 'application/pdf'
    WHERE a.id IS NULL
      AND d.body_text LIKE '%Full Report:%'
      AND d.source = 'Pareto Securities'
    ORDER BY d.received_date DESC
    LIMIT 10
  `);

  console.log(`Found ${result.rows.length} documents to process\n`);

  if (result.rows.length === 0) {
    console.log('All documents already have PDFs!');
    await pool.end();
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (const doc of result.rows) {
    // Extract PDF URL
    const linkMatch = doc.body_text.match(/Full Report:\s*(https?:\/\/[^\s]+)/);
    if (!linkMatch) {
      console.log(`Skipping: ${doc.subject} (no link found)`);
      continue;
    }

    const pdfUrl = linkMatch[1];
    console.log(`\nProcessing: ${doc.subject}`);
    console.log(`  URL: ${pdfUrl.substring(0, 70)}...`);

    try {
      const response = await downloadPDF(pdfUrl);

      if (response.statusCode === 200 && response.buffer.length > 1000) {
        // Looks like a valid PDF
        const cleanSubject = doc.subject.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        const filename = `${doc.ticker || 'report'}_${cleanSubject}.pdf`;

        const now = new Date();
        const relativePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${doc.id}/${filename}`;

        await saveToLocalStorage(response.buffer, relativePath);

        await pool.query(
          `INSERT INTO research_attachments (
            document_id, filename, content_type, file_size, file_path
          ) VALUES ($1, $2, $3, $4, $5)`,
          [doc.id, filename, 'application/pdf', response.buffer.length, relativePath]
        );

        await pool.query(
          `UPDATE research_documents
           SET attachment_count = attachment_count + 1, has_attachments = true
           WHERE id = $1`,
          [doc.id]
        );

        console.log(`  ✓ Success: ${Math.round(response.buffer.length / 1024)}KB`);
        successCount++;
      } else {
        console.log(`  ✗ Failed: HTTP ${response.statusCode} (${response.buffer.length} bytes)`);
        failCount++;
      }
    } catch (error) {
      console.log(`  ✗ Error: ${error.message}`);
      failCount++;
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n\nResults:`);
  console.log(`  ✓ Downloaded: ${successCount}`);
  console.log(`  ✗ Failed: ${failCount}`);

  await pool.end();
}

main().catch(console.error);
