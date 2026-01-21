/**
 * Import Manually Downloaded PDFs
 *
 * This script imports PDFs that you've manually downloaded from Gmail
 * and matches them to documents in the database.
 *
 * Usage:
 *   node scripts/import-downloaded-pdfs.js /path/to/pdf/folder
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
 * Extract clean text from filename for matching
 */
function cleanForMatching(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate similarity score between two strings
 */
function similarity(s1, s2) {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1.0;

  const editDistance = (s1, s2) => {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();

    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
  };

  return (longer.length - editDistance(longer, shorter)) / longer.length;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node import-downloaded-pdfs.js /path/to/pdf/folder');
    console.log('\nExample:');
    console.log('  node scripts/import-downloaded-pdfs.js ~/Downloads/ParetoPDFs');
    process.exit(1);
  }

  const pdfFolder = args[0];

  if (!fs.existsSync(pdfFolder)) {
    console.error(`Error: Folder not found: ${pdfFolder}`);
    process.exit(1);
  }

  console.log(`Scanning for PDFs in: ${pdfFolder}\n`);

  // Find all PDF files
  const files = fs.readdirSync(pdfFolder)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .sort();

  console.log(`Found ${files.length} PDF files\n`);

  if (files.length === 0) {
    console.log('No PDF files found in the folder!');
    await pool.end();
    return;
  }

  // Get documents without PDFs
  const result = await pool.query(`
    SELECT d.id, d.subject, d.ticker, d.received_date
    FROM research_documents d
    LEFT JOIN research_attachments a ON d.id = a.document_id AND a.content_type = 'application/pdf'
    WHERE a.id IS NULL
      AND d.source = 'Pareto Securities'
    ORDER BY d.received_date DESC
  `);

  console.log(`Found ${result.rows.length} documents without PDFs in database\n`);

  let importCount = 0;
  let skipCount = 0;

  for (const filename of files) {
    const filePath = path.join(pdfFolder, filename);
    const fileBuffer = fs.readFileSync(filePath);

    // Clean filename for matching
    const cleanFilename = cleanForMatching(filename.replace('.pdf', ''));

    // Find best matching document
    let bestMatch = null;
    let bestScore = 0;

    for (const doc of result.rows) {
      const cleanSubject = cleanForMatching(doc.subject);
      const score = similarity(cleanFilename, cleanSubject);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = doc;
      }
    }

    console.log(`\n${filename}`);

    if (!bestMatch || bestScore < 0.3) {
      console.log(`  ✗ No good match found (best: ${Math.round(bestScore * 100)}%)`);
      skipCount++;
      continue;
    }

    console.log(`  → Matched to: ${bestMatch.subject}`);
    console.log(`  → Confidence: ${Math.round(bestScore * 100)}%`);

    if (bestScore < 0.6) {
      console.log(`  ⚠ Low confidence - skipping (adjust threshold if needed)`);
      skipCount++;
      continue;
    }

    // Import the PDF
    try {
      const cleanSubject = bestMatch.subject.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
      const newFilename = `${bestMatch.ticker || 'report'}_${cleanSubject}.pdf`;

      const now = new Date();
      const relativePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${bestMatch.id}/${newFilename}`;

      await saveToLocalStorage(fileBuffer, relativePath);

      await pool.query(
        `INSERT INTO research_attachments (
          document_id, filename, content_type, file_size, file_path
        ) VALUES ($1, $2, $3, $4, $5)`,
        [bestMatch.id, newFilename, 'application/pdf', fileBuffer.length, relativePath]
      );

      await pool.query(
        `UPDATE research_documents
         SET attachment_count = attachment_count + 1, has_attachments = true
         WHERE id = $1`,
        [bestMatch.id]
      );

      console.log(`  ✓ Imported: ${Math.round(fileBuffer.length / 1024)}KB`);
      importCount++;

      // Remove from candidates
      const index = result.rows.indexOf(bestMatch);
      if (index > -1) result.rows.splice(index, 1);

    } catch (error) {
      console.log(`  ✗ Error: ${error.message}`);
      skipCount++;
    }
  }

  console.log(`\n\n=== Results ===`);
  console.log(`✓ Imported: ${importCount} PDFs`);
  console.log(`✗ Skipped: ${skipCount} PDFs`);

  await pool.end();
}

main().catch(console.error);
