/**
 * Add body text to existing research documents
 *
 * This script connects to the email inbox and adds body text to documents
 * that were imported without body content.
 */

require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { Pool } = require('pg');

// Strip sslmode parameter from connection string to avoid conflicts
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

// Email configuration
const CONFIG = {
  email: {
    host: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.EMAIL_IMAP_PORT || '993'),
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  },
};

/**
 * Extract plain text from HTML
 */
function htmlToText(html) {
  // Simple HTML to text conversion
  return html
    .replace(/<style[^>]*>.*?<\/style>/gi, '')
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Process a single document to add body text
 */
async function addBodyText(doc, imap) {
  try {
    console.log(`Processing: ${doc.subject}`);

    // Search for email by Message-ID
    const searchResult = await imap.search({
      header: ['Message-ID', doc.email_message_id]
    });

    if (searchResult.length === 0) {
      console.log(`  Email not found in inbox`);
      return false;
    }

    const uid = searchResult[0];

    // Fetch the message structure
    const message = await imap.fetchOne(uid, {
      bodyStructure: true
    });

    // Find body part
    const bodyPart = message.bodyStructure.childNodes?.find(
      (node) => node.type === 'text/plain' || node.type === 'text/html'
    ) || message.bodyStructure;

    if (!bodyPart || !bodyPart.part) {
      console.log(`  No body part found`);
      return false;
    }

    // Download body with timeout
    let bodyText = '';
    try {
      const bodyContent = await Promise.race([
        imap.download(uid, bodyPart.part, { maxBytes: 100000 }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Download timeout')), 10000)
        )
      ]);

      let rawText = bodyContent.toString('utf-8');

      // If HTML, convert to plain text
      if (bodyPart.type === 'text/html') {
        rawText = htmlToText(rawText);
      }

      bodyText = rawText.substring(0, 10000); // Limit to 10KB
      console.log(`  Downloaded ${bodyText.length} characters`);
    } catch (err) {
      console.log(`  Download failed: ${err.message}`);
      return false;
    }

    // Update database
    await pool.query(
      'UPDATE research_documents SET body_text = $1 WHERE id = $2',
      [bodyText, doc.id]
    );

    console.log(`  ✓ Updated`);
    return true;

  } catch (error) {
    console.error(`  Error: ${error.message}`);
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  const imap = new ImapFlow(CONFIG.email);

  try {
    console.log('Connecting to email server...');
    await imap.connect();
    console.log('Connected!');

    await imap.mailboxOpen('INBOX');

    // Get documents without body text from 2026
    const result = await pool.query(`
      SELECT id, subject, email_message_id, received_date
      FROM research_documents
      WHERE source = 'Pareto Securities'
        AND received_date >= '2026-01-01'
        AND (body_text IS NULL OR body_text = '')
      ORDER BY received_date
      LIMIT 100
    `);

    console.log(`\nFound ${result.rows.length} documents without body text\n`);

    let updated = 0;
    for (const doc of result.rows) {
      if (await addBodyText(doc, imap)) {
        updated++;
      }
    }

    console.log(`\n✓ Updated ${updated} out of ${result.rows.length} documents`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await imap.logout();
    await pool.end();
  }
}

// Run
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
