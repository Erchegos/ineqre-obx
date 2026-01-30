#!/usr/bin/env tsx
/**
 * Manually upload a PDF to attach to a research document
 * Usage: tsx upload-research-pdf.ts <pdf-file-path> <document-id>
 */
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function listDocumentsWithoutPdfs() {
  const result = await pool.query(`
    SELECT
      id,
      subject,
      source,
      received_date::text
    FROM research_documents
    WHERE NOT EXISTS (
      SELECT 1 FROM research_attachments WHERE document_id = research_documents.id
    )
    ORDER BY received_date DESC
    LIMIT 20
  `);

  return result.rows;
}

async function uploadPdf(pdfPath: string, documentId: string) {
  // Check if file exists
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`File not found: ${pdfPath}`);
  }

  // Check if it's a PDF
  if (!pdfPath.toLowerCase().endsWith('.pdf')) {
    throw new Error('File must be a PDF');
  }

  // Read PDF file
  const pdfBuffer = fs.readFileSync(pdfPath);
  const filename = path.basename(pdfPath);

  console.log(`\nFile: ${filename}`);
  console.log(`Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

  // Get document details
  const docResult = await pool.query(
    'SELECT id, subject FROM research_documents WHERE id = $1',
    [documentId]
  );

  if (docResult.rows.length === 0) {
    throw new Error(`Document not found: ${documentId}`);
  }

  const doc = docResult.rows[0];
  console.log(`\nDocument: ${doc.subject}`);
  console.log(`ID: ${doc.id}`);

  // Insert attachment
  await pool.query(
    `INSERT INTO research_attachments (document_id, filename, content_type, file_data, created_at)
     VALUES ($1, $2, 'application/pdf', $3, NOW())`,
    [documentId, filename, pdfBuffer]
  );

  console.log(`\n✅ PDF uploaded successfully`);
}

async function main() {
  const args = process.argv.slice(2);

  console.log('='.repeat(70));
  console.log('MANUAL PDF UPLOAD FOR RESEARCH DOCUMENTS');
  console.log('='.repeat(70));

  if (args.length === 0) {
    // List documents without PDFs
    console.log('\nDocuments without PDFs:\n');
    const docs = await listDocumentsWithoutPdfs();

    if (docs.length === 0) {
      console.log('No documents found without PDFs');
    } else {
      console.log('ID'.padEnd(40) + 'Subject');
      console.log('-'.repeat(100));
      docs.forEach(doc => {
        console.log(doc.id.padEnd(40) + doc.subject.substring(0, 60));
      });

      console.log('\n' + '='.repeat(70));
      console.log('To upload a PDF:');
      console.log('tsx scripts/upload-research-pdf.ts <pdf-file> <document-id>');
      console.log('\nExample:');
      console.log('tsx scripts/upload-research-pdf.ts ~/Downloads/Trelleborg.pdf cd711ec8-cd00-47ea-8bf9-999f58c0c7dc');
    }
  } else if (args.length === 2) {
    // Upload PDF
    const [pdfPath, documentId] = args;
    await uploadPdf(pdfPath, documentId);
  } else {
    console.error('\nUsage:');
    console.error('  List documents: tsx scripts/upload-research-pdf.ts');
    console.error('  Upload PDF: tsx scripts/upload-research-pdf.ts <pdf-file> <document-id>');
    process.exit(1);
  }

  await pool.end();
}

main();
