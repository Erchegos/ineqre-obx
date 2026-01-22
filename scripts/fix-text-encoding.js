/**
 * Fix text encoding artifacts in existing database records
 *
 * This script cleans up UTF-8 mojibake in the body_text field
 * of research_documents table.
 */

require('dotenv').config();
const { Pool } = require('pg');

// Strip sslmode parameter from connection string
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

/**
 * Clean text to remove encoding artifacts and fix mojibake
 */
function cleanText(text) {
  if (!text) return '';

  return text
    // Fix common UTF-8 mojibake patterns (double-encoded UTF-8)
    .replace(/â€¢/g, '\u2022')  // bullet point
    .replace(/â€"/g, '\u2013')  // en dash
    .replace(/â€"/g, '\u2014')  // em dash
    .replace(/â€˜/g, '\u2018')  // left single quote
    .replace(/â€™/g, '\u2019')  // right single quote/apostrophe
    .replace(/â€œ/g, '\u201C')  // left double quote
    .replace(/â€/g, '\u201D')   // right double quote
    .replace(/â‚¬/g, '\u20AC')  // euro sign
    .replace(/Â£/g, '\u00A3')   // pound sign
    .replace(/Â /g, ' ')   // non-breaking space
    .replace(/Ã¸/g, '\u00F8')  // o with stroke (Norwegian)
    .replace(/Ã¥/g, '\u00E5')  // a with ring (Norwegian)
    .replace(/Ã¦/g, '\u00E6')  // ae ligature (Norwegian)
    .replace(/Ã˜/g, '\u00D8')  // O with stroke
    .replace(/Ã…/g, '\u00C5')  // A with ring
    .replace(/Ã†/g, '\u00C6')  // AE ligature
    .replace(/â€¦/g, '...')  // ellipsis
    .replace(/Â°/g, '\u00B0')   // degree symbol
    .replace(/Â±/g, '\u00B1')   // plus-minus
    // Remove any remaining control characters and weird symbols
    .replace(/[^\x20-\x7E\u00A0-\u00FF\u0100-\u017F\u2018-\u201F\u2022\u2013\u2014]/g, '')
    // Normalize whitespace
    .replace(/\s\s+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n\n\n+/g, '\n\n')
    .trim();
}

async function main() {
  console.log('Fixing text encoding in research documents...\n');

  try {
    // Get all documents with body text containing encoding artifacts
    const result = await pool.query(`
      SELECT id, subject, body_text
      FROM research_documents
      WHERE body_text IS NOT NULL
        AND (
          body_text LIKE '%â€%'
          OR body_text LIKE '%Â%'
          OR body_text LIKE '%Ã%'
        )
      ORDER BY received_date DESC
    `);

    console.log(`Found ${result.rows.length} documents with encoding issues\n`);

    if (result.rows.length === 0) {
      console.log('No documents need cleaning!');
      await pool.end();
      return;
    }

    let fixedCount = 0;
    let unchangedCount = 0;

    for (const doc of result.rows) {
      const cleanedText = cleanText(doc.body_text);

      if (cleanedText !== doc.body_text) {
        await pool.query(
          'UPDATE research_documents SET body_text = $1 WHERE id = $2',
          [cleanedText, doc.id]
        );
        console.log(`✓ Fixed: ${doc.subject.substring(0, 60)}...`);
        fixedCount++;
      } else {
        unchangedCount++;
      }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`Fixed: ${fixedCount} documents`);
    console.log(`Unchanged: ${unchangedCount} documents`);
    console.log(`${'='.repeat(50)}\n`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
