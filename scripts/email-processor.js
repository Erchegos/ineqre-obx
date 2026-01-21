/**
 * Email Processor for Pareto Securities Research
 *
 * This script monitors your email inbox for Pareto research emails and
 * automatically imports them into the research portal database.
 *
 * Setup:
 * 1. npm install imapflow pg dotenv
 * 2. Create .env file with EMAIL_USER, EMAIL_PASSWORD, DATABASE_URL
 * 3. Run: node scripts/email-processor.js
 * 4. Or schedule with cron for automatic processing
 */

require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Configuration
const CONFIG = {
  // Email settings
  email: {
    host: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.EMAIL_IMAP_PORT || '993'),
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  },

  // Filter for Pareto emails
  senderFilters: [
    'noreply@research.paretosec.com',
    'research@pareto.no',
    // Add more senders as needed
  ],

  // Local storage directory (relative to project root)
  storageDir: process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage', 'research'),

  // Processing limits
  batchSize: 50, // Process max 50 emails per run
  maxAttachmentSize: 50 * 1024 * 1024, // 50 MB
};

// Ensure storage directory exists
if (!fs.existsSync(CONFIG.storageDir)) {
  fs.mkdirSync(CONFIG.storageDir, { recursive: true });
}

/**
 * Extract ticker from email subject
 * Examples:
 *   "BAKKA: Q4 Results" -> "BAKKA"
 *   "Update on NHY" -> "NHY"
 */
function extractTicker(subject) {
  // Pattern 1: "TICKER: ..."
  let match = subject.match(/^([A-Z]{3,5}):/);
  if (match) return match[1];

  // Pattern 2: "... on TICKER ..."
  match = subject.match(/\bon\s+([A-Z]{3,5})\b/);
  if (match) return match[1];

  // Pattern 3: Any 3-5 uppercase letters in brackets
  match = subject.match(/\(([A-Z]{3,5})\)/);
  if (match) return match[1];

  return null;
}

/**
 * Identify source from sender email
 */
function identifySource(email) {
  if (email.includes('pareto')) return 'Pareto Securities';
  if (email.includes('dnb')) return 'DNB Markets';
  if (email.includes('abg')) return 'ABG Sundal Collier';
  return 'Unknown';
}

/**
 * Save file to local storage
 */
async function saveToLocalStorage(content, relativePath) {
  const fullPath = path.join(CONFIG.storageDir, relativePath);
  const dir = path.dirname(fullPath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write file
  fs.writeFileSync(fullPath, content);
  return relativePath;
}

/**
 * Process a single email message
 */
async function processEmail(message, imap) {
  try {
    const { envelope, bodyStructure, uid } = message;

    // Check if already processed (using Message-ID)
    const messageId = envelope.messageId;
    const existing = await pool.query(
      'SELECT id FROM research_documents WHERE email_message_id = $1',
      [messageId]
    );

    if (existing.rows.length > 0) {
      console.log(`Skipping already processed email: ${messageId}`);
      return;
    }

    // Extract metadata
    const sender = envelope.from[0].address;
    const subject = envelope.subject || '(No Subject)';
    const ticker = extractTicker(subject);
    const source = identifySource(sender);
    const receivedDate = envelope.date;

    console.log(`Processing: ${subject} from ${sender}`);

    // Get email body
    const bodyPart = bodyStructure.childNodes?.find(
      (node) => node.type === 'text/plain' || node.type === 'text/html'
    );

    let bodyText = '';
    if (bodyPart) {
      const bodyContent = await imap.download(uid, bodyPart.part);
      bodyText = bodyContent.toString('utf-8').substring(0, 10000); // Limit to 10KB
    }

    // Insert document record
    const docResult = await pool.query(
      `INSERT INTO research_documents (
        ticker, email_message_id, source, sender_email,
        subject, body_text, received_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id`,
      [ticker, messageId, source, sender, subject, bodyText, receivedDate]
    );

    const documentId = docResult.rows[0].id;

    // Process attachments
    const attachments = findAttachments(bodyStructure);
    let attachmentCount = 0;

    for (const att of attachments) {
      try {
        // Download attachment
        const content = await imap.download(uid, att.part);

        // Skip if too large
        if (content.length > CONFIG.maxAttachmentSize) {
          console.log(`  Skipping large attachment: ${att.filename} (${content.length} bytes)`);
          continue;
        }

        // Generate file path
        const now = new Date();
        const relativePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${documentId}/${att.filename}`;

        // Save to local storage
        await saveToLocalStorage(content, relativePath);

        // Save attachment record
        await pool.query(
          `INSERT INTO research_attachments (
            document_id, filename, content_type, file_size, file_path
          ) VALUES ($1, $2, $3, $4, $5)`,
          [documentId, att.filename, att.contentType, content.length, relativePath]
        );

        attachmentCount++;
        console.log(`  Saved attachment: ${att.filename}`);
      } catch (err) {
        console.error(`  Error processing attachment ${att.filename}:`, err.message);
      }
    }

    // Update document with attachment count
    await pool.query(
      `UPDATE research_documents
       SET attachment_count = $1, has_attachments = $2
       WHERE id = $3`,
      [attachmentCount, attachmentCount > 0, documentId]
    );

    console.log(`✓ Processed document ${documentId} with ${attachmentCount} attachments`);
  } catch (error) {
    console.error('Error processing email:', error);
  }
}

/**
 * Find attachments in email structure
 */
function findAttachments(structure, attachments = []) {
  if (structure.disposition === 'attachment' && structure.parameters?.name) {
    attachments.push({
      filename: structure.parameters.name,
      contentType: structure.type || 'application/octet-stream',
      part: structure.part,
    });
  }

  if (structure.childNodes) {
    structure.childNodes.forEach((child) => findAttachments(child, attachments));
  }

  return attachments;
}

/**
 * Main processing function
 */
async function main() {
  const imap = new ImapFlow(CONFIG.email);

  try {
    console.log('Connecting to email server...');
    await imap.connect();
    console.log('Connected!');

    // Select inbox
    await imap.mailboxOpen('INBOX');

    // Search for unseen emails (we'll filter by sender after)
    const searchCriteria = {
      unseen: true,
    };

    console.log('Searching for new Pareto research emails...');
    const messages = imap.fetch(searchCriteria, {
      envelope: true,
      bodyStructure: true,
      uid: true,
    });

    let count = 0;
    let processed = 0;
    for await (const message of messages) {
      count++;

      // Filter by sender
      const sender = message.envelope.from[0].address;
      const isPareto = CONFIG.senderFilters.some(filter =>
        sender.toLowerCase().includes(filter.toLowerCase())
      );

      if (!isPareto) {
        continue; // Skip non-Pareto emails
      }

      await processEmail(message, imap);
      processed++;

      if (processed >= CONFIG.batchSize) {
        console.log(`Reached batch limit of ${CONFIG.batchSize}`);
        break;
      }
    }

    if (processed === 0) {
      console.log(`No new Pareto emails found (checked ${count} unread messages)`);
    } else {
      console.log(`\n✓ Processed ${processed} Pareto emails (out of ${count} unread messages)`);
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await imap.logout();
    await pool.end();
  }
}

// Run the processor
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
