/**
 * Import DNB Carnegie PDFs into Research Portal
 *
 * This script imports manually downloaded DNB Carnegie analyst reports:
 * 1. Reads PDFs from a specified folder
 * 2. Extracts text content from PDFs
 * 3. Generates AI summaries using Claude API
 * 4. Uploads to Supabase storage
 * 5. Creates research_documents and research_attachments records
 *
 * Usage:
 *   node scripts/import-dnb-pdfs.js [folder-path]
 *
 * Example:
 *   node scripts/import-dnb-pdfs.js ~/Documents/Intelligence_Equity_Research/code/Manuall_PDF_Analysis
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const pdf = require('pdf-parse');

// Database setup
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

// Supabase setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Claude API setup
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Extract ticker from filename or PDF content
 * Examples:
 *   "DNB_Carnegie_EQNR_05.01.2026.pdf" -> "EQNR"
 *   "DNB_Carnegie_05.01.2026.pdf" -> null (market report)
 */
function extractTicker(filename, content) {
  // Skip common broker/source names
  const excludeWords = ['DNB', 'CARNEGIE', 'MARKETS', 'ANALYSIS', 'WEEKLY', 'REPORT'];

  // Try filename first (common patterns)
  const filenamePatterns = [
    /_([A-Z]{3,5})_/,           // DNB_Carnegie_EQNR_date.pdf
    /-([A-Z]{3,5})-/,           // DNB-EQNR-date.pdf
    /\s([A-Z]{3,5})\s/,         // DNB EQNR date.pdf
    /^([A-Z]{3,5})_/,           // EQNR_analysis.pdf
  ];

  for (const pattern of filenamePatterns) {
    const match = filename.match(pattern);
    if (match) {
      const ticker = match[1].toUpperCase();
      // Skip if it's a broker name or generic term
      if (excludeWords.includes(ticker)) {
        continue;
      }
      // Validate it's a potential ticker
      if (ticker.length >= 3 && ticker.length <= 5) {
        return ticker;
      }
    }
  }

  // For market-wide reports, return null (no specific ticker)
  return null;
}

/**
 * Extract date from filename
 * Examples: "DNB_Carnegie_05.01.2026.pdf" -> "2026-01-05"
 */
function extractDate(filename) {
  // Pattern: DD.MM.YYYY or DD-MM-YYYY or DDMMYYYY
  const patterns = [
    /(\d{2})\.(\d{2})\.(\d{4})/,  // 05.01.2026
    /(\d{2})-(\d{2})-(\d{4})/,    // 05-01-2026
    /(\d{2})(\d{2})(\d{4})/,      // 05012026
    /(\d{4})-(\d{2})-(\d{2})/,    // 2026-01-05 (ISO)
  ];

  for (const pattern of patterns) {
    const match = filename.match(pattern);
    if (match) {
      // Check if it's ISO format (YYYY-MM-DD)
      if (match[1].length === 4) {
        return `${match[1]}-${match[2]}-${match[3]}`;
      }
      // Convert DD.MM.YYYY to YYYY-MM-DD
      const day = match[1];
      const month = match[2];
      const year = match[3];
      return `${year}-${month}-${day}`;
    }
  }

  // Default to today if no date found
  return new Date().toISOString().split('T')[0];
}

/**
 * Generate AI summary of PDF content
 */
