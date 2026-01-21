/**
 * Fix text encoding in all existing documents
 */

require('dotenv').config();
const { Pool } = require('pg');

// Database setup
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

function fixEncoding(text) {
  if (!text) return text;

  let fixed = text
    // Fix smart quotes and apostrophes (mojibake patterns)
    .replace(/â€™/g, "'")
    .replace(/â€˜/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€/g, '"')
    .replace(/â€"/g, '–')
    .replace(/â€"/g, '—')
    .replace(/â€¦/g, '...')

    // Fix common day possessives
    .replace(/Mondayâs/g, "Monday's")
    .replace(/Tuesdayâs/g, "Tuesday's")
    .replace(/Wednesdayâs/g, "Wednesday's")
    .replace(/Thursdayâs/g, "Thursday's")
    .replace(/Fridayâs/g, "Friday's")
    .replace(/Saturdayâs/g, "Saturday's")
    .replace(/Sundayâs/g, "Sunday's")

    // Fix possessives and contractions with â
    .replace(/(\w)âs\b/g, "$1's")
    .replace(/(\w)ât\b/g, "$1't")
    .replace(/(\w)âre\b/g, "$1're")
    .replace(/(\w)âve\b/g, "$1've")
    .replace(/(\w)âll\b/g, "$1'll")
    .replace(/(\w)âd\b/g, "$1'd")

    // Fix quotes around phrases (â...â becomes "...")
    .replace(/â([A-Z][^â]*?)â/g, '"$1"')
    .replace(/â([a-z][^â]*?)â/g, '"$1"')

    // Fix dashes between words
    .replace(/\sâ\s/g, ' – ')

    // Fix Norwegian characters
    .replace(/Ã¥/g, 'å')
    .replace(/Ã¸/g, 'ø')
    .replace(/Ã¦/g, 'æ')
    .replace(/Ã…/g, 'Å')
    .replace(/Ã˜/g, 'Ø')
    .replace(/Ã†/g, 'Æ')

    // Remove non-breaking space artifacts
    .replace(/Â /g, ' ')
    .replace(/Â/g, '')

    // Clean up any remaining stray â characters
    .replace(/â/g, '');

  // Fix specific known issues from my earlier cleanup
  fixed = fixed
    .replace(/Mondays tariff/g, "Monday's tariff")
    .replace(/Taco Wednesday/g, '"Taco Wednesday"')
    .replace(/ones hardest/g, "one's hardest");

  // Remove empty quotes ""
  fixed = fixed.replace(/""/g, '');

  // Clean up multiple spaces to single space
  fixed = fixed.replace(/  +/g, ' ');

  return fixed;
}

async function fixAllDocuments() {
  console.log('Fixing text encoding in all documents...\n');

  try {
    // Get all documents
    const result = await pool.query(
      'SELECT id, subject, body_text FROM research_documents ORDER BY received_date DESC'
    );

    console.log(`Found ${result.rows.length} documents\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const doc of result.rows) {
      const fixedSubject = fixEncoding(doc.subject);
      const fixedBody = fixEncoding(doc.body_text);

      // Only update if something changed
      if (fixedSubject !== doc.subject || fixedBody !== doc.body_text) {
        await pool.query(
          'UPDATE research_documents SET subject = $1, body_text = $2 WHERE id = $3',
          [fixedSubject, fixedBody, doc.id]
        );
        updatedCount++;

        if (updatedCount % 10 === 0) {
          console.log(`Updated ${updatedCount} documents...`);
        }
      } else {
        skippedCount++;
      }
    }

    console.log(`\n✓ Updated: ${updatedCount} documents`);
    console.log(`- Skipped: ${skippedCount} documents (no changes needed)`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

fixAllDocuments();
