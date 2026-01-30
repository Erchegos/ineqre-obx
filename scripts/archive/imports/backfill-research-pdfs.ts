#!/usr/bin/env tsx
/**
 * Backfill missing PDFs for research documents
 * Finds documents without attachments and downloads their PDFs
 */
import { Pool } from 'pg';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface Document {
  id: string;
  subject: string;
  body_text: string;
  email_message_id: string;
}

async function extractPdfUrl(bodyText: string): Promise<string | null> {
  // Look for FactSet PDF URL in email body
  const match = bodyText.match(/href=["']([^"']*parp\.hosting\.factset\.com[^"']*)["']/i);
  if (match) {
    return match[1].replace(/&amp;/g, '&');
  }
  return null;
}

async function downloadPdf(url: string): Promise<Buffer> {
  console.log(`  Downloading PDF from: ${url.substring(0, 80)}...`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download PDF: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer);
}

async function savePdfAttachment(documentId: string, pdfBuffer: Buffer, subject: string) {
  // Generate filename from subject
  const filename = subject
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 200) + '.pdf';

  await pool.query(
    `INSERT INTO research_attachments (document_id, filename, content_type, file_data, created_at)
     VALUES ($1, $2, 'application/pdf', $3, NOW())`,
    [documentId, filename, pdfBuffer]
  );

  console.log(`  ✓ Saved PDF: ${filename} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  console.log('='.repeat(70));
  console.log('BACKFILLING MISSING RESEARCH PDFs');
  console.log('='.repeat(70));

  // Find documents without attachments
  const result = await pool.query(`
    SELECT
      rd.id,
      rd.subject,
      rd.body_text,
      rd.email_message_id
    FROM research_documents rd
    LEFT JOIN research_attachments ra ON rd.id = ra.document_id
    WHERE ra.id IS NULL
      AND rd.body_text IS NOT NULL
      AND rd.body_text != ''
    ORDER BY rd.received_date DESC
  `);

  console.log(`\nFound ${result.rows.length} documents without attachments\n`);

  let successful = 0;
  let failed = 0;
  const errors: { subject: string; error: string }[] = [];

  for (const doc of result.rows as Document[]) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Processing: ${doc.subject}`);
    console.log(`${'='.repeat(60)}`);

    try {
      // Extract PDF URL from email body
      const pdfUrl = await extractPdfUrl(doc.body_text);

      if (!pdfUrl) {
        console.log('  ⚠️  No PDF URL found in email body');
        failed++;
        errors.push({ subject: doc.subject, error: 'No PDF URL found' });
        continue;
      }

      console.log('  ✓ Found PDF URL');

      // Download PDF
      const pdfBuffer = await downloadPdf(pdfUrl);
      console.log(`  ✓ Downloaded ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

      // Save to database
      await savePdfAttachment(doc.id, pdfBuffer, doc.subject);

      successful++;
      console.log('  ✅ Complete');

    } catch (error: any) {
      console.error(`  ✗ Error: ${error.message}`);
      failed++;
      errors.push({ subject: doc.subject, error: error.message });
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(70));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(70));
  console.log(`\nTotal documents: ${result.rows.length}`);
  console.log(`Successfully backfilled: ${successful}`);
  console.log(`Failed: ${failed}`);

  if (errors.length > 0) {
    console.log('\n✗ Failed documents:');
    errors.forEach(e => {
      console.log(`  - ${e.subject}`);
      console.log(`    Error: ${e.error}`);
    });
  }

  await pool.end();
}

main();
