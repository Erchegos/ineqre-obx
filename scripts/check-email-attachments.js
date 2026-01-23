#!/usr/bin/env node
/**
 * Check if emails have PDF attachments we can extract
 */

require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

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

const storageDir = process.env.STORAGE_DIR || './storage/research';

// Ensure storage directory exists
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

async function main() {
  console.log('Checking for PDF attachments in emails...\n');

  const docs = await pool.query(`
    SELECT id, subject, received_date, ticker
    FROM research_documents
    WHERE attachment_count = 0
      AND received_date::date = '2026-01-23'
    ORDER BY received_date DESC
  `);

  console.log(`Checking ${docs.rows.length} emails\n`);

  await client.connect();
  await client.mailboxOpen('INBOX');

  let found = 0;
  let notFound = 0;

  for (const doc of docs.rows) {
    console.log(`\n${doc.subject}`);
    const receivedDate = new Date(doc.received_date);

    try {
      const results = await client.search({
        subject: doc.subject,
        since: new Date(receivedDate.getTime() - 12*60*60*1000),
        before: new Date(receivedDate.getTime() + 12*60*60*1000),
      });

      if (results.length === 0) {
        console.log('  ⚠️  Email not found');
        notFound++;
        continue;
      }

      // Fetch with bodyStructure to check for attachments
      const message = await client.fetchOne(results[0], { bodyStructure: true });

      if (!message.bodyStructure) {
        console.log('  ⚠️  No body structure');
        notFound++;
        continue;
      }

      // Find PDF attachments
      const findAttachments = (part, partId = '') => {
        const attachments = [];

        if (part.disposition === 'attachment' && part.type) {
          if (part.type.toLowerCase().includes('pdf') ||
              (part.parameters && part.parameters.name && part.parameters.name.toLowerCase().endsWith('.pdf'))) {
            attachments.push({
              partId: partId || part.part,
              filename: part.parameters?.name || 'attachment.pdf',
              size: part.size
            });
          }
        }

        if (part.childNodes) {
          part.childNodes.forEach((child, i) => {
            const childId = partId ? `${partId}.${i+1}` : `${i+1}`;
            attachments.push(...findAttachments(child, childId));
          });
        }

        return attachments;
      };

      const attachments = findAttachments(message.bodyStructure);

      if (attachments.length > 0) {
        console.log(`  ✓ Found ${attachments.length} PDF attachment(s)`);

        for (const att of attachments) {
          console.log(`    Downloading: ${att.filename} (${(att.size/1024).toFixed(1)} KB)`);

          // Download attachment
          const download = await client.download(results[0], att.partId);
          const chunks = [];
          for await (const chunk of download.content) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);

          // Generate filename
          const cleanSubject = doc.subject.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
          const filename = `${doc.ticker || 'UNKNOWN'}_${cleanSubject}.pdf`;
          const filepath = path.join(storageDir, `${doc.id}_${filename}`);

          // Save file
          fs.writeFileSync(filepath, buffer);

          // Insert into database
          await pool.query(
            `INSERT INTO research_attachments (document_id, filename, content_type, file_size, file_path, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [doc.id, att.filename, 'application/pdf', buffer.length, filepath]
          );

          // Update attachment count
          await pool.query(
            `UPDATE research_documents
             SET attachment_count = (SELECT COUNT(*) FROM research_attachments WHERE document_id = $1)
             WHERE id = $1`,
            [doc.id]
          );

          console.log(`    ✓ Saved to database`);
          found++;
        }
      } else {
        console.log('  ❌ No PDF attachments found');
        notFound++;
      }

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      notFound++;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await client.logout();
  await pool.end();

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total: ${docs.rows.length}`);
  console.log(`✓ PDFs extracted: ${found}`);
  console.log(`❌ Not found: ${notFound}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
