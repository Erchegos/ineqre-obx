/**
 * Generate AI summaries for research documents
 * 
 * This script uses Claude AI to generate concise summaries of research reports
 * focusing on key data points and actionable insights.
 */

require('dotenv').config();
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

// Database setup
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

// Anthropic AI setup
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Generate a concise summary using Claude AI
 */
async function generateSummary(subject, bodyText) {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Summarize this financial research report in 2-3 concise bullet points focusing on:
- Key financial metrics and numbers
- Main business developments or events
- Price targets, ratings, or recommendations

Report title: ${subject}

Report content:
${bodyText.substring(0, 2000)}

Provide ONLY the bullet points, no introduction or conclusion. Use • for bullets.`
      }]
    });

    return message.content[0].text.trim();
  } catch (error) {
    console.error(`AI summary failed: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('Generating AI summaries for research documents...\n');

  try {
    // Check for API key
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('Error: ANTHROPIC_API_KEY not found in environment');
      console.log('Please add your Anthropic API key to .env file');
      process.exit(1);
    }

    // Check if summary column exists, if not add it
    await pool.query(`
      ALTER TABLE research_documents 
      ADD COLUMN IF NOT EXISTS ai_summary TEXT
    `);

    // Get documents without summaries
    const result = await pool.query(`
      SELECT id, subject, body_text
      FROM research_documents
      WHERE body_text IS NOT NULL
        AND (ai_summary IS NULL OR ai_summary = '')
        AND received_date >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY received_date DESC
      LIMIT 50
    `);

    console.log(`Found ${result.rows.length} documents to summarize\n`);

    if (result.rows.length === 0) {
      console.log('All recent documents already have summaries!');
      await pool.end();
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const doc of result.rows) {
      try {
        console.log(`Summarizing: ${doc.subject.substring(0, 60)}...`);

        const summary = await generateSummary(doc.subject, doc.body_text);

        if (summary) {
          await pool.query(
            'UPDATE research_documents SET ai_summary = $1 WHERE id = $2',
            [summary, doc.id]
          );
          console.log(`✓ Summary generated (${summary.length} chars)\n`);
          successCount++;
        } else {
          console.log(`✗ Failed to generate summary\n`);
          failCount++;
        }

        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err) {
        console.log(`✗ Error: ${err.message}\n`);
        failCount++;
      }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`Generated: ${successCount} summaries`);
    console.log(`Failed: ${failCount}`);
    console.log(`${'='.repeat(50)}\n`);

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
