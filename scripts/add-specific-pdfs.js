/**
 * Manually add specific PDFs to specific articles
 */

require('dotenv').config();
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
 * Add PDF to document
 */
async function addPdfToDocument(documentId, pdfPath, articleSubject) {
  const filename = path.basename(pdfPath);
  const fileBuffer = fs.readFileSync(pdfPath);

  console.log(`\nAdding ${filename} to article: ${articleSubject}`);
  console.log(`  File size: ${Math.round(fileBuffer.length / 1024)}KB`);

  // Create relative path for storage
  const now = new Date();
  const relativePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${documentId}/${filename}`;

  try {
    // Save to local storage
    await saveToLocalStorage(fileBuffer, relativePath);

    // Insert into database
    await pool.query(
      `INSERT INTO research_attachments (
        document_id, filename, content_type, file_size, file_path
      ) VALUES ($1, $2, $3, $4, $5)`,
      [documentId, filename, 'application/pdf', fileBuffer.length, relativePath]
    );

    // Update document attachment count
    await pool.query(
      `UPDATE research_documents
       SET attachment_count = attachment_count + 1, has_attachments = true
       WHERE id = $1`,
      [documentId]
    );

    console.log(`  ✓ Successfully added to database`);
    console.log(`  ✓ Stored at: ${relativePath}`);

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
  console.log('Adding PDFs to the last two articles...\n');

  // Define the mappings
  const mappings = [
    {
      documentId: 'cd711ec8-cd00-47ea-8bf9-999f58c0c7dc',
      pdfPath: '/Users/olaslettebak/Documents/Intelligence_Equity_Research/code/Manual_PDF_Analysis/Individual_Stocks_Pareto/467915.pdf',
      subject: 'Trelleborg - Execution over noise - Quarterly Review'
    },
    {
      documentId: '1bedf3c4-f52b-4f9f-b65c-41c3f17c0591',
      pdfPath: '/Users/olaslettebak/Documents/Intelligence_Equity_Research/code/Manual_PDF_Analysis/Individual_Stocks_Pareto/467917.pdf',
      subject: 'Indutrade AB - Margins provide modest comfort - Quarterly Review'
    }
  ];

  let successCount = 0;

  for (const mapping of mappings) {
    if (!fs.existsSync(mapping.pdfPath)) {
      console.log(`\n✗ PDF not found: ${mapping.pdfPath}`);
      continue;
    }

    const success = await addPdfToDocument(
      mapping.documentId,
      mapping.pdfPath,
      mapping.subject
    );

    if (success) successCount++;
  }

  console.log(`\n\n=== Results ===`);
  console.log(`✓ Successfully added: ${successCount} PDFs`);
  console.log(`✗ Failed: ${mappings.length - successCount} PDFs`);

  await pool.end();
}

main().catch(console.error);
