#!/usr/bin/env node
/**
 * Regenerate AI summaries for research documents using the structured format.
 *
 * Modes:
 *   --all         Regenerate ALL summaries (old + new format)
 *   --old-only    Only regenerate old-format summaries (default)
 *   --missing     Only generate for docs without summaries
 *   --batch=N     Process N documents per run (default: unlimited)
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

// Parse CLI flags
const args = process.argv.slice(2);
const mode = args.includes('--all') ? 'all'
  : args.includes('--missing') ? 'missing'
  : 'old-only';
const batchFlag = args.find(a => a.startsWith('--batch='));
const batchSize = batchFlag ? parseInt(batchFlag.split('=')[1], 10) : null;

// Clean body text before sending to Claude
function cleanBodyText(text) {
  if (!text) return '';

  let cleaned = text
    .split(/This message is confidential/i)[0]
    .split(/Source:\s*Pareto Securities/i)[0]
    .split(/Analyst\(s\):/i)[0]
    .split(/Please refer to the specific research discla/i)[0]
    .split(/\n*Full Report:/i)[0];

  cleaned = cleaned
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
    .replace(/\+\d{2}\s*\d{2}\s*\d{2}\s*\d{2}\s*\d{2}/g, '');

  cleaned = cleaned.replace(/CLICK HERE FOR THE FULL REPORT/gi, '');
  cleaned = cleaned.replace(/Click to open report/gi, '');

  return cleaned.trim();
}

async function generateSummary(bodyText, subject) {
  const cleanedText = cleanBodyText(bodyText);

  if (!cleanedText || cleanedText.length < 100) return null;

  const isBorsXtra = /børsxtra|borsxtra/i.test(subject);
  const isSectorUpdate = !isBorsXtra && /^(seafood|energy daily|fig weekly|morning comment|high yield|shipping daily)|price update|weekly market|market analysis/i.test(subject);

  let prompt;
  if (isBorsXtra) {
    prompt = `Extract ALL broker rating and price target changes from this Norwegian market newsletter. Output ONLY the structured list below — no commentary, disclaimers, or boilerplate.

Format — one line per company, then a brief market summary:

**Price Target Changes:**
- **[COMPANY]**: [Broker] [action] target to NOK [new] ([old]), [Buy/Hold/Sell]
- **[COMPANY]**: [Broker] [action] target to NOK [new] ([old]), [Buy/Hold/Sell]
[...continue for ALL companies mentioned with target/rating changes...]

**Market:** [1-2 sentences on market open, oil price, key macro moves]

Rules:
- List EVERY company with a price target or rating change — do not skip any
- Keep original NOK/USD amounts and old values in parentheses
- Note upgrades/downgrades explicitly (e.g. "upgraded from Hold to Buy")
- Use Norwegian broker short names: Pareto, DNB Carnegie, Arctic, SB1M, Clarksons, Fearnley, Nordea, SEB, Danske Bank, ABG
- Company names in Norwegian style (e.g. Aker BP, Kongsberg Gruppen, Nordic Semiconductor)
- No disclaimers or legal text

Newsletter: ${subject}

Content:
${cleanedText.substring(0, 15000)}`;
  } else if (isSectorUpdate) {
    prompt = `Summarize this market/sector update. Output ONLY the summary — no disclaimers, legal text, or boilerplate.

Format:
**Key Takeaway:** [1-2 sentences on the most important insight]

**Key Points:**
- [Most important data point or development]
- [Second key point]
- [Additional points if material — max 5 bullets total]

Rules:
- Focus on market data, prices, trends, and sector dynamics
- Keep all numbers, percentages, and financial metrics
- Do NOT include Rating, Target Price, or Share Price headers
- No legal disclaimers or boilerplate
- Be concise — entire output under 200 words

Report: ${subject}

Content:
${cleanedText.substring(0, 15000)}`;
  } else {
    prompt = `Summarize this equity research report. Output ONLY the summary — no disclaimers, legal text, confidentiality notices, or boilerplate.

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
- Mention peer companies or sector names when relevant (helps search)
- No legal disclaimers, confidentiality notices, or analyst disclosures
- No "this report does not provide" or "please refer to" language
- Be concise — entire output under 250 words

Report: ${subject}

Content:
${cleanedText.substring(0, 15000)}`;
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: isBorsXtra ? 2048 : 1024,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    let summary = message.content[0].text;

    // Remove any preamble the model might add
    summary = summary.replace(/^(Here is|Below is|Summary of)[^:]*:\s*\n*/i, '');

    // Strip any disclaimers/legal text that slipped through
    summary = summary.split(/\n*(This (message|report|document) is confidential|Please refer to|Disclaimer|Legal Notice|Important (Notice|Disclosure))/i)[0];

    // Clean up whitespace
    summary = summary.replace(/\n{3,}/g, '\n\n').trim();

    return summary;
  } catch (error) {
    console.error(`  Claude API error: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log(`Regenerating AI summaries (mode: ${mode})...\n`);

  let query;
  if (mode === 'missing') {
    query = `
      SELECT id, subject, body_text, source
      FROM research_documents
      WHERE (ai_summary IS NULL OR ai_summary = '')
        AND body_text IS NOT NULL AND length(body_text) > 100
      ORDER BY received_date DESC
    `;
  } else if (mode === 'all') {
    query = `
      SELECT id, subject, body_text, source
      FROM research_documents
      WHERE body_text IS NOT NULL AND length(body_text) > 100
      ORDER BY received_date DESC
    `;
  } else {
    // old-only: has summary but NOT in new structured format
    query = `
      SELECT id, subject, body_text, source
      FROM research_documents
      WHERE ai_summary IS NOT NULL AND ai_summary != ''
        AND ai_summary NOT LIKE '%**Rating:%'
        AND ai_summary NOT LIKE '%**Target%'
        AND body_text IS NOT NULL AND length(body_text) > 100
      ORDER BY received_date DESC
    `;
  }

  const result = await pool.query(query);
  const docs = batchSize ? result.rows.slice(0, batchSize) : result.rows;

  console.log(`Found ${result.rows.length} documents to process`);
  if (batchSize) console.log(`Processing batch of ${docs.length}`);
  console.log('');

  if (docs.length === 0) {
    console.log('Nothing to do!');
    await pool.end();
    return;
  }

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    process.stdout.write(`[${i + 1}/${docs.length}] ${doc.subject.substring(0, 55)}... `);

    const summary = await generateSummary(doc.body_text, doc.subject);

    if (summary) {
      await pool.query(
        `UPDATE research_documents SET ai_summary = $1 WHERE id = $2`,
        [summary, doc.id]
      );
      console.log(`OK (${summary.length} chars)`);
      updated++;
    } else {
      console.log('FAIL');
      failed++;
    }

    // Rate limiting - 1s between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total: ${docs.length} | Updated: ${updated} | Failed: ${failed}`);
  console.log('='.repeat(60));

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
