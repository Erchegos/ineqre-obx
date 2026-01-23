#!/usr/bin/env node
/**
 * Update AI summaries for manually uploaded documents that don't have them
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

async function generateSummary(bodyText, subject) {
  const prompt = `You are analyzing a financial research report. Please provide a concise summary (2-3 paragraphs) of the key points, including:

- Main thesis or recommendation
- Key financial metrics or estimates mentioned
- Important events, catalysts, or changes
- Target price or valuation if mentioned

Keep the summary professional and focused on actionable insights.

Report title: ${subject}

Content:
${bodyText}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    return message.content[0].text;
  } catch (error) {
    console.error(`  ❌ Claude API error: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('Updating AI summaries for manual uploads...\n');

  const result = await pool.query(`
    SELECT id, subject, body_text
    FROM research_documents
    WHERE source = 'Manual Upload'
      AND (ai_summary IS NULL OR ai_summary = '')
    ORDER BY received_date DESC
  `);

  console.log(`Found ${result.rows.length} documents without AI summaries\n`);

  let updated = 0;

  for (const doc of result.rows) {
    console.log(`Processing: ${doc.subject}`);

    const summary = await generateSummary(doc.body_text, doc.subject);

    if (summary) {
      await pool.query(
        `UPDATE research_documents SET ai_summary = $1 WHERE id = $2`,
        [summary, doc.id]
      );

      console.log(`  ✓ Updated (${summary.length} chars)\n`);
      updated++;
    } else {
      console.log(`  ❌ Failed\n`);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('='.repeat(80));
  console.log(`Total updated: ${updated}/${result.rows.length}`);

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
