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
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Strip sslmode parameter from connection string to avoid conflicts
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

// Initialize Supabase client for storage
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
  batchSize: 500, // Process max 500 emails per run
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
 * Save file to Supabase Storage
 */
async function saveToSupabaseStorage(content, relativePath) {
  try {
    const { data, error } = await supabase.storage
      .from('research-documents')
      .upload(relativePath, content, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (error) {
      throw error;
    }

    return relativePath;
  } catch (error) {
    console.error(`Failed to upload to Supabase Storage: ${error.message}`);

    // Fallback to local storage
    const fullPath = path.join(CONFIG.storageDir, relativePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content);
    console.log(`  Saved to local storage as fallback: ${relativePath}`);
    return relativePath;
  }
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

    // Extract body text from raw email source (much more reliable!)
    let bodyText = '';
    let reportUrl = '';
    try {
      if (message.source) {
        const rawEmail = message.source.toString('utf-8');

        // Extract report link - try multiple patterns

        // Method 1: FactSet hosting link (quoted-printable encoded)
        const factsetMatch = rawEmail.match(/href=3D["']([^"']*parp\.hosting\.factset\.com[^"']*)["']/i);
        if (factsetMatch) {
          // Decode the quoted-printable URL
          reportUrl = factsetMatch[1]
            .replace(/=\r?\n/g, '')  // Remove soft line breaks
            .replace(/=3D/gi, '=')
            .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
        }

        // Method 2: Direct research.paretosec.com link
        if (!reportUrl) {
          const directMatch = rawEmail.match(/href=["']([^"']*research\.paretosec\.com[^"']*)["']/i);
          if (directMatch) reportUrl = directMatch[1];
        }

        // Find actual HTML content - look for <!DOCTYPE or <html or <table (Pareto emails)
        let htmlContent = rawEmail;
        const htmlStart = rawEmail.search(/(?:<!DOCTYPE|<html|<table[^>]*cellspacing)/i);
        if (htmlStart > 0) {
          htmlContent = rawEmail.substring(htmlStart);
        }

        // Try to extract body tags if they exist
        const bodyMatch = htmlContent.match(/<body[^>]*>(.*?)<\/body>/is);
        if (bodyMatch) {
          htmlContent = bodyMatch[1];
        }

        // Decode quoted-printable encoding (=20 -> space, =3D -> =, etc.)
        htmlContent = htmlContent
          .replace(/=\r?\n/g, '')  // Remove soft line breaks
          .replace(/=3D/gi, '=')
          .replace(/=20/g, ' ')
          .replace(/=09/g, '\t')
          .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));

        // Extract text from HTML
        let text = htmlContent
          .replace(/<style[^>]*>.*?<\/style>/gis, '')
          .replace(/<script[^>]*>.*?<\/script>/gis, '')
          .replace(/<head[^>]*>.*?<\/head>/gis, '')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n\n')
          .replace(/<\/div>/gi, '\n')
          .replace(/<\/tr>/gi, '\n')
          .replace(/<\/td>/gi, ' ')
          .replace(/<[^>]+>/g, '')
          .replace(/&#xa0;/gi, ' ')
          .replace(/&#160;/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#8217;/g, "'")
          .replace(/&#8216;/g, "'")
          .replace(/&#8220;/g, '"')
          .replace(/&#8221;/g, '"')
          .replace(/&#8211;/g, '–')
          .replace(/&#8212;/g, '—')
          .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(parseInt(dec, 10)))
          .replace(/&#x([0-9A-F]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/\s\s+/g, ' ')
          .replace(/\n\s+/g, '\n')
          .replace(/\n\n\n+/g, '\n\n')
          .trim();

        // Truncate text first to leave room for link
        text = text.substring(0, 1850);

        // Append report URL (max ~150 chars for link)
        if (reportUrl) {
          text += `\n\nFull Report: ${reportUrl}`;
          console.log(`  Report: ${reportUrl.substring(0, 50)}...`);
        }

        bodyText = text;

        if (bodyText.length > 100) {
          console.log(`  Body: ${bodyText.length} chars`);
        }
      }
    } catch (err) {
      console.log(`  Body extraction failed: ${err.message}`);
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

        // Save to Supabase Storage
        await saveToSupabaseStorage(content, relativePath);

        // Save attachment record
        await pool.query(
          `INSERT INTO research_attachments (
            document_id, filename, content_type, file_size, file_path
          ) VALUES ($1, $2, $3, $4, $5)`,
          [documentId, att.filename, att.contentType, content.length, relativePath]
        );

        attachmentCount++;
        console.log(`  ✓ Saved attachment to Supabase: ${att.filename}`);
      } catch (err) {
        console.error(`  Error processing attachment ${att.filename}:`, err.message);
      }
    }

    // Download PDF from report URL if available
    if (reportUrl) {
      try {
        console.log(`  Downloading PDF from: ${reportUrl.substring(0, 60)}...`);

        const https = require('https');
        const http = require('http');

        // Use node-fetch or native fetch to download the PDF
        const response = await (async () => {
          try {
            // Try using node-fetch if available
            const nodeFetch = require('node-fetch');
            return await nodeFetch(reportUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              },
              timeout: 30000,
            });
          } catch (e) {
            // Fallback: manual HTTPS request
            return new Promise((resolve, reject) => {
              const url = new URL(reportUrl);
              const options = {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: 'GET',
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                },
              };

              const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                  resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    statusCode: res.statusCode,
                    buffer: () => Promise.resolve(Buffer.concat(chunks)),
                  });
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
        })();

        if (response.ok || response.statusCode === 200) {
          const pdfBuffer = await response.buffer();

          // Generate filename
          const cleanSubject = subject.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
          const filename = `${ticker || 'report'}_${cleanSubject}.pdf`;

          // Generate file path
          const now = new Date();
          const relativePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${documentId}/${filename}`;

          // Save to Supabase Storage
          await saveToSupabaseStorage(pdfBuffer, relativePath);

          // Save as attachment record
          await pool.query(
            `INSERT INTO research_attachments (
              document_id, filename, content_type, file_size, file_path
            ) VALUES ($1, $2, $3, $4, $5)`,
            [documentId, filename, 'application/pdf', pdfBuffer.length, relativePath]
          );

          attachmentCount++;
          console.log(`  ✓ Downloaded and saved PDF to Supabase: ${filename} (${Math.round(pdfBuffer.length / 1024)}KB)`);
        } else {
          console.log(`  ⚠ PDF download failed: HTTP ${response.statusCode || response.status}`);
        }
      } catch (pdfError) {
        console.log(`  ⚠ PDF download error: ${pdfError.message}`);
        // Continue processing - PDF download is optional
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

    // Search for Pareto emails from 2026
    const searchCriteria = {
      since: new Date('2026-01-01'),
      before: new Date('2027-01-01'),
      from: 'noreply@research.paretosec.com'
    };

    console.log('Searching for Pareto research emails from 2026...');
    const messages = imap.fetch(searchCriteria, {
      envelope: true,
      bodyStructure: true,
      source: true,  // Fetch raw email source for reliable body extraction
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
      console.log(`No Pareto emails found from 2026 (checked ${count} messages)`);
    } else {
      console.log(`\n✓ Processed ${processed} Pareto emails from 2026 (out of ${count} total messages)`);
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
