#!/usr/bin/env node
/**
 * Generate English AI summaries for DNB Carnegie macro research reports.
 * Downloads PDFs from Supabase, extracts text with pdftotext,
 * sends to Claude for English summary, updates DB.
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

require('dotenv').config();
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const connectionString = (process.env.DATABASE_URL || '')
  .trim()
  .replace(/^["']|["']$/g, '')
  .replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MACRO_PROMPT = `Summarize this DNB Carnegie macro/FI research report in English. If the report is in Norwegian, translate and summarize.

Output ONLY the summary in this format:

**Key Takeaway:** [1-2 sentences on the most important insight]

**Key Points:**
- [Most important data point or development]
- [Second key point]
- [Additional points if material — max 5 bullets total]

Rules:
- Always write in English, even if the source is Norwegian
- Focus on market data, economic indicators, central bank decisions, and implications
- Keep all numbers, percentages, and financial metrics
- Mention specific countries, currencies, and markets discussed
- Do NOT include Rating, Target Price, or Share Price headers
- No legal disclaimers or boilerplate
- Be concise — entire output under 200 words`;

async function extractPdfText(storagePath) {
  try {
    const { data, error } = await supabase.storage
      .from('research-pdfs')
      .download(storagePath);

    if (error || !data) {
      console.log(`    Supabase download failed: ${error?.message}`);
      return null;
    }

    const buf = Buffer.from(await data.arrayBuffer());
    const tmpFile = path.join(os.tmpdir(), `dnb_summary_${Date.now()}.pdf`);
    fs.writeFileSync(tmpFile, buf);

    let text = '';
    try {
      text = execSync(`pdftotext "${tmpFile}" - 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 10000,
      });
    } catch {
      text = '';
    }

    try { fs.unlinkSync(tmpFile); } catch {}
    return text;
  } catch (e) {
    console.log(`    PDF extraction error: ${e.message}`);
    return null;
  }
}

async function generateSummary(pdfText, subject) {
  const cleanedText = pdfText
    .replace(/MARKETING MATERIAL/gi, '')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
    .replace(/\+\d{2}\s*\d{2}\s*\d{2}\s*\d{2}\s*\d{2}/g, '')
    .trim();

  const prompt = `Report title: ${subject}

Content:
${cleanedText.substring(0, 15000)}

${MACRO_PROMPT}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    let summary = message.content[0].text;

    // Clean up
    summary = summary.replace(/^(Here is|Below is|Summary of)[^:]*:\s*\n*/i, '');
    summary = summary.replace(/\n{3,}/g, '\n\n');

    return summary.trim();
  } catch (error) {
    console.error(`    Claude API error: ${error.message}`);
    return null;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('Generating English summaries for DNB Carnegie reports...\n');

  // Get all DNB Carnegie reports without summaries
  const { rows: docs } = await pool.query(`
    SELECT d.id, d.subject, d.body_text, d.email_message_id,
           a.file_path
    FROM research_documents d
    LEFT JOIN research_attachments a ON a.document_id = d.id
    WHERE d.email_message_id LIKE 'dnb-markets-%'
    AND (d.ai_summary IS NULL OR d.ai_summary = '')
    ORDER BY d.received_date DESC
  `);

  console.log(`Found ${docs.length} reports needing summaries\n`);

  if (docs.length === 0) {
    console.log('All reports have summaries!');
    await pool.end();
    return;
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const shortTitle = doc.subject?.substring(0, 70) || 'Untitled';
    process.stdout.write(`  [${i + 1}/${docs.length}] ${shortTitle}...`);

    // Try PDF text extraction first
    let text = null;
    if (doc.file_path) {
      text = await extractPdfText(doc.file_path);
    }

    // Fallback to body_text
    if (!text || text.length < 100) {
      text = doc.body_text || '';
    }

    if (text.length < 50) {
      console.log(' SKIP (no content)');
      failed++;
      continue;
    }

    const summary = await generateSummary(text, doc.subject);
    if (summary) {
      await pool.query(
        'UPDATE research_documents SET ai_summary = $1 WHERE id = $2',
        [summary, doc.id]
      );
      console.log(' OK');
      success++;
    } else {
      console.log(' FAILED');
      failed++;
    }

    // Rate limit: 500ms between requests
    await sleep(500);
  }

  console.log(`\nDone: ${success} summaries generated, ${failed} failed`);
  await pool.end();
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
