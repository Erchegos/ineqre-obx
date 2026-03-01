#!/usr/bin/env node
/**
 * Clean existing body_text in research_documents DB
 *
 * Strips disclaimers, analyst info, base64 data, MIME headers,
 * and other email junk from stored body text. Also regenerates
 * AI summaries for cleaned documents.
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

const connStr = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '').replace(/[?&]sslmode=\w+/g, '');
const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function stripEmailJunk(text) {
  if (!text) return '';

  // Cut at common disclaimer/footer markers (take content BEFORE them)
  const cutMarkers = [
    /\bThis message is confidential\b/i,
    /\bPlease refer to the specific research discla/i,
    /\bdisclaimer available on our website\b/i,
    /\bThis material is considered by Pareto Securities\b/i,
    /\bFor further information regarding the information we collect\b/i,
    /\bIf you no longer wish to receive such reports\b/i,
    /\bPlease note that conversations with Pareto Securities\b/i,
    /\bInternet based solutions Norway:\s*Please contact/i,
    /\bGlobal Privacy Notice\b/i,
    /------=_NextPart_/,
    /Content-Type:\s*image\//i,
    /Content-Transfer-Encoding:\s*base64/i,
  ];

  for (const marker of cutMarkers) {
    const idx = text.search(marker);
    if (idx > 100) {
      text = text.substring(0, idx);
    }
  }

  // Remove analyst contact info blocks
  text = text.replace(/Analyst\(s\):.*$/is, '');
  text = text.replace(/\+\d{2}\s*\d{1,3}\s*\d{2}\s*\d{2}\s*\d{2,4}/g, '');
  text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '');

  // Remove CTAs
  text = text.replace(/Click to open report/gi, '');
  text = text.replace(/CLICK HERE FOR THE FULL REPORT/gi, '');

  // Remove any remaining base64 data
  text = text.replace(/[A-Za-z0-9+/=]{50,}/g, '');

  // Remove MIME headers
  text = text.replace(/Content-Type:.*$/gim, '');
  text = text.replace(/Content-Transfer-Encoding:.*$/gim, '');
  text = text.replace(/Content-ID:.*$/gim, '');
  text = text.replace(/Content-Disposition:.*$/gim, '');
  text = text.replace(/filename="[^"]*"/gi, '');

  // Remove "Source: Pareto Securities" footer
  text = text.replace(/Source:\s*Pareto Securities.*/is, '');

  // Clean up whitespace
  text = text
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .replace(/\s\s+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();

  return text;
}

async function generateSummary(bodyText, subject) {
  let cleanedText = bodyText
    .split(/\n*Full Report:/i)[0]
    .trim();

  if (!cleanedText || cleanedText.length < 100) return null;

  const isSectorUpdate = /seafood|energy daily|fig weekly|morning comment|high yield|shipping daily|price update|weekly market|market analysis|oil\s*&\s*gas\s*-|real estate weekly/i.test(subject);

  let prompt;
  if (isSectorUpdate) {
    prompt = `Summarize this market/sector update. Output ONLY the summary — no disclaimers.

Format:
**Key Takeaway:** [1-2 sentences on the most important insight]

**Key Points:**
- [Most important data point or development]
- [Second key point]
- [Additional points if material — max 5 bullets total]

Report: ${subject}

Content:
${cleanedText.substring(0, 30000)}`;
  } else {
    prompt = `Summarize this equity research report. Output ONLY the summary — no disclaimers.

Format:
**Rating:** [Buy/Hold/Sell] | **Target Price:** [price in currency] | **Share Price:** [current price]

**Thesis:** [1-2 sentences on the core investment case]

**Key Points:**
- [Most important takeaway with specific numbers]
- [Second key point — earnings, margins, guidance, etc.]
- [Third key point — catalysts, risks, or sector dynamics]
- [Additional points if material — max 6 bullets total]

**Estimates:** [Key estimate changes if any — EPS, revenue, EBITDA revisions]

Report: ${subject}

Content:
${cleanedText.substring(0, 30000)}`;
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    });
    return message.content[0].text.trim();
  } catch (err) {
    console.error(`  AI error: ${err.message}`);
    return null;
  }
}

async function main() {
  const regenSummaries = process.argv.includes('--regen-summaries');
  console.log(`Cleaning body_text in research_documents...`);
  if (regenSummaries) console.log('Will also regenerate AI summaries.\n');

  // Find docs with junk in body_text
  const result = await pool.query(`
    SELECT id, subject, body_text, length(body_text) AS body_len
    FROM research_documents
    WHERE body_text IS NOT NULL
      AND (
        body_text LIKE '%Content-Type:%'
        OR body_text LIKE '%base64%'
        OR body_text LIKE '%This message is confidential%'
        OR body_text LIKE '%NextPart_%'
        OR body_text LIKE '%Analyst(s):%'
        OR body_text LIKE '%Click to open report%'
        OR body_text LIKE '%paretosec.com%'
      )
    ORDER BY received_date DESC
  `);

  console.log(`Found ${result.rows.length} documents with junk to clean\n`);

  let cleaned = 0;
  let summariesRegenerated = 0;

  for (const doc of result.rows) {
    const cleanedBody = stripEmailJunk(doc.body_text);
    const reduction = doc.body_len - cleanedBody.length;

    if (reduction < 50) continue; // Skip if barely any change

    console.log(`${doc.subject.substring(0, 65)}...`);
    console.log(`  ${doc.body_len} → ${cleanedBody.length} chars (removed ${reduction})`);

    let newSummary = null;
    if (regenSummaries && cleanedBody.length > 200) {
      newSummary = await generateSummary(cleanedBody, doc.subject);
      if (newSummary) summariesRegenerated++;
      await new Promise(r => setTimeout(r, 300));
    }

    if (newSummary) {
      await pool.query(
        'UPDATE research_documents SET body_text = $1, ai_summary = $2, updated_at = NOW() WHERE id = $3',
        [cleanedBody, newSummary, doc.id]
      );
    } else {
      await pool.query(
        'UPDATE research_documents SET body_text = $1, updated_at = NOW() WHERE id = $2',
        [cleanedBody, doc.id]
      );
    }

    cleaned++;
  }

  await pool.end();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Cleaned: ${cleaned} documents`);
  if (regenSummaries) console.log(`Summaries regenerated: ${summariesRegenerated}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
