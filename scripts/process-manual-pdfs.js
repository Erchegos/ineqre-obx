#!/usr/bin/env node
/**
 * Process manually uploaded PDFs from Manual_PDF_Analysis folder
 * - Extracts text from PDFs using pdf-parse
 * - Generates AI summary using Claude API
 * - Stores in database with same structure as email imports
 * - Makes PDFs downloadable on website
 */

require('dotenv').config();
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

// Database connection
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

// Supabase for file storage
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Claude API for summaries
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MANUAL_PDF_DIR = path.join(__dirname, '../../../code/Manual_PDF_Analysis');
const INDIVIDUAL_STOCKS_PARETO_DIR = path.join(MANUAL_PDF_DIR, 'Individual_Stocks_Pareto');
const INDIVIDUAL_STOCKS_DNB_DIR = path.join(MANUAL_PDF_DIR, 'Individual_Stocks_DNB_Carnegie');

/**
 * Extract ticker from filename
 * Examples:
 *   "Aker_update_15.01.2026.pdf" -> "AKERA" (need to map)
 *   "Storebrand_Q4_preview.pdf" -> "STB"
 */
function extractTickerFromFilename(filename) {
  // Remove .pdf extension
  const name = filename.replace(/\.pdf$/i, '');

  // Extract company name (before first underscore or dash)
  const companyMatch = name.match(/^([A-Za-z]+)/);
  if (!companyMatch) return null;

  const company = companyMatch[1].toLowerCase();

  // Map common company names to tickers (only OBX tickers)
  const tickerMap = {
    'entra': 'ENTRA',
    'frontline': 'FRO',
    'kongsberg': 'KOG',
    'norwegian': 'NAS',
    'storebrand': 'STB',
  };

  return tickerMap[company] || null;
}

/**
 * Extract date from filename
 * Examples: "15.01.2026", "2026-01-15", "Jan_15_2026"
 */
function extractDateFromFilename(filename) {
  // Try DD.MM.YYYY format
  const ddmmyyyyMatch = filename.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (ddmmyyyyMatch) {
    const [, day, month, year] = ddmmyyyyMatch;
    return new Date(`${year}-${month}-${day}`);
  }

  // Try YYYY-MM-DD format
  const yyyymmddMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (yyyymmddMatch) {
    return new Date(yyyymmddMatch[0]);
  }

  // Default to file modification time
  return null;
}

/**
 * Extract document type from filename
 */
function extractDocumentType(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('update')) return 'Update';
  if (lower.includes('preview') || lower.includes('quarterly')) return 'Quarterly Preview';
  if (lower.includes('review')) return 'Quarterly Review';
  if (lower.includes('newsflash')) return 'Newsflash';
  if (lower.includes('dnb') && lower.includes('carnegie')) return 'Weekly Market Commentary';
  return 'Research Report';
}

/**
 * Generate AI summary of PDF content using Claude
 */
