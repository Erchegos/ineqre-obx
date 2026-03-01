#!/usr/bin/env node
/**
 * Re-import truncated email bodies from IMAP
 *
 * Finds documents with body_text ~1850 chars (old truncation limit),
 * re-fetches them from IMAP, extracts full body text, and updates
 * the database + regenerates AI summaries.
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const { Pool } = require('pg');
const { ImapFlow } = require('imapflow');
const Anthropic = require('@anthropic-ai/sdk');

// Database
const connStr = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '').replace(/[?&]sslmode=\w+/g, '');
const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

// Anthropic
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function cleanText(text) {
  return text
    .replace(/\u00E2\u0080\u0099/g, "'")
    .replace(/\u00E2\u0080\u0093/g, '–')
    .replace(/\u00E2\u0080\u0094/g, '—')
    .replace(/\u00E2\u0080\u009C/g, '"')
    .replace(/\u00E2\u0080\u009D/g, '"')
    .replace(/\u00C2\u00A0/g, ' ')
    .replace(/\u00C3[\u0080-\u00BF]/g, (m) => {
      const code = ((m.charCodeAt(0) & 0x1F) << 6) | (m.charCodeAt(1) & 0x3F);
      return String.fromCharCode(code);
    });
}

function extractBodyFromRaw(rawEmail) {
  // Find report URL
  let reportUrl = '';
  const linkMatch = rawEmail.match(/href=3D["']([^"']*research\.paretosec\.com[^"']*)["']/i);
  if (linkMatch) {
    reportUrl = linkMatch[1].replace(/=\r?\n/g, '').replace(/=3D/gi, '=');
  }
  if (!reportUrl) {
    const factsetMatch = rawEmail.match(/href=3D["']([^"']*parp\.hosting\.factset\.com[^"']*)["']/i);
    if (factsetMatch) {
      reportUrl = factsetMatch[1].replace(/=\r?\n/g, '').replace(/=3D/gi, '=');
    }
  }

  // Find HTML content
  let htmlContent = rawEmail;
  const htmlStart = rawEmail.search(/(?:<!DOCTYPE|<html|<table[^>]*cellspacing)/i);
  if (htmlStart > 0) htmlContent = rawEmail.substring(htmlStart);

  const bodyMatch = htmlContent.match(/<body[^>]*>(.*?)<\/body>/is);
  if (bodyMatch) htmlContent = bodyMatch[1];

  // Decode quoted-printable
  htmlContent = htmlContent
    .replace(/=\r?\n/g, '')
    .replace(/=3D/gi, '=')
    .replace(/=20/g, ' ')
    .replace(/=09/g, '\t')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  // Extract text
  let text = htmlContent
    .replace(/<style[^>]*>.*?<\/style>/gis, '')
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<head[^>]*>.*?<\/head>/gis, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#xa0;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9A-F]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\s\s+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n\n\n+/g, '\n\n')
    .trim();

  text = cleanText(text);
  text = text.substring(0, 30000);

  if (reportUrl) {
    text += `\n\nFull Report: ${reportUrl}`;
  }

  return text;
}

async function generateAISummary(bodyText, subject) {
  let cleanedText = bodyText
    .split(/This message is confidential/i)[0]
    .split(/Source:\s*Pareto Securities/i)[0]
    .split(/Analyst\(s\):/i)[0]
    .split(/Please refer to the specific research discla/i)[0]
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

Rules:
- Focus on market data, prices, trends, and sector dynamics
- Keep all numbers, percentages, and financial metrics
- Be thorough — capture ALL material information

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

Rules:
- Include company name and ticker prominently
- Keep all numbers, percentages, and financial metrics
- Be thorough — capture ALL material information from the report

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
  console.log('Re-importing truncated email bodies...\n');

  // 1. Find truncated docs
  const truncated = await pool.query(`
    SELECT id, email_message_id, subject, length(body_text) AS body_len
    FROM research_documents
    WHERE length(body_text) BETWEEN 1800 AND 2100
      AND email_message_id IS NOT NULL
    ORDER BY received_date DESC
  `);

  console.log(`Found ${truncated.rows.length} truncated documents to re-import\n`);
  if (truncated.rows.length === 0) {
    await pool.end();
    return;
  }

  // Build lookup of message IDs to re-import
  const toReimport = new Map();
  for (const row of truncated.rows) {
    toReimport.set(row.email_message_id, { id: row.id, subject: row.subject, bodyLen: row.body_len });
  }

  // 2. Connect to IMAP
  const imap = new ImapFlow({
    host: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.EMAIL_IMAP_PORT || '993'),
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
    logger: false
  });

  await imap.connect();
  console.log('Connected to IMAP\n');
  await imap.mailboxOpen('INBOX');

  // 3. Search for emails in the date range of truncated docs
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 90);

  const senders = [
    'noreply@research.paretosec.com',
    'noreply@xtrainvestor.com',
    'noreply@dnb.no',
  ];

  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (const sender of senders) {
    console.log(`Searching emails from ${sender}...`);
    const messages = imap.fetch({ since: sinceDate, from: sender }, {
      envelope: true,
      source: true,
    });

    for await (const message of messages) {
      const msgId = message.envelope.messageId;

      if (!toReimport.has(msgId)) continue;

      const doc = toReimport.get(msgId);
      console.log(`\nRe-importing: ${doc.subject.substring(0, 70)}...`);
      console.log(`  Old body: ${doc.bodyLen} chars`);

      try {
        const rawEmail = message.source.toString();
        const newBody = extractBodyFromRaw(rawEmail);

        if (!newBody || newBody.length <= doc.bodyLen) {
          console.log(`  Skipped — new body not longer (${newBody?.length || 0} chars)`);
          skipped++;
          continue;
        }

        console.log(`  New body: ${newBody.length} chars (+${newBody.length - doc.bodyLen})`);

        // Generate new AI summary with full text
        const summary = await generateAISummary(newBody, doc.subject);

        // Update database
        await pool.query(
          `UPDATE research_documents SET body_text = $1, ai_summary = $2, updated_at = NOW() WHERE id = $3`,
          [newBody, summary, doc.id]
        );

        console.log(`  ✓ Updated${summary ? ' + new AI summary' : ''}`);
        updated++;

        // Remove from map so we know what's left
        toReimport.delete(msgId);

        // Rate limit for AI
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.error(`  ✗ Error: ${err.message}`);
        failed++;
      }
    }
  }

  await imap.logout();
  await pool.end();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Not found in IMAP: ${toReimport.size}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
