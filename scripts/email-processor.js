/**
 * Email Processor for Research Portal
 *
 * This script monitors your email inbox for research emails from multiple sources
 * (Pareto Securities, Xtrainvestor, DNB Markets, etc.) and automatically imports
 * them into the research portal database.
 *
 * Setup:
 * 1. npm install imapflow pg dotenv
 * 2. Create .env file with EMAIL_USER, EMAIL_PASSWORD, DATABASE_URL
 * 3. Run: node scripts/email-processor.js
 * 4. Or schedule with cron for automatic processing
 */

require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

// Strip sslmode parameter from connection string to avoid conflicts
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

// Initialize Supabase client for storage
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Claude API for content cleaning
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Configuration
const CONFIG = {
  // Email settings
  email: {
    host: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.EMAIL_IMAP_PORT || '993'),
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  },

  // Filter for research emails
  senderFilters: [
    'noreply@research.paretosec.com',
    'research@pareto.no',
    'info@xtrainvestor.com',
    // Add more senders as needed
  ],

  // Local storage directory (relative to project root)
  storageDir: process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage', 'research'),

  // Processing limits
  batchSize: 500, // Process max 500 emails per run
  maxAttachmentSize: 50 * 1024 * 1024, // 50 MB
};

// Ensure storage directory exists
if (!fs.existsSync(CONFIG.storageDir)) {
  fs.mkdirSync(CONFIG.storageDir, { recursive: true });
}

/**
 * Extract ticker from email subject
 * Examples:
 *   "BAKKA: Q4 Results" -> "BAKKA"
 *   "Update on NHY" -> "NHY"
 */
function extractTicker(subject) {
  // Pattern 1: "TICKER: ..."
  let match = subject.match(/^([A-Z]{3,5}):/);
  if (match) return match[1];

  // Pattern 2: "... on TICKER ..."
  match = subject.match(/\bon\s+([A-Z]{3,5})\b/);
  if (match) return match[1];

  // Pattern 3: Any 3-5 uppercase letters in brackets
  match = subject.match(/\(([A-Z]{3,5})\)/);
  if (match) return match[1];

  return null;
}

/**
 * Identify source from sender email
 */
function identifySource(email) {
  if (email.includes('pareto')) return 'Pareto Securities';
  if (email.includes('xtrainvestor')) return 'Xtrainvestor';
  if (email.includes('dnb')) return 'DNB Markets';
  if (email.includes('abg')) return 'ABG Sundal Collier';
  return 'Unknown';
}

/**
 * Clean text to remove encoding artifacts and fix mojibake
 */
