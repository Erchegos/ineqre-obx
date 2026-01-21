/**
 * Simple, reliable body text extraction using raw email fetch
 */

require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { Pool } = require('pg');

let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

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

function extractTextAndLink(html) {
  // Extract link - try multiple patterns
  let reportUrl = '';

  // Method 1: FactSet hosting link (quoted-printable encoded)
  const factsetMatch = html.match(/href=3D["']([^"']*parp\.hosting\.factset\.com[^"']*)["']/i);
  if (factsetMatch) {
    // Decode the quoted-printable URL
    reportUrl = factsetMatch[1]
      .replace(/=\r?\n/g, '')  // Remove soft line breaks
      .replace(/=3D/gi, '=')
      .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  // Method 2: Direct research.paretosec.com link
  if (!reportUrl) {
    const directMatch = html.match(/href=["']([^"']*research\.paretosec\.com[^"']*)["']/i);
    if (directMatch) reportUrl = directMatch[1];
  }

  // Find actual HTML content - look for <!DOCTYPE or <html or <table (Pareto emails)
  let htmlContent = html;

  // Try to find start of HTML
  const htmlStart = html.search(/(?:<!DOCTYPE|<html|<table[^>]*cellspacing)/i);
  if (htmlStart > 0) {
    htmlContent = html.substring(htmlStart);
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

  // Extract text - get everything between body tags
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
  }

  return { text, reportUrl };
}

async function main() {
  const imap = new ImapFlow(CONFIG.email);

  try {
    console.log('Connecting to Gmail...');
    await imap.connect();
    console.log('Connected!\n');

    await imap.mailboxOpen('INBOX');

    // Get all Pareto emails from 2026
    console.log('Searching for Pareto emails from 2026...');
    const messages = [];

    for await (const msg of imap.fetch(
      {
        since: new Date('2026-01-01'),
        before: new Date('2027-01-01'),
        from: 'noreply@research.paretosec.com'
      },
      {
        envelope: true,
        source: true  // Get raw email source
      }
    )) {
      messages.push({
        messageId: msg.envelope.messageId,
        subject: msg.envelope.subject,
        source: msg.source.toString('utf-8')
      });

      if (messages.length % 50 === 0) {
        console.log(`  Fetched ${messages.length} emails...`);
      }
    }

    console.log(`✓ Fetched ${messages.length} emails\n`);

    // Get docs without body text
    const docs = await pool.query(`
      SELECT id, email_message_id, subject
      FROM research_documents
      WHERE source = 'Pareto Securities'
        AND received_date >= '2026-01-01'
      ORDER BY received_date
    `);

    console.log(`Found ${docs.rows.length} documents needing body text\n`);

    let updated = 0;
    let failed = 0;

    for (const doc of docs.rows) {
      const msg = messages.find(m => m.messageId === doc.email_message_id);

      if (!msg) {
        console.log(`✗ ${doc.subject.substring(0, 60)}... - Not found in Gmail`);
        failed++;
        continue;
      }

      try {
        const { text, reportUrl } = extractTextAndLink(msg.source);

        if (text.length > 100) {
          await pool.query(
            'UPDATE research_documents SET body_text = $1 WHERE id = $2',
            [text, doc.id]
          );

          const preview = text.substring(0, 100).replace(/\n/g, ' ');
          console.log(`✓ ${doc.subject.substring(0, 50)}...`);
          console.log(`  Preview: ${preview}...`);
          if (reportUrl) console.log(`  Link: ${reportUrl.substring(0, 60)}...`);
          console.log();
          updated++;
        } else {
          console.log(`⚠ ${doc.subject.substring(0, 60)}... - No text found`);
          failed++;
        }
      } catch (err) {
        console.log(`✗ ${doc.subject.substring(0, 60)}... - Error: ${err.message}`);
        failed++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✓ Updated: ${updated}`);
    console.log(`✗ Failed: ${failed}`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await imap.logout();
    await pool.end();
  }
}

main().catch(console.error);
