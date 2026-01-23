#!/usr/bin/env node
/**
 * Re-fetch specific emails from IMAP to extract PDF URLs
 * For the 6 documents that have NULL raw_email_path
 */

require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=\w+/g, '') + '?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

// Email configuration
const CONFIG = {
  host: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
  port: parseInt(process.env.EMAIL_IMAP_PORT || '993'),
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
  logger: false,
};

// Extract PDF URL from HTML email
function extractPdfUrlFromHtml(html) {
  if (!html) return null;

  // Decode quoted-printable encoding
  const decoded = html
    .replace(/=\r?\n/g, '')  // Remove soft line breaks
    .replace(/=3D/gi, '=')
    .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));

  // Try multiple patterns for PDF links
  const patterns = [
    // FactSet hosting (common in Pareto emails)
    /href=["']([^"']*parp\.hosting\.factset\.com[^"']*)["']/i,
    // Generic PDF links
    /href=["']([^"']*\.pdf[^"']*)["']/i,
    // Pareto research links
    /href=["']([^"']*paretosec\.com\/research[^"']*)["']/i,
    // Full report links
    /href=["']([^"']*)[^"']*["']>[^<]*(Full Report|FULL REPORT|Click to open report)/i,
  ];

  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match) {
      let url = match[1];

      // Clean up URL
      url = url.replace(/=\r?\n/g, '');  // Remove line breaks
      url = url.replace(/=3D/gi, '=');
      url = url.replace(/=([0-9A-F]{2})/gi, (match, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );

      // Validate URL
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }
    }
  }

  return null;
}

async function main() {
  console.log('Fetching missing PDF URLs from IMAP...\n');

  console.log('Connecting to database...');
  // Get documents missing PDFs
  const docsResult = await pool.query(`
    SELECT id, email_message_id, subject, sender_email, received_date
    FROM research_documents
    WHERE attachment_count = 0
      AND (body_text LIKE '%CLICK HERE%' OR body_text LIKE '%Click to open%')
      AND raw_email_path IS NULL
    ORDER BY received_date DESC
  `);

  console.log(`Found ${docsResult.rows.length} documents missing PDFs\n`);

  if (docsResult.rows.length === 0) {
    console.log('No documents to process');
    await pool.end();
    return;
  }

  // Connect to IMAP
  console.log(`Connecting to IMAP server ${CONFIG.host}:${CONFIG.port}...`);
  const client = new ImapFlow(CONFIG);

  try {
    await client.connect();
    console.log('✓ Connected to IMAP server\n');
  } catch (error) {
    console.error(`❌ Failed to connect to IMAP: ${error.message}`);
    await pool.end();
    process.exit(1);
  }

  // Open inbox
  await client.mailboxOpen('INBOX');

  let found = 0;
  let notFound = 0;

  for (const doc of docsResult.rows) {
    console.log(`\nProcessing: ${doc.subject}`);
    console.log(`  Message-ID: ${doc.email_message_id}`);
    console.log(`  Date: ${doc.received_date.toISOString().slice(0, 10)}`);

    try {
      // Search for email by subject and date (more reliable than Message-ID)
      const receivedDate = new Date(doc.received_date);
      const searchResults = await client.search({
        subject: doc.subject,
        since: new Date(receivedDate.getTime() - 24*60*60*1000), // 1 day before
        before: new Date(receivedDate.getTime() + 24*60*60*1000), // 1 day after
      }, { uid: true });

      if (!searchResults || searchResults.length === 0) {
        console.log('  ⚠️  Email not found in inbox');
        notFound++;
        continue;
      }

      console.log(`  ✓ Found ${searchResults.length} matching email(s) (UID: ${searchResults[0]})`);

      // Fetch email
      const message = await client.fetchOne(searchResults[0], {
        source: true,
        bodyStructure: true,
      });

      // Get HTML body
      let html = null;
      if (message.bodyStructure) {
        // Find HTML part
        const findHtmlPart = (parts) => {
          for (const part of parts) {
            if (part.type === 'text/html') {
              return part.part;
            }
            if (part.childNodes) {
              const found = findHtmlPart(part.childNodes);
              if (found) return found;
            }
          }
          return null;
        };

        const htmlPartId = findHtmlPart(message.bodyStructure.childNodes || [message.bodyStructure]);

        if (htmlPartId) {
          const htmlContent = await client.download(searchResults[0], htmlPartId);
          const chunks = [];
          for await (const chunk of htmlContent.content) {
            chunks.push(chunk);
          }
          html = Buffer.concat(chunks).toString('utf-8');
        }
      }

      if (!html) {
        console.log('  ⚠️  No HTML content found');
        notFound++;
        continue;
      }

      // Extract PDF URL
      const pdfUrl = extractPdfUrlFromHtml(html);

      if (pdfUrl) {
        console.log(`  ✓ Found PDF URL: ${pdfUrl.substring(0, 80)}...`);

        // Update database with PDF URL appended to body_text
        await pool.query(
          `UPDATE research_documents
           SET body_text = body_text || $1
           WHERE id = $2`,
          [`\n\nFull Report: ${pdfUrl}`, doc.id]
        );

        console.log('  ✓ Updated body_text with PDF URL');
        found++;
      } else {
        console.log('  ❌ No PDF URL found in email HTML');
        notFound++;
      }

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      notFound++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await client.logout();

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total documents: ${docsResult.rows.length}`);
  console.log(`✓ PDFs found: ${found}`);
  console.log(`❌ Not found: ${notFound}`);
  console.log('');

  if (found > 0) {
    console.log('Next step: Run download-missing-pdfs.ts to download the PDFs');
  }

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