function cleanText(text) {
  if (!text) return '';

  return text
    // Fix common UTF-8 mojibake patterns (double-encoded UTF-8)
    .replace(/â€¢/g, '\u2022')  // bullet point
    .replace(/â€"/g, '\u2013')  // en dash
    .replace(/â€"/g, '\u2014')  // em dash
    .replace(/â€˜/g, '\u2018')  // left single quote
    .replace(/â€™/g, '\u2019')  // right single quote/apostrophe
    .replace(/â€œ/g, '\u201C')  // left double quote
    .replace(/â€/g, '\u201D')   // right double quote
    .replace(/â‚¬/g, '\u20AC')  // euro sign
    .replace(/Â£/g, '\u00A3')   // pound sign
    .replace(/Â /g, ' ')   // non-breaking space
    .replace(/Ã¸/g, '\u00F8')  // o with stroke (Norwegian)
    .replace(/Ã¥/g, '\u00E5')  // a with ring (Norwegian)
    .replace(/Ã¦/g, '\u00E6')  // ae ligature (Norwegian)
    .replace(/Ã˜/g, '\u00D8')  // O with stroke
    .replace(/Ã…/g, '\u00C5')  // A with ring
    .replace(/Ã†/g, '\u00C6')  // AE ligature
    .replace(/â€¦/g, '...')  // ellipsis
    .replace(/Â°/g, '\u00B0')   // degree symbol
    .replace(/Â±/g, '\u00B1')   // plus-minus
    // Remove any remaining control characters and weird symbols
    .replace(/[^\x20-\x7E\u00A0-\u00FF\u0100-\u017F\u2018-\u201F\u2022\u2013\u2014]/g, '')
    // Normalize whitespace
    .replace(/\s\s+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n\n\n+/g, '\n\n')
    .trim();
}

/**
 * Clean and format Xtrainvestor content using Claude API
 */
async function cleanXtrainvestorContent(rawContent) {
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
    console.error('  Claude API cleaning failed:', error.message);
    return rawContent; // Return original if cleaning fails
  }
}

/**
 * Generate AI summary for research document
 */
async function generateAISummary(bodyText, subject) {
  // Clean body text before sending to Claude
  let cleanedText = bodyText
    .split(/This message is confidential/i)[0]
    .split(/Source:\s*Pareto Securities/i)[0]
    .split(/Analyst\(s\):/i)[0]
    .split(/Please refer to the specific research discla/i)[0]
    .split(/\n*Full Report:/i)[0];

  // Remove email addresses and phone numbers
  cleanedText = cleanedText
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
    .replace(/\+\d{2}\s*\d{2}\s*\d{2}\s*\d{2}\s*\d{2}/g, '');

  // Remove "CLICK HERE" buttons
  cleanedText = cleanedText.replace(/CLICK HERE FOR THE FULL REPORT/gi, '');
  cleanedText = cleanedText.replace(/Click to open report/gi, '');
  cleanedText = cleanedText.trim();

  if (!cleanedText || cleanedText.length < 100) {
    console.log('  ⚠️  Body text too short, skipping AI summary');
    return null;
  }

  // Detect report type for prompt selection
  const isBorsXtra = /børsxtra|borsxtra/i.test(subject);
  const isSectorUpdate = !isBorsXtra && /seafood|energy daily|fig weekly|morning comment|high yield|shipping daily|price update|weekly market|market analysis|oil\s*&\s*gas\s*-/i.test(subject);

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
    console.error(`  ❌ Claude API error: ${error.message}`);
    return null;
  }
}

/**
 * Save file to Supabase Storage
 */
