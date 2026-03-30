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
    // Clean body text before sending
    let cleanedText = bodyText
      .split(/This message is confidential/i)[0]
      .split(/Source:\s*Pareto Securities/i)[0]
      .split(/Analyst\(s\):/i)[0]
      .split(/Please refer to the specific research discla/i)[0]
      .split(/\n*Full Report:/i)[0]
      .trim();

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Summarize this equity research report. Output ONLY the summary — no disclaimers, legal text, or boilerplate.

Format:
**Rating:** [Buy/Hold/Sell] | **Target Price:** [price in currency] | **Share Price:** [current price]

**Thesis:** [1-2 sentences on the core investment case]

**Key Points:**
- [Most important takeaway with specific numbers]
- [Second key point — earnings, margins, guidance, etc.]
- [Third key point — catalysts, risks, or sector dynamics]
- [Additional points if material — max 6 bullets total]

**Estimates:** [Key estimate changes if any — EPS, revenue, EBITDA revisions]

Rules:
- Include company name and ticker prominently
- Keep all numbers, percentages, and financial metrics
- Be thorough — capture ALL material information from the report
- No legal disclaimers, confidentiality notices, or analyst disclosures

Report: ${subject}

Content:
${cleanedText.substring(0, 30000)}`
      }]
    });

    return message.content[0].text.trim();
  } catch (error) {
    console.error(`AI summary failed: ${error.message}`);
    return null;
  }
}

const PLACEHOLDER_SIGNALS = [
  'appears to be a template',
  'appears to be a placeholder',
  'template or placeholder',
  'no actual financial data',
  'I would need the actual report',
  'please share the complete research report',
  'broken link',
  'only a header',
  'incomplete document',
  'not a complete',
  'does not contain',
  'missing the actual content',
];

const isPlaceholderSummary = (text) => {
  const lower = text.toLowerCase();
  return PLACEHOLDER_SIGNALS.some(s => lower.includes(s.toLowerCase()));
};

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
      LIMIT 100
    `);

    console.log(`Found ${result.rows.length} documents to summarize\n`);

    if (result.rows.length === 0) {
      console.log('All recent documents already have summaries!');
      await pool.end();
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let deletedCount = 0;

    for (const doc of result.rows) {
      try {
        // Skip documents with trivially short body text (placeholder emails, link-only)
        const bodyLen = (doc.body_text || '').trim().length;
        if (bodyLen < 300) {
          console.log(`✗ Deleting (body too short: ${bodyLen} chars): ${doc.subject.substring(0, 60)}`);
          await pool.query('DELETE FROM research_documents WHERE id = $1', [doc.id]);
          deletedCount++;
          continue;
        }

        console.log(`Summarizing: ${doc.subject.substring(0, 60)}...`);

        const summary = await generateSummary(doc.subject, doc.body_text);

        if (summary && isPlaceholderSummary(summary)) {
          console.log(`✗ Deleting (AI detected placeholder/template): ${doc.subject.substring(0, 60)}`);
          await pool.query('DELETE FROM research_documents WHERE id = $1', [doc.id]);
          deletedCount++;
        } else if (summary) {
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
    console.log(`Deleted (placeholder/empty): ${deletedCount}`);
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
