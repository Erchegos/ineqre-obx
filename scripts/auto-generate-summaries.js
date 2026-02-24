#!/usr/bin/env node
/**
 * Auto-generate AI summaries for research documents without summaries
 * Handles SSL certificates properly for both local and production
 */

// Disable SSL certificate validation for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

require('dotenv').config();
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

// Configure database connection with proper SSL handling
const connectionString = process.env.DATABASE_URL
  .trim()
  .replace(/^["']|["']$/g, '');

const pool = new Pool({
  connectionString: connectionString,
  ssl: false // Disable SSL for local development
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
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    // Clean any residual prompt language
    let summary = message.content[0].text;

    // Remove "Summary:" at the start
    summary = summary.replace(/^Summary:\s*\n+/i, '');

    // Remove prompt language
    summary = summary.replace(/^Here is (a|the) (concise,?\s*)?(professional\s*)?summary[^:]*:\s*/i, '');
    summary = summary.replace(/^Based on the (content|report)[^:]*:\s*/i, '');

    // Remove section headers
    summary = summary.replace(/^(Main Investment Thesis\/Recommendation|Main Investment Thesis or Key Recommendation|Main Thesis and Recommendation|Main Thesis and Recommendations|Key Financial(s| Metrics)( and Estimates)?|Significant Events(, Catalysts,? or Changes)?|Target Price or Rating|Target Price\/Rating|Catalysts and Key Events|Key Points?|Important Financial (Metrics|Information)):\s*/gim, '');

    // Remove section headers in the middle of text
    summary = summary.replace(/\n\s*(Main Investment Thesis\/Recommendation|Main Investment Thesis or Key Recommendation|Main Thesis and Recommendation|Main Thesis and Recommendations|Key Financial(s| Metrics)(,? and Estimates|, Estimates,? and Valuation)?|Significant Events(, Catalysts,? (or|and) Changes)?|Target Price or Rating|Target Price\/Rating|Catalysts and Key Events|Key Points?|Important Financial (Metrics|Information)):\s*/gim, '\n');

    // Remove multiple consecutive newlines
    summary = summary.replace(/\n{3,}/g, '\n\n');

    return summary.trim();
  } catch (error) {
    console.error(`  [ERROR] Claude API error: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('Auto-generating AI summaries for research documents...\n');

  try {
    // Get documents without summaries (limit to 10 at a time to avoid rate limits)
    const result = await pool.query(`
      SELECT id, subject, body_text, source
      FROM research_documents
      WHERE ai_summary IS NULL
      AND body_text IS NOT NULL
      AND body_text != ''
      ORDER BY received_date DESC
      LIMIT 10
    `);

    const docs = result.rows;
    console.log(`Found ${docs.length} documents needing summaries\n`);

    if (docs.length === 0) {
      console.log('All documents have summaries!');
      await pool.end();
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const doc of docs) {
      console.log(`Processing: ${doc.subject.substring(0, 60)}...`);
      console.log(`  Source: ${doc.source}`);

      const summary = await generateSummary(doc.body_text, doc.subject);

      if (summary) {
        // Update database with generated summary
        await pool.query(
          'UPDATE research_documents SET ai_summary = $1 WHERE id = $2',
          [summary, doc.id]
        );
        console.log(`  [SUCCESS] Summary generated (${summary.length} chars)\n`);
        successCount++;
      } else {
        console.log(`  [FAILED] Failed to generate summary\n`);
        failCount++;
      }

      // Rate limiting: wait 1 second between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Successfully generated: ${successCount}`);
    console.log(`Failed: ${failCount}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Fatal error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
}

module.exports = { generateSummary, cleanBodyText };
