/**
 * Batch update body text for all 2026 Pareto emails
 *
 * More efficient approach: fetch all 2026 emails from IMAP at once,
 * then match them to database records by subject and date
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
  return html
    .replace(/<style[^>]*>.*?<\/style>/gi, '')
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find text part recursively in MIME structure
 */
function findTextPart(structure) {
  if (structure.type === 'text/plain' || structure.type === 'text/html') {
    return structure;
  }

  if (structure.childNodes && structure.childNodes.length > 0) {
    for (const child of structure.childNodes) {
      const found = findTextPart(child);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Extract body text from message
 */
async function extractBodyText(message, imap) {
  try {
    const { bodyStructure, uid } = message;

    // Find text part recursively
    const bodyPart = findTextPart(bodyStructure);

    if (!bodyPart || !bodyPart.part) {
      return '';
    }

    // Download body with size limit and timeout
    const download = imap.download(uid, bodyPart.part, { maxBytes: 100000 });

    // download.content is the readable stream
    const chunks = [];
    for await (const chunk of download.content) {
      chunks.push(chunk);
    }
    const bodyContent = Buffer.concat(chunks);

    let text = bodyContent.toString('utf-8');

    // Convert HTML to plain text if needed
    if (bodyPart.type === 'text/html') {
      text = htmlToText(text);
    }

    return text.substring(0, 10000); // Limit to 10KB

  } catch (err) {
    console.error(`    Body extraction failed: ${err.message}`);
    return '';
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
    console.log('Connected!\n');

    await imap.mailboxOpen('INBOX');

    // Fetch all Pareto emails from 2026
    console.log('Fetching all Pareto emails from 2026...');
    const searchCriteria = {
      since: new Date('2026-01-01'),
      before: new Date('2027-01-01'),
      from: 'noreply@research.paretosec.com'
    };

    const messages = [];
    let fetchCount = 0;

    for await (const message of imap.fetch(searchCriteria, {
      envelope: true,
      bodyStructure: true,
      uid: true
    })) {
      fetchCount++;
      if (fetchCount % 50 === 0) {
        console.log(`  Fetched ${fetchCount} emails...`);
      }

      const subject = message.envelope.subject || '(No Subject)';
      const date = message.envelope.date;
      const messageId = message.envelope.messageId;

      messages.push({
        subject,
        date,
        messageId,
        uid: message.uid,
        bodyStructure: message.bodyStructure
      });
    }

    console.log(`✓ Fetched ${messages.length} Pareto emails from IMAP\n`);

    // Get all documents from database
    console.log('Loading documents from database...');
    const dbResult = await pool.query(`
      SELECT id, subject, email_message_id, received_date, body_text
      FROM research_documents
      WHERE source = 'Pareto Securities'
        AND received_date >= '2026-01-01'
        AND (body_text IS NULL OR body_text = '')
      ORDER BY received_date
    `);

    console.log(`✓ Found ${dbResult.rows.length} documents without body text\n`);

    // Match and update
    let updated = 0;
    let notFound = 0;

    for (const doc of dbResult.rows) {
      console.log(`Processing: ${doc.subject.substring(0, 60)}...`);

      // Find matching message by Message-ID
      const message = messages.find(m => m.messageId === doc.email_message_id);

      if (!message) {
        console.log('  ✗ Not found in IMAP fetch');
        notFound++;
        continue;
      }

      // Extract body text
      const bodyText = await extractBodyText(message, imap);

      if (bodyText) {
        // Update database
        await pool.query(
          'UPDATE research_documents SET body_text = $1 WHERE id = $2',
          [bodyText, doc.id]
        );
        console.log(`  ✓ Updated (${bodyText.length} chars)`);
        updated++;
      } else {
        console.log('  ⚠ No body text extracted');
      }
    }

    console.log(`\n========================================`);
    console.log(`✓ Updated: ${updated} documents`);
    console.log(`✗ Not found: ${notFound} documents`);
    console.log(`⚠ No body: ${dbResult.rows.length - updated - notFound} documents`);
    console.log(`========================================\n`);

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
