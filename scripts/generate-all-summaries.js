#!/usr/bin/env node
/**
 * Generate AI summaries for ALL research documents without summaries
 */

require('dotenv').config();
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=\w+/g, '') + '?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Clean body text before sending to Claude
function cleanBodyText(text) {
  if (!text) return '';

  // Remove disclaimers and footers
  let cleaned = text
    .split(/This message is confidential/i)[0]
    .split(/Source:\s*Pareto Securities/i)[0]
    .split(/Analyst\(s\):/i)[0]
    .split(/Please refer to the specific research discla/i)[0]
    .split(/\n*Full Report:/i)[0];

  // Remove email addresses and phone numbers
  cleaned = cleaned
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
    .replace(/\+\d{2}\s*\d{2}\s*\d{2}\s*\d{2}\s*\d{2}/g, '');

  // Remove "CLICK HERE" buttons
  cleaned = cleaned.replace(/CLICK HERE FOR THE FULL REPORT/gi, '');
  cleaned = cleaned.replace(/Click to open report/gi, '');

  return cleaned.trim();
}

async function generateSummary(bodyText, subject) {
  const cleanedText = cleanBodyText(bodyText);

  const prompt = `Analyze this financial research report and write a professional summary (2-3 paragraphs) covering:

- Investment thesis and recommendation
- Key financial metrics, estimates, or valuation
- Significant events, catalysts, or changes
- Target price or rating if mentioned

Write directly in a professional tone without meta-commentary.

Report: ${subject}

Content:
${cleanedText.substring(0, 15000)}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    // Clean any residual prompt language
    let summary = message.content[0].text;
    summary = summary.replace(/^Here is (a|the) (concise,?\s*)?(professional\s*)?summary[^:]*:\s*/i, '');
    summary = summary.replace(/^Based on the (content|report)[^:]*:\s*/i, '');

    return summary.trim();
  } catch (error) {
    console.error(`  ❌ Claude API error: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('Generating AI summaries for all documents...\n');

  // Get documents without summaries
  const result = await pool.query(`
    SELECT id, subject, body_text, source
    FROM research_documents
    WHERE ai_summary IS NULL OR ai_summary = ''
    ORDER BY received_date DESC
    LIMIT 50
  `);

  console.log(`Found ${result.rows.length} documents without AI summaries\n`);

  if (result.rows.length === 0) {
    console.log('All documents already have summaries!');
    await pool.end();
    return;
  }

  let updated = 0;
  let failed = 0;

  for (const doc of result.rows) {
    console.log(`Processing: ${doc.subject.substring(0, 60)}...`);
    console.log(`  Source: ${doc.source}`);

    if (!doc.body_text || doc.body_text.length < 100) {
      console.log(`  ⚠️  Body text too short, skipping\n`);
      failed++;
      continue;
    }

    const summary = await generateSummary(doc.body_text, doc.subject);

    if (summary) {
      await pool.query(
        `UPDATE research_documents SET ai_summary = $1 WHERE id = $2`,
        [summary, doc.id]
      );

      console.log(`  ✓ Generated summary (${summary.length} chars)\n`);
      updated++;
    } else {
      console.log(`  ❌ Failed to generate summary\n`);
      failed++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total processed: ${result.rows.length}`);
  console.log(`✓ Updated: ${updated}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('');

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