async function generateSummary(pdfText, ticker) {
  // Different prompts for company-specific vs market-wide reports
  const isMarketReport = !ticker;

  const prompt = isMarketReport
    ? `You are analyzing a DNB Carnegie weekly market analysis report for Oslo Børs. Create a concise summary.

Format your response as follows:

**MARKET OVERVIEW:**
[2-3 sentences on overall market performance - Oslo Børs, sector trends, key indices]

**ANALYST HIGHLIGHTS:**
- [First key highlight or stock mention]
- [Second key highlight or stock mention]
- [Third key highlight or stock mention]

**OUTLOOK:**
[1-2 sentences on market outlook or key themes]

Keep it concise and focused on actionable information for Norwegian equity investors.

PDF Content (first 4000 chars):
${pdfText.substring(0, 4000)}`
    : `You are analyzing a DNB Carnegie company-specific analyst report. Extract and summarize the key information.

Format your response as follows:

**SUMMARY:**
[2-3 sentence overview of the main thesis/conclusion]

**KEY POINTS:**
- [First key point]
- [Second key point]
- [Third key point]

**RECOMMENDATION:**
[Buy/Hold/Sell and target price if mentioned]

Keep it concise and focused on actionable information for investors.

PDF Content (first 3000 chars):
${pdfText.substring(0, 3000)}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    return message.content[0].text;
  } catch (error) {
    console.error('  Claude API error:', error.message);
    return null;
  }
}

/**
 * Upload PDF to Supabase storage
 */
async function uploadPDF(filePath, documentId, filename) {
  const fileBuffer = fs.readFileSync(filePath);
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const storagePath = `${year}/${month}/${documentId}/${filename}`;

  const { data, error } = await supabase.storage
    .from('research-pdfs')
    .upload(storagePath, fileBuffer, {
      contentType: 'application/pdf',
      upsert: false
    });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  return storagePath;
}

/**
 * Process a single PDF file
 */
async function processPDF(filePath) {
  const filename = path.basename(filePath);
  console.log(`\nProcessing: ${filename}`);

  try {
    // Read and parse PDF
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdf(dataBuffer);
    const pdfText = pdfData.text;

    console.log(`  ✓ Extracted ${pdfText.length} characters from PDF`);

    // Extract metadata
    const ticker = extractTicker(filename, pdfText);
    const receivedDate = extractDate(filename);

    console.log(`  Ticker: ${ticker || 'Unknown'}`);
    console.log(`  Date: ${receivedDate}`);

    // Generate title from filename
    let title = filename
      .replace(/\.pdf$/i, '')
      .replace(/_/g, ' ')
      .replace(/DNB\s*Carnegie\s*/i, 'DNB Carnegie')
      .replace(/\d{2}\.\d{2}\.\d{4}/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // If title is empty or just the date, use generic title
    if (!title || title === 'DNB Carnegie' || title.length < 5) {
      title = `DNB Carnegie - Weekly Market Analysis`;
    }

    // Check if already imported (by filename)
    const existing = await pool.query(
      `SELECT id FROM research_documents
       WHERE source = 'DNB Carnegie'
       AND subject LIKE $1`,
      [`%${filename}%`]
    );

    if (existing.rows.length > 0) {
      console.log(`  ⚠️  Already imported, skipping`);
      return { success: false, reason: 'duplicate' };
    }

    // Generate AI summary
    console.log(`  Generating AI summary...`);
    const summary = await generateSummary(pdfText, ticker);

    if (!summary) {
      console.log(`  ⚠️  Summary generation failed, using truncated text`);
    }

    // Insert document record
    const docResult = await pool.query(
      `INSERT INTO research_documents (
        ticker, email_message_id, source, sender_email,
        subject, body_text, ai_summary, received_date,
        has_attachments, attachment_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        ticker,
        `dnb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // Unique ID
        'DNB Carnegie',
        'manual-import@dnb.no',
        title,
        pdfText.substring(0, 2000), // Store first 2000 chars
        summary || pdfText.substring(0, 1000),
        receivedDate,
        true,
        1
      ]
    );

    const documentId = docResult.rows[0].id;
    console.log(`  ✓ Created document: ${documentId}`);

    // Upload PDF to Supabase
    console.log(`  Uploading PDF to storage...`);
    const storagePath = await uploadPDF(filePath, documentId, filename);
    console.log(`  ✓ Uploaded to: ${storagePath}`);

    // Create attachment record
    const fileStats = fs.statSync(filePath);
    await pool.query(
      `INSERT INTO research_attachments (
        document_id, filename, content_type, file_size,
        file_path, extracted_text
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        documentId,
        filename,
        'application/pdf',
        fileStats.size,
        storagePath,
        pdfText.substring(0, 5000) // Store first 5000 chars
      ]
    );

    console.log(`  ✓ Import complete!`);

    return { success: true, documentId, ticker, date: receivedDate };
  } catch (error) {
    console.error(`  ✗ Error processing ${filename}:`, error.message);
    return { success: false, reason: error.message };
  }
}

/**
 * Main function
 */
async function main() {
  const folderPath = process.argv[2];

  if (!folderPath) {
    console.error('Usage: node scripts/import-dnb-pdfs.js <folder-path>');
    console.error('Example: node scripts/import-dnb-pdfs.js ~/Downloads/DNB_Reports');
    process.exit(1);
  }

  const absolutePath = path.resolve(folderPath);

  if (!fs.existsSync(absolutePath)) {
    console.error(`Error: Folder not found: ${absolutePath}`);
    process.exit(1);
  }

  console.log('╔════════════════════════════════════════════════╗');
  console.log('║      DNB Carnegie PDF Import Tool              ║');
  console.log('╚════════════════════════════════════════════════╝\n');
  console.log(`Scanning folder: ${absolutePath}\n`);

  // Find all PDF files
  const files = fs.readdirSync(absolutePath)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => path.join(absolutePath, f));

  if (files.length === 0) {
    console.log('No PDF files found in folder.');
    process.exit(0);
  }

  console.log(`Found ${files.length} PDF file(s)\n`);

  // Process each PDF
  const results = {
    success: 0,
    failed: 0,
    duplicates: 0
  };

  for (const file of files) {
    const result = await processPDF(file);

    if (result.success) {
      results.success++;
    } else if (result.reason === 'duplicate') {
      results.duplicates++;
    } else {
      results.failed++;
    }

    // Rate limiting - be nice to Claude API
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║              Import Summary                    ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`✓ Successfully imported: ${results.success}`);
  console.log(`⚠ Skipped (duplicates):  ${results.duplicates}`);
  console.log(`✗ Failed:                ${results.failed}`);
  console.log(`\nTotal processed:         ${files.length}\n`);

  await pool.end();
}

main().catch(console.error);
