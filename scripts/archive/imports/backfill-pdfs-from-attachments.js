#!/usr/bin/env node
/**
 * Backfill missing PDFs from Gmail email attachments
 */
require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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

async function savePdfAttachment(documentId, pdfBuffer, filename) {
  await pool.query(
    `INSERT INTO research_attachments (document_id, filename, content_type, file_data, created_at)
     VALUES ($1, $2, 'application/pdf', $3, NOW())`,
    [documentId, filename, pdfBuffer]
  );

  console.log(`    ✓ Saved: ${filename} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  console.log('='.repeat(70));
  console.log('BACKFILLING PDFs FROM GMAIL ATTACHMENTS');
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
      console.log(`  Searching Gmail...`);
      const searchResponse = await gmail.users.messages.list({
        userId: 'me',
        q: `rfc822msgid:${doc.email_message_id}`,
        maxResults: 1,
      });

      if (!searchResponse.data.messages || searchResponse.data.messages.length === 0) {
        console.log(`  ⚠️  Email not found`);
        failed++;
        continue;
      }

      const messageId = searchResponse.data.messages[0].id;

      // Fetch full message with attachments
      console.log(`  Fetching message...`);
      const message = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
      });

      // Look for PDF attachments
      let foundPdf = false;
      const parts = message.data.payload.parts || [];

      for (const part of parts) {
        if (part.filename && part.filename.toLowerCase().endsWith('.pdf')) {
          console.log(`  ✓ Found PDF attachment: ${part.filename}`);

          // Get attachment data
          const attachment = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: messageId,
            id: part.body.attachmentId,
          });

          const pdfBuffer = Buffer.from(attachment.data.data, 'base64');

          // Save to database
          await savePdfAttachment(doc.id, pdfBuffer, part.filename);

          successful++;
          foundPdf = true;
          console.log(`  ✅ Complete`);
          break;
        }
      }

      if (!foundPdf) {
        console.log(`  ⚠️  No PDF attachment found`);
        failed++;
      }

    } catch (error) {
      console.error(`  ✗ Error: ${error.message}`);
      failed++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
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