async function saveToSupabaseStorage(content, relativePath) {
  try {
    const { data, error } = await supabase.storage
      .from('research-pdfs')
      .upload(relativePath, content, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (error) {
      throw error;
    }

    return relativePath;
  } catch (error) {
    console.error(`Failed to upload to Supabase Storage: ${error.message}`);

    // Fallback to local storage
    const fullPath = path.join(CONFIG.storageDir, relativePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content);
    console.log(`  Saved to local storage as fallback: ${relativePath}`);
    return relativePath;
  }
}

/**
 * Process a single email message
 */
async function processEmail(message, imap) {
  try {
    const { envelope, bodyStructure, uid } = message;

    // Check if already processed (using Message-ID)
    const messageId = envelope.messageId;
    const existing = await pool.query(
      'SELECT id FROM research_documents WHERE email_message_id = $1',
      [messageId]
    );

    if (existing.rows.length > 0) {
      console.log(`Skipping already processed email: ${messageId}`);
      return;
    }

    // Extract metadata
    const sender = envelope.from[0].address;
    const subject = envelope.subject || '(No Subject)';
    const ticker = extractTicker(subject);
    const source = identifySource(sender);
    const receivedDate = envelope.date;

    console.log(`Processing: ${subject} from ${sender}`);

    // Extract body text from raw email source (much more reliable!)
    let bodyText = '';
    let reportUrl = '';
    try {
      if (message.source) {
        const rawEmail = message.source.toString('utf-8');

        // Extract report link - try multiple patterns

        // Method 1: FactSet hosting link (quoted-printable encoded)
        const factsetMatch = rawEmail.match(/href=3D["']([^"']*parp\.hosting\.factset\.com[^"']*)["']/i);
        if (factsetMatch) {
          // Decode the quoted-printable URL
          reportUrl = factsetMatch[1]
            .replace(/=\r?\n/g, '')  // Remove soft line breaks
            .replace(/=3D/gi, '=')
            .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
        }

        // Method 2: Direct research.paretosec.com link
        if (!reportUrl) {
          const directMatch = rawEmail.match(/href=["']([^"']*research\.paretosec\.com[^"']*)["']/i);
          if (directMatch) reportUrl = directMatch[1];
        }

        // Find actual HTML content - look for <!DOCTYPE or <html or <table (Pareto emails)
        let htmlContent = rawEmail;
        const htmlStart = rawEmail.search(/(?:<!DOCTYPE|<html|<table[^>]*cellspacing)/i);
        if (htmlStart > 0) {
          htmlContent = rawEmail.substring(htmlStart);
        }

        // Try to extract body tags if they exist
        const bodyMatch = htmlContent.match(/<body[^>]*>(.*?)<\/body>/is);
        if (bodyMatch) {
          htmlContent = bodyMatch[1];
        }

        // Decode quoted-printable encoding (=20 -> space, =3D -> =, etc.)
        htmlContent = htmlContent
          .replace(/=\r?\n/g, '')  // Remove soft line breaks
          .replace(/=3D/gi, '=')
          .replace(/=20/g, ' ')
          .replace(/=09/g, '\t')
          .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));

        // Extract text from HTML
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
          .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(parseInt(dec, 10)))
          .replace(/&#x([0-9A-F]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/\s\s+/g, ' ')
          .replace(/\n\s+/g, '\n')
          .replace(/\n\n\n+/g, '\n\n')
          .trim();

        // Clean up encoding artifacts
        text = cleanText(text);

        // Truncate text first to leave room for link
        text = text.substring(0, 1850);

        // Append report URL (max ~150 chars for link)
        if (reportUrl) {
          text += `\n\nFull Report: ${reportUrl}`;
          console.log(`  Report: ${reportUrl.substring(0, 50)}...`);
        }

        bodyText = text;

        if (bodyText.length > 100) {
          console.log(`  Body: ${bodyText.length} chars`);
        }
      }
    } catch (err) {
      console.log(`  Body extraction failed: ${err.message}`);
    }

    // Clean Xtrainvestor content using Claude API
    if (source === 'Xtrainvestor' && bodyText && bodyText.length > 100) {
      try {
        console.log(`  Cleaning with Claude API...`);
        const cleanedText = await cleanXtrainvestorContent(bodyText);
        if (cleanedText && cleanedText.length > 50) {
          bodyText = cleanedText;
          console.log(`  ✓ Cleaned (${cleanedText.length} chars)`);
        }
      } catch (err) {
        console.log(`  Claude cleaning failed: ${err.message}`);
      }
    }

    // Generate AI summary
    let aiSummary = null;
    if (bodyText && bodyText.length > 100) {
      console.log(`  Generating AI summary...`);
      aiSummary = await generateAISummary(bodyText, subject);
      if (aiSummary) {
        console.log(`  ✓ AI summary generated (${aiSummary.length} chars)`);
      }
    }

    // Insert document record
    const docResult = await pool.query(
      `INSERT INTO research_documents (
        ticker, email_message_id, source, sender_email,
        subject, body_text, ai_summary, received_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [ticker, messageId, source, sender, subject, bodyText, aiSummary, receivedDate]
    );

    const documentId = docResult.rows[0].id;

    // Process attachments
    const attachments = findAttachments(bodyStructure);
    let attachmentCount = 0;

    for (const att of attachments) {
      try {
        // Download attachment
        const content = await imap.download(uid, att.part);

        // Skip if too large
        if (content.length > CONFIG.maxAttachmentSize) {
          console.log(`  Skipping large attachment: ${att.filename} (${content.length} bytes)`);
          continue;
        }

        // Generate file path
        const now = new Date();
        const relativePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${documentId}/${att.filename}`;

        // Save to Supabase Storage
        await saveToSupabaseStorage(content, relativePath);

        // Save attachment record
        await pool.query(
          `INSERT INTO research_attachments (
            document_id, filename, content_type, file_size, file_path
          ) VALUES ($1, $2, $3, $4, $5)`,
          [documentId, att.filename, att.contentType, content.length, relativePath]
        );

        attachmentCount++;
        console.log(`  ✓ Saved attachment to Supabase: ${att.filename}`);
      } catch (err) {
        console.error(`  Error processing attachment ${att.filename}:`, err.message);
      }
    }

    // Download PDF from report URL if available
    if (reportUrl) {
      try {
        console.log(`  Downloading PDF from: ${reportUrl.substring(0, 60)}...`);

        const https = require('https');
        const http = require('http');

        // Use node-fetch or native fetch to download the PDF
        const response = await (async () => {
          try {
            // Try using node-fetch if available
            const nodeFetch = require('node-fetch');
            return await nodeFetch(reportUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              },
              timeout: 30000,
            });
          } catch (e) {
            // Fallback: manual HTTPS request
            return new Promise((resolve, reject) => {
              const url = new URL(reportUrl);
              const options = {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: 'GET',
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                },
              };

              const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                  resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    statusCode: res.statusCode,
                    buffer: () => Promise.resolve(Buffer.concat(chunks)),
                  });
                });
              });
              req.on('error', reject);
              req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Timeout'));
              });
              req.end();
            });
          }
        })();

        if (response.ok || response.statusCode === 200) {
          const pdfBuffer = await response.buffer();

          // Generate filename
          const cleanSubject = subject.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
          const filename = `${ticker || 'report'}_${cleanSubject}.pdf`;

          // Generate file path
          const now = new Date();
          const relativePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${documentId}/${filename}`;

          // Save to Supabase Storage
          await saveToSupabaseStorage(pdfBuffer, relativePath);

          // Save as attachment record
          await pool.query(
            `INSERT INTO research_attachments (
              document_id, filename, content_type, file_size, file_path
            ) VALUES ($1, $2, $3, $4, $5)`,
            [documentId, filename, 'application/pdf', pdfBuffer.length, relativePath]
          );

          attachmentCount++;
          console.log(`  ✓ Downloaded and saved PDF to Supabase: ${filename} (${Math.round(pdfBuffer.length / 1024)}KB)`);
        } else {
          console.log(`  ⚠ PDF download failed: HTTP ${response.statusCode || response.status}`);
        }
      } catch (pdfError) {
        console.log(`  ⚠ PDF download error: ${pdfError.message}`);
        // Continue processing - PDF download is optional
      }
    }

    // Update document with attachment count
    await pool.query(
      `UPDATE research_documents
       SET attachment_count = $1, has_attachments = $2
       WHERE id = $3`,
      [attachmentCount, attachmentCount > 0, documentId]
    );

    console.log(`✓ Processed document ${documentId} with ${attachmentCount} attachments`);
  } catch (error) {
    console.error('Error processing email:', error);
  }
}

/**
 * Find attachments in email structure
 */
function findAttachments(structure, attachments = []) {
  if (structure.disposition === 'attachment' && structure.parameters?.name) {
    attachments.push({
      filename: structure.parameters.name,
      contentType: structure.type || 'application/octet-stream',
      part: structure.part,
    });
  }

  if (structure.childNodes) {
    structure.childNodes.forEach((child) => findAttachments(child, attachments));
  }

  return attachments;
}

/**
 * Main processing function
 */
async function main() {
  const imap = new ImapFlow(CONFIG.email);

  try {
    console.log('Connecting to email server...');
    await imap.connect();
    console.log('Connected!');

    // Select inbox
    await imap.mailboxOpen('INBOX');

    // Search last 3 days to avoid hitting the batch limit with old emails
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - 3);
    console.log(`Searching for research emails since ${sinceDate.toISOString().split('T')[0]}...`);
    let processed = 0;
    let totalCount = 0;

    // Search for each sender separately (IMAP limitation)
    for (const sender of CONFIG.senderFilters) {
      const searchCriteria = {
        since: sinceDate,
        from: sender
      };

      console.log(`\nSearching for emails from ${sender}...`);
      const messages = imap.fetch(searchCriteria, {
        envelope: true,
        bodyStructure: true,
        source: true,  // Fetch raw email source for reliable body extraction
        uid: true,
      });

      let count = 0;
      for await (const message of messages) {
        count++;
        totalCount++;

        await processEmail(message, imap);
        processed++;

        if (processed >= CONFIG.batchSize) {
          console.log(`Reached batch limit of ${CONFIG.batchSize}`);
          break;
        }
      }

      console.log(`  Found ${count} emails from ${sender}`);

      if (processed >= CONFIG.batchSize) {
        break;
      }
    }

    if (processed === 0) {
      console.log(`\nNo research emails found from 2026 (checked ${totalCount} messages)`);
    } else {
      console.log(`\n✓ Processed ${processed} research emails from 2026 (out of ${totalCount} total messages)`);
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await imap.logout();
    await pool.end();
  }
}

// Run the processor
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
