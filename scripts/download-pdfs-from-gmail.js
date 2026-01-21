/**
 * Download PDFs from Gmail with Authentication
 *
 * This script uses Puppeteer to authenticate with Gmail and download PDFs
 * from Pareto research emails using the authenticated session.
 */

require('dotenv').config();
const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Strip sslmode parameter from connection string
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

const CONFIG = {
  storageDir: process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage', 'research'),
  gmailEmail: process.env.EMAIL_USER,
  gmailPassword: process.env.EMAIL_PASSWORD,
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
 * Download PDF using authenticated browser session
 */
async function downloadPDFWithAuth(browser, pdfUrl, documentId, subject, ticker) {
  const page = await browser.newPage();

  try {
    // Set download behavior
    const downloadPath = path.join(__dirname, '..', 'temp_downloads');
    if (!fs.existsSync(downloadPath)) {
      fs.mkdirSync(downloadPath, { recursive: true });
    }

    await page._client().send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadPath
    });

    console.log(`  Navigating to: ${pdfUrl.substring(0, 60)}...`);

    // Navigate to PDF URL (will use Gmail's authenticated session)
    await page.goto(pdfUrl, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    // Wait for download to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Find the downloaded PDF file
    const files = fs.readdirSync(downloadPath);
    const pdfFile = files.find(f => f.endsWith('.pdf'));

    if (!pdfFile) {
      throw new Error('PDF file not found after download');
    }

    const downloadedPath = path.join(downloadPath, pdfFile);
    const pdfBuffer = fs.readFileSync(downloadedPath);

    // Clean up temp file
    fs.unlinkSync(downloadedPath);

    // Generate proper filename
    const cleanSubject = subject.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
    const filename = `${ticker || 'report'}_${cleanSubject}.pdf`;

    // Generate file path
    const now = new Date();
    const relativePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${documentId}/${filename}`;

    // Save to storage
    await saveToLocalStorage(pdfBuffer, relativePath);

    // Save to database
    await pool.query(
      `INSERT INTO research_attachments (
        document_id, filename, content_type, file_size, file_path
      ) VALUES ($1, $2, $3, $4, $5)`,
      [documentId, filename, 'application/pdf', pdfBuffer.length, relativePath]
    );

    // Update document attachment count
    await pool.query(
      `UPDATE research_documents
       SET attachment_count = attachment_count + 1,
           has_attachments = true
       WHERE id = $1`,
      [documentId]
    );

    console.log(`  ✓ Downloaded: ${filename} (${Math.round(pdfBuffer.length / 1024)}KB)`);
    return true;

  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    return false;
  } finally {
    await page.close();
  }
}

/**
 * Main function
 */
async function main() {
  console.log('Starting PDF download with Gmail authentication...\n');

  // Get documents without PDF attachments that have report links
  const result = await pool.query(`
    SELECT d.id, d.subject, d.ticker, d.body_text, d.received_date
    FROM research_documents d
    LEFT JOIN research_attachments a ON d.id = a.document_id AND a.content_type = 'application/pdf'
    WHERE a.id IS NULL
      AND d.body_text LIKE '%Full Report:%'
      AND d.source = 'Pareto Securities'
    ORDER BY d.received_date DESC
    LIMIT 50
  `);

  console.log(`Found ${result.rows.length} documents without PDFs\n`);

  if (result.rows.length === 0) {
    console.log('All documents already have PDFs!');
    return;
  }

  // Launch browser
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false, // Set to true for background operation
    defaultViewport: null,
  });

  try {
    // Login to Gmail first
    console.log('Opening Gmail...');
    const loginPage = await browser.newPage();

    await loginPage.goto('https://accounts.google.com/');
    console.log('\n⚠️  PLEASE LOG IN TO GMAIL IN THE BROWSER WINDOW');
    console.log('Once logged in, press Enter here to continue...\n');

    // Wait for user to login
    await new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });

    await loginPage.close();
    console.log('Proceeding with PDF downloads...\n');

    // Download PDFs
    let successCount = 0;
    let failCount = 0;

    for (const doc of result.rows) {
      // Extract PDF URL from body text
      const linkMatch = doc.body_text.match(/Full Report:\s*(https?:\/\/[^\s]+)/);
      if (!linkMatch) {
        console.log(`Skipping ${doc.subject}: No report link found`);
        continue;
      }

      const pdfUrl = linkMatch[1];
      console.log(`\nProcessing: ${doc.subject}`);

      const success = await downloadPDFWithAuth(
        browser,
        pdfUrl,
        doc.id,
        doc.subject,
        doc.ticker
      );

      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      // Small delay between downloads
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`\n✓ Complete! Downloaded ${successCount} PDFs, ${failCount} failed`);

  } finally {
    await browser.close();
    await pool.end();
  }
}

// Run
main().catch(console.error);