async function generateSummary(pdfText, filename) {
  const prompt = `You are analyzing a financial research report. Please provide a concise summary (2-3 paragraphs) of the key points, including:

- Main thesis or recommendation
- Key financial metrics or estimates mentioned
- Important events, catalysts, or changes
- Target price or valuation if mentioned

Keep the summary professional and focused on actionable insights.

PDF filename: ${filename}

PDF content:
${pdfText.substring(0, 15000)}`; // Limit to ~15k chars to avoid token limits

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

/**
 * Save PDF to Supabase Storage
 */
async function saveToSupabaseStorage(buffer, relativePath) {
  const { data, error } = await supabase.storage
    .from('research-pdfs')
    .upload(relativePath, buffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  return data;
}

/**
 * Process a single PDF file
 */
async function processPdf(filepath, filename) {
  console.log(`\nProcessing: ${filename}`);

  try {
    // Read PDF file
    const dataBuffer = fs.readFileSync(filepath);

    // Extract text from PDF
    console.log('  Extracting text...');
    const pdfData = await pdf(dataBuffer);
    const pdfText = pdfData.text;

    if (!pdfText || pdfText.length < 100) {
      console.log('  ⚠️  PDF appears empty or text extraction failed');
      return;
    }

    console.log(`  ✓ Extracted ${pdfText.length} characters`);

    // Extract metadata from filename
    const ticker = extractTickerFromFilename(filename);
    const documentDate = extractDateFromFilename(filename) || new Date(fs.statSync(filepath).mtime);
    const documentType = extractDocumentType(filename);

    // Generate subject line
    const subject = filename
      .replace(/\.pdf$/i, '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    console.log(`  Ticker: ${ticker || 'N/A'}`);
    console.log(`  Date: ${documentDate.toISOString().slice(0, 10)}`);
    console.log(`  Type: ${documentType}`);

    // Check if document already exists
    const existing = await pool.query(
      `SELECT id FROM research_documents
       WHERE subject = $1 AND received_date::date = $2`,
      [subject, documentDate]
    );

    if (existing.rows.length > 0) {
      console.log('  ⚠️  Document already exists, skipping');
      return;
    }

    // Generate AI summary
    console.log('  Generating AI summary...');
    const aiSummary = await generateSummary(pdfText, filename);

    if (aiSummary) {
      console.log(`  ✓ Generated summary (${aiSummary.length} chars)`);
    }

    // Truncate PDF text for body_text (keep first ~3000 chars)
    const bodyText = pdfText.substring(0, 3000);

    // Verify ticker exists in database if provided
    if (ticker) {
      const tickerCheck = await pool.query(
        `SELECT ticker FROM stocks WHERE ticker = $1`,
        [ticker]
      );

      if (tickerCheck.rows.length === 0) {
        console.log(`  ⚠️  Ticker ${ticker} not in database, setting to NULL`);
        ticker = null;
      }
    }

    // Insert document record
    const docResult = await pool.query(
      `INSERT INTO research_documents (
        ticker, source, sender_email, subject, body_text, ai_summary,
        received_date, document_type, email_message_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        ticker,
        'Manual Upload',
        'manual@upload.local',  // Placeholder email
        subject,
        bodyText,
        aiSummary,
        documentDate,
        documentType,
        `manual-${Date.now()}-${Math.random().toString(36).substring(7)}`  // Unique ID
      ]
    );

    const documentId = docResult.rows[0].id;
    console.log(`  ✓ Created document ${documentId}`);

    // Upload PDF to Supabase Storage
    const year = documentDate.getFullYear();
    const month = String(documentDate.getMonth() + 1).padStart(2, '0');
    const relativePath = `${year}/${month}/${documentId}/${filename}`;

    console.log('  Uploading to Supabase...');
    await saveToSupabaseStorage(dataBuffer, relativePath);
    console.log('  ✓ Uploaded to Supabase');

    // Create attachment record
    await pool.query(
      `INSERT INTO research_attachments (
        document_id, filename, content_type, file_size, file_path
      ) VALUES ($1, $2, $3, $4, $5)`,
      [documentId, filename, 'application/pdf', dataBuffer.length, relativePath]
    );

    // Update attachment count
    await pool.query(
      `UPDATE research_documents
       SET attachment_count = 1, has_attachments = true
       WHERE id = $1`,
      [documentId]
    );

    console.log(`  ✓ Complete!`);

  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('Processing manual PDFs from Manual_PDF_Analysis folder...\n');

  // Check if manual PDF directory exists
  if (!fs.existsSync(MANUAL_PDF_DIR)) {
    console.error(`❌ Manual PDF directory not found: ${MANUAL_PDF_DIR}`);
    process.exit(1);
  }

  let totalProcessed = 0;

  // Process DNB Carnegie weekly reports (in root folder)
  console.log('='.repeat(80));
  console.log('Processing DNB Carnegie Weekly Reports');
  console.log('='.repeat(80));

  const rootFiles = fs.readdirSync(MANUAL_PDF_DIR)
    .filter(f => f.endsWith('.pdf') && f.includes('DNB_Carnegie'));

  for (const file of rootFiles) {
    await processPdf(path.join(MANUAL_PDF_DIR, file), file);
    totalProcessed++;
  }

  // Process Pareto individual stock reports
  if (fs.existsSync(INDIVIDUAL_STOCKS_PARETO_DIR)) {
    console.log('\n' + '='.repeat(80));
    console.log('Processing Pareto Individual Stock Reports');
    console.log('='.repeat(80));

    const paretoFiles = fs.readdirSync(INDIVIDUAL_STOCKS_PARETO_DIR)
      .filter(f => f.endsWith('.pdf'));

    for (const file of paretoFiles) {
      await processPdf(path.join(INDIVIDUAL_STOCKS_PARETO_DIR, file), file);
      totalProcessed++;
    }
  }

  // Process DNB Carnegie individual stock reports
  if (fs.existsSync(INDIVIDUAL_STOCKS_DNB_DIR)) {
    console.log('\n' + '='.repeat(80));
    console.log('Processing DNB Carnegie Individual Stock Reports');
    console.log('='.repeat(80));

    const dnbFiles = fs.readdirSync(INDIVIDUAL_STOCKS_DNB_DIR)
      .filter(f => f.endsWith('.pdf'));

    for (const file of dnbFiles) {
      await processPdf(path.join(INDIVIDUAL_STOCKS_DNB_DIR, file), file);
      totalProcessed++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total PDFs processed: ${totalProcessed}`);
  console.log('');

  await pool.end();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
