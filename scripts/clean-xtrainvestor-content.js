/**
 * Clean and format Xtrainvestor email content using Claude API
 *
 * This script processes raw Xtrainvestor email content through Claude API
 * to extract and format the key information in a clean, readable format.
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

// Claude API setup
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const CLEANING_PROMPT = `You are cleaning up a Norwegian stock market newsletter email. Extract and format the key information clearly.

Format the output as follows:

**MARKET OVERVIEW:**
[Brief summary of market performance - Oslo Børs, US markets, oil price, etc.]

**ANALYST ACTIONS:**
[List all upgrades, downgrades, target price changes, and new coverage. Format as:
- TICKER: Action - Details (Analyst/Firm if mentioned)]

**KEY TOPICS:**
[Major themes, sector updates, or company news mentioned]

Rules:
- Keep all Norwegian text as-is (don't translate)
- Use clear bullet points
- Preserve all ticker symbols
- Keep price targets and percentages
- Remove advertising/promotional content
- Remove "View in browser" links and footer content
- Keep it concise but informative`;

async function cleanContent(rawContent) {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `${CLEANING_PROMPT}\n\nEmail content:\n${rawContent}`
      }]
    });

    return message.content[0].text;
  } catch (error) {
    console.error('  Claude API error:', error.message);
    return null;
  }
}

async function processXtrainvestorEmails(limit = 50) {
  console.log('Fetching Xtrainvestor emails to clean...\n');

  // Get Xtrainvestor emails that haven't been cleaned yet
  const result = await pool.query(`
    SELECT id, subject, body_text, received_date
    FROM research_documents
    WHERE source = 'Xtrainvestor'
      AND (body_text NOT LIKE '**MARKET OVERVIEW:**%' OR body_text IS NULL)
    ORDER BY received_date DESC
    LIMIT $1
  `, [limit]);

  console.log(`Found ${result.rows.length} emails to clean\n`);

  let cleaned = 0;
  let failed = 0;

  for (const doc of result.rows) {
    const date = doc.received_date.toISOString().split('T')[0];
    console.log(`Processing: ${date} - ${doc.subject}`);

    if (!doc.body_text || doc.body_text.length < 50) {
      console.log('  ⚠️  Skipping - insufficient content\n');
      continue;
    }

    const cleanedText = await cleanContent(doc.body_text);

    if (cleanedText) {
      await pool.query(
        'UPDATE research_documents SET body_text = $1, updated_at = NOW() WHERE id = $2',
        [cleanedText, doc.id]
      );
      console.log(`  ✓ Cleaned (${cleanedText.length} chars)\n`);
      cleaned++;

      // Rate limiting - be nice to the API
      await new Promise(resolve => setTimeout(resolve, 500));
    } else {
      console.log('  ✗ Failed to clean\n');
      failed++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`✓ Successfully cleaned: ${cleaned}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Total processed: ${cleaned + failed}`);
}

async function main() {
  const limit = parseInt(process.argv[2]) || 50;

  console.log('╔════════════════════════════════════════════╗');
  console.log('║  Xtrainvestor Content Cleaner (Claude API) ║');
  console.log('╚════════════════════════════════════════════╝\n');

  try {
    await processXtrainvestorEmails(limit);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
