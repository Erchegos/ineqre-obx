#!/usr/bin/env node
/**
 * Fetch PDF URLs from IMAP emails for documents missing PDFs
 */

require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=\w+/g, '') + '?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

const client = new ImapFlow({
  host: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
  port: parseInt(process.env.EMAIL_IMAP_PORT || '993'),
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
  logger: false,
});

// Extract PDF URL from HTML email (same logic as email-processor.js)
function extractPdfUrl(rawEmail) {
  if (!rawEmail) return null;

  // Decode quoted-printable encoding
  const decoded = rawEmail
    .replace(/=\r?\n/g, '')  // Remove soft line breaks
    .replace(/=3D/gi, '=')
    .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));

  // Try FactSet PDF hosting (most common for Pareto)
  const factsetMatch = decoded.match(/href=3D["']([^"']*parp\.hosting\.factset\.com[^"']*)["']/i) ||
                        decoded.match(/href=["']([^"']*parp\.hosting\.factset\.com[^"']*)["']/i);

  if (factsetMatch) {
    let url = factsetMatch[1]
      .replace(/=\r?\n/g, '')
      .replace(/=3D/gi, '=')
      .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
    return url;
  }

  // Try Pareto research links
  const paretoMatch = decoded.match(/href=["']([^"']*paretosec\.com\/research[^"']*)["']/i);
  if (paretoMatch) {
    return paretoMatch[1];
  }

  // Try any PDF link
  const pdfMatch = decoded.match(/href=["']([^"']*\.pdf[^"']*)["']/i);
  if (pdfMatch) {
    return pdfMatch[1];
  }

  return null;
}

async function main() {
  console.log('Fetching PDF URLs from IMAP emails...\n');

  // Get documents missing PDFs
  const docs = await pool.query(`
    SELECT id, subject, received_date
    FROM research_documents
    WHERE attachment_count = 0
      AND (body_text LIKE '%CLICK HERE%' OR body_text LIKE '%Click to open%')
      AND length(body_text) = 1850
    ORDER BY received_date DESC
  `);

  console.log(`Found ${docs.rows.length} documents with truncated body text\n`);

  await client.connect();
  console.log('✓ Connected to IMAP\n');

  await client.mailboxOpen('INBOX');

  let found = 0;
  let notFound = 0;

  for (const doc of docs.rows) {
    console.log(`\nSearching for: ${doc.subject}`);
    const receivedDate = new Date(doc.received_date);

    try {
      // Search by subject and date range
      const results = await client.search({
        subject: doc.subject,
        since: new Date(receivedDate.getTime() - 12*60*60*1000), // 12 hours before
        before: new Date(receivedDate.getTime() + 12*60*60*1000), // 12 hours after
      });

      if (results.length === 0) {
        console.log('  ⚠️  Email not found');
        notFound++;
        continue;
      }

      console.log(`  ✓ Found email (UID: ${results[0]})`);

      // Fetch raw email source
      const message = await client.fetchOne(results[0], { source: true });
      const rawEmail = message.source.toString();

      // Extract PDF URL
      const pdfUrl = extractPdfUrl(rawEmail);

      if (pdfUrl) {
        console.log(`  ✓ PDF URL: ${pdfUrl}`);

        // Update database - append URL to body text
        await pool.query(
          `UPDATE research_documents
           SET body_text = body_text || $1
           WHERE id = $2`,
          [`\n\nFull Report: ${pdfUrl}`, doc.id]
        );

        console.log('  ✓ Updated database');
        found++;
      } else {
        console.log('  ❌ No PDF URL found in email');
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
  await pool.end();

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total: ${docs.rows.length}`);
  console.log(`✓ Found: ${found}`);
  console.log(`❌ Not found: ${notFound}`);

  if (found > 0) {
    console.log('\nNext: Run download-missing-pdfs.ts to download the PDFs');
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
