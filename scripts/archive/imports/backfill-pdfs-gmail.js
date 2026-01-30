#!/usr/bin/env node
/**
 * Backfill missing PDFs using Gmail API
 * Fetches original emails and extracts PDF URLs from HTML
 */
require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Use native fetch (Node 18+)
const fetch = globalThis.fetch;

const CONFIG = {
  credentialsPath: path.join(__dirname, '../gmail-credentials.json'),
  tokenPath: path.join(__dirname, '../gmail-token.json'),
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function authorize() {
  const credentials = JSON.parse(fs.readFileSync(CONFIG.credentialsPath));
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (fs.existsSync(CONFIG.tokenPath)) {
    const token = JSON.parse(fs.readFileSync(CONFIG.tokenPath));
    oAuth2Client.setCredentials(token);
  }
  return oAuth2Client;
}

function extractPdfUrl(rawEmail) {
  // Try quoted-printable format first (href=3D)
  let match = rawEmail.match(/href=3D["']([^"']*factset[^"']{0,500})["']/i);
  if (match) {
    const decoded = match[1]
      .replace(/=\r?\n/g, '')
      .replace(/=3D/gi, '=')
      .replace(/=([0-9A-F]{2})/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
    return decoded.replace(/&amp;/g, '&');
  }

  // Try plain href
  match = rawEmail.match(/href=["']([^"']*parp\.hosting\.factset\.com[^"']{0,500})["']/i);
  if (match) {
    return match[1].replace(/&amp;/g, '&');
  }

  // Try plain URL
  match = rawEmail.match(/https:\/\/parp\.hosting\.factset\.com[^\s"'<>]{0,500}/i);
  if (match) {
    return match[0];
  }

  return null;
}

async function downloadPdf(url) {
  console.log(`    Downloading PDF...`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download PDF: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer);
}

async function savePdfAttachment(documentId, pdfBuffer, subject) {
  const filename = subject
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 200) + '.pdf';

  await pool.query(
    `INSERT INTO research_attachments (document_id, filename, content_type, file_data, created_at)
     VALUES ($1, $2, 'application/pdf', $3, NOW())`,
    [documentId, filename, pdfBuffer]
  );

  console.log(`    ✓ Saved: ${filename} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  console.log('='.repeat(70));
  console.log('BACKFILLING MISSING PDFs VIA GMAIL API');
  console.log('='.repeat(70));

  // Find documents without attachments
  const result = await pool.query(`
    SELECT id, subject, email_message_id
    FROM research_documents
    WHERE email_message_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM research_attachments WHERE document_id = research_documents.id
      )
    ORDER BY received_date DESC
    LIMIT 10
  `);

  console.log(`\nFound ${result.rows.length} documents without PDFs\n`);

  const auth = await authorize();
  const gmail = google.gmail({ version: 'v1', auth });

  let successful = 0;
  let failed = 0;

  for (const doc of result.rows) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${doc.subject}`);
    console.log(`${'='.repeat(60)}`);

    try {
      // Search for email by message ID
      console.log(`  Searching Gmail for message ID...`);
      const searchResponse = await gmail.users.messages.list({
        userId: 'me',
        q: `rfc822msgid:${doc.email_message_id}`,
        maxResults: 1,
      });

      if (!searchResponse.data.messages || searchResponse.data.messages.length === 0) {
        console.log(`  ⚠️  Email not found in Gmail`);
        failed++;
        continue;
      }

      const messageId = searchResponse.data.messages[0].id;
      console.log(`  ✓ Found Gmail message`);

      // Fetch raw email
      console.log(`  Fetching email content...`);
      const fullMessage = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'raw',
      });

      const rawEmail = Buffer.from(fullMessage.data.raw, 'base64url').toString('utf-8');
      console.log(`  ✓ Retrieved email`);

      // Extract PDF URL
      const pdfUrl = extractPdfUrl(rawEmail);
      if (!pdfUrl) {
        console.log(`  ⚠️  No PDF URL found in email`);
        failed++;
        continue;
      }

      console.log(`  ✓ Found PDF URL`);

      // Download PDF
      const pdfBuffer = await downloadPdf(pdfUrl);
      console.log(`  ✓ Downloaded ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

      // Save to database
      await savePdfAttachment(doc.id, pdfBuffer, doc.subject);

      successful++;
      console.log(`  ✅ Complete`);

    } catch (error) {
      console.error(`  ✗ Error: ${error.message}`);
      failed++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '='.repeat(70));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(70));
  console.log(`\nTotal: ${result.rows.length}`);
  console.log(`Successfully backfilled: ${successful}`);
  console.log(`Failed: ${failed}`);

  await pool.end();
}

main().catch(console.error);
