#!/usr/bin/env node
/**
 * Merge manual PDF uploads into auto-imported email documents
 * - Finds matching documents by company/ticker and date
 * - Copies PDF attachment from manual upload to email document
 * - Updates email document with better AI summary if manual has one
 * - Deletes manual upload duplicate to avoid feed duplication
 */

require('dotenv').config();
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=\w+/g, '') + '?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findMatchingDocuments() {
  // Find manual uploads that might match email imports
  const query = `
    WITH manual_docs AS (
      SELECT
        d.id as manual_id,
        d.subject as manual_subject,
        d.ticker,
        d.received_date::date as doc_date,
        d.ai_summary as manual_summary,
        a.id as attachment_id,
        a.filename,
        a.file_path,
        a.file_size,
        a.content_type
      FROM research_documents d
      JOIN research_attachments a ON d.id = a.document_id
      WHERE d.source IN ('Pareto Securities', 'DNB Markets')
        AND d.email_message_id LIKE 'manual-%'
        AND d.attachment_count > 0
    ),
    email_docs AS (
      SELECT
        d.id as email_id,
        d.subject as email_subject,
        d.ticker,
        d.received_date::date as doc_date,
        d.ai_summary as email_summary,
        d.attachment_count
      FROM research_documents d
      WHERE d.source IN ('Pareto Securities', 'DNB Markets')
        AND d.email_message_id NOT LIKE 'manual-%'
    )
    SELECT
      m.manual_id,
      m.manual_subject,
      m.attachment_id,
      m.filename,
      m.file_path,
      m.file_size,
      m.content_type,
      m.manual_summary,
      e.email_id,
      e.email_subject,
      e.email_summary,
      e.attachment_count as email_has_pdf
    FROM manual_docs m
    JOIN email_docs e ON
      m.ticker = e.ticker
      AND m.doc_date = e.doc_date
      AND e.attachment_count = 0
    ORDER BY m.doc_date DESC
  `;

  const result = await pool.query(query);
  return result.rows;
}

async function mergePdfToEmail(match) {
  console.log(`\nMerging: ${match.manual_subject}`);
  console.log(`  Into: ${match.email_subject}`);

  try {
    // 1. Copy attachment record to email document
    await pool.query(
      `INSERT INTO research_attachments (document_id, filename, content_type, file_size, file_path, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [match.email_id, match.filename, match.content_type, match.file_size, match.file_path]
    );

    console.log(`  ✓ Copied PDF attachment`);

    // 2. Update email document attachment count
    await pool.query(
      `UPDATE research_documents
       SET attachment_count = (SELECT COUNT(*) FROM research_attachments WHERE document_id = $1)
       WHERE id = $1`,
      [match.email_id]
    );

    // 3. Update AI summary if manual has better one (longer/exists)
    if (match.manual_summary && (!match.email_summary || match.manual_summary.length > match.email_summary.length)) {
      await pool.query(
        `UPDATE research_documents SET ai_summary = $1 WHERE id = $2`,
        [match.manual_summary, match.email_id]
      );
      console.log(`  ✓ Updated with manual AI summary`);
    }

    // 4. Delete manual upload document (but keep PDF file in Supabase)
    await pool.query(
      `DELETE FROM research_attachments WHERE document_id = $1`,
      [match.manual_id]
    );

    await pool.query(
      `DELETE FROM research_documents WHERE id = $1`,
      [match.manual_id]
    );

    console.log(`  ✓ Deleted manual duplicate`);
    console.log(`  ✓ Merge complete!`);

    return true;

  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('Merging manual PDFs into email documents...\n');

  const matches = await findMatchingDocuments();

  console.log(`Found ${matches.length} manual PDFs that can be merged\n`);

  if (matches.length === 0) {
    console.log('No matches found. All manual PDFs are either:');
    console.log('  - Already merged');
    console.log('  - Have no matching email document');
    console.log('  - Email already has a PDF');
    await pool.end();
    return;
  }

  let merged = 0;
  let failed = 0;

  for (const match of matches) {
    const success = await mergePdfToEmail(match);
    if (success) {
      merged++;
    } else {
      failed++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total matches: ${matches.length}`);
  console.log(`✓ Merged: ${merged}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('');
  console.log('Manual PDF documents have been merged into email imports.');
  console.log('Duplicates removed from feed.');

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
