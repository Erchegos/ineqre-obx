/**
 * Re-process existing emails to download PDFs to Supabase Storage
 *
 * This script finds documents that don't have PDF attachments yet
 * and attempts to download them from the report URL in the body text.
 */

require('dotenv').config();
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

// Strip sslmode parameter from connection string
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Extract PDF URL from body text
 */
function extractPdfUrl(bodyText) {
  if (!bodyText) return null;

  // Look for "Full Report:" followed by URL
  const fullReportMatch = bodyText.match(/Full Report:\s*(https?:\/\/[^\s]+)/i);
  if (fullReportMatch) {
    return fullReportMatch[1];
  }

  // Fallback to FactSet hosting links
  const factsetMatch = bodyText.match(/https:\/\/parp\.hosting\.factset\.com[^\s]+/);
  if (factsetMatch) {
    return factsetMatch[0];
  }

  return null;
}

/**
 * Download PDF from URL
 */
async function downloadPdf(url) {
  const https = require('https');
  const http = require('http');

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    };

    const req = (urlObj.protocol === 'https:' ? https : http).request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.end();
  });
}

/**
 * Upload PDF to Supabase Storage
 */
async function uploadToSupabase(buffer, relativePath) {
  const { data, error } = await supabase.storage
    .from('research-documents')
    .upload(relativePath, buffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (error) throw error;
  return relativePath;
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('Finding documents without PDF attachments...\n');

    // Find documents without PDF attachments
    const result = await pool.query(`
      SELECT id, subject, body_text, ticker, received_date
      FROM research_documents
      WHERE attachment_count = 0 OR attachment_count IS NULL
      ORDER BY received_date DESC
      LIMIT 50
    `);

    console.log(`Found ${result.rows.length} documents without PDFs\n`);

    let successCount = 0;
    let failCount = 0;

    for (const doc of result.rows) {
      try {
        console.log(`Processing: ${doc.subject.substring(0, 60)}...`);

        // Extract PDF URL
        const pdfUrl = extractPdfUrl(doc.body_text);
        if (!pdfUrl) {
          console.log(`  ⚠ No PDF URL found`);
          failCount++;
          continue;
        }

        console.log(`  Downloading from: ${pdfUrl.substring(0, 60)}...`);

        // Download PDF
        const pdfBuffer = await downloadPdf(pdfUrl);
        console.log(`  Downloaded ${Math.round(pdfBuffer.length / 1024)}KB`);

        // Generate filename and path
        const cleanSubject = doc.subject.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        const filename = `${doc.ticker || 'report'}_${cleanSubject}.pdf`;

        const receivedDate = new Date(doc.received_date);
        const relativePath = `${receivedDate.getFullYear()}/${String(receivedDate.getMonth() + 1).padStart(2, '0')}/${doc.id}/${filename}`;

        // Upload to Supabase
        await uploadToSupabase(pdfBuffer, relativePath);
        console.log(`  ✓ Uploaded to Supabase: ${relativePath}`);

        // Save attachment record
        await pool.query(
          `INSERT INTO research_attachments (
            document_id, filename, content_type, file_size, file_path
          ) VALUES ($1, $2, $3, $4, $5)`,
          [doc.id, filename, 'application/pdf', pdfBuffer.length, relativePath]
        );

        // Update document
        await pool.query(
          `UPDATE research_documents
           SET attachment_count = 1, has_attachments = true
           WHERE id = $1`,
          [doc.id]
        );

        console.log(`  ✓ Saved to database\n`);
        successCount++;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err) {
        console.log(`  ✗ Error: ${err.message}\n`);
        failCount++;
      }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`Completed!`);
    console.log(`  Success: ${successCount}`);
    console.log(`  Failed: ${failCount}`);
    console.log(`${'='.repeat(50)}\n`);

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run
main().catch(console.error);
