/**
 * Gmail API PDF Downloader for Pareto Research
 *
 * This script uses Gmail API to download PDF attachments from research emails
 * and saves them to Supabase Storage.
 *
 * Setup:
 * 1. Enable Gmail API in Google Cloud Console
 * 2. Create OAuth 2.0 credentials (Desktop app)
 * 3. Download credentials.json and save as gmail-credentials.json
 * 4. Run this script - it will open browser for authorization
 * 5. Access token will be saved for future use
 *
 * Setup:
 * 1. Enable Gmail API: https://console.cloud.google.com/apis/library/gmail.googleapis.com
 * 2. Create OAuth credentials: https://console.cloud.google.com/apis/credentials
 * 3. Download credentials.json and place in project root
 * 4. Run this script - it will open browser for one-time auth
 * 5. Script downloads all PDFs automatically
 */

require('dotenv').config();
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const https = require('https');
const http = require('http');

// Supabase setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Database setup
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

const CONFIG = {
  storageDir: process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage', 'research'),
  credentialsPath: path.join(__dirname, '..', 'gmail-credentials.json'),
  tokenPath: path.join(__dirname, '..', 'gmail-token.json'),
  // GitHub Actions mode - use environment variables
  useEnvCredentials: !!process.env.GMAIL_CREDENTIALS,
};

// Ensure storage directory exists
if (!fs.existsSync(CONFIG.storageDir)) {
  fs.mkdirSync(CONFIG.storageDir, { recursive: true });
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

    if (error) throw error;
    return relativePath;
  } catch (error) {
    console.error(`  Failed to upload to Supabase Storage: ${error.message}`);

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
 * Download PDF from URL - simple fetch approach
 * FactSet links should work without special authentication if accessed quickly
 */
async function downloadPDF(reportUrl) {
  try {
    const response = await fetch(reportUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/pdf,*/*',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      console.log(`  HTTP ${response.status}: ${response.statusText}`);
      return {
        statusCode: response.status,
        buffer: Buffer.alloc(0)
      };
    }

    const buffer = await response.arrayBuffer();
    const pdfBuffer = Buffer.from(buffer);

    // Check if it's actually a PDF
    if (pdfBuffer.length > 4 && pdfBuffer.toString('utf8', 0, 4) === '%PDF') {
      return {
        statusCode: 200,
        buffer: pdfBuffer
      };
    } else {
      console.log(`  Response is not a PDF (starts with: ${pdfBuffer.toString('utf8', 0, 20)})`);
      return {
        statusCode: 500,
        buffer: Buffer.alloc(0)
      };
    }
  } catch (error) {
    console.log(`  Download error: ${error.message}`);
    return {
      statusCode: 500,
      buffer: Buffer.alloc(0)
    };
  }
}

/**
 * Authorize Gmail API
 */
async function authorize() {
  // GitHub Actions mode - use environment variables
  if (CONFIG.useEnvCredentials) {
    const credentials = JSON.parse(process.env.GMAIL_CREDENTIALS);
    const token = JSON.parse(process.env.GMAIL_TOKEN);
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  }

  // Local mode - use files
  const credentials = JSON.parse(fs.readFileSync(CONFIG.credentialsPath));
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token
  if (fs.existsSync(CONFIG.tokenPath)) {
    const token = JSON.parse(fs.readFileSync(CONFIG.tokenPath));
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  }

  // Get new token
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  });

  console.log('\nAuthorize this app by visiting this URL:');
  console.log(authUrl);
  console.log('\nEnter the code from that page here: ');

  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    readline.question('Code: ', async (code) => {
      readline.close();
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);
      fs.writeFileSync(CONFIG.tokenPath, JSON.stringify(tokens));
      console.log('Token stored to', CONFIG.tokenPath);
      resolve(oAuth2Client);
    });
  });
}

/**
 * Get Gmail messages
 */
async function getMessages(auth) {
  const gmail = google.gmail({ version: 'v1', auth });

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: 'from:noreply@research.paretosec.com after:2026/01/01',
    maxResults: 500,
  });

  return response.data.messages || [];
}

/**
 * Get message details
 */
async function getMessage(auth, messageId) {
  const gmail = google.gmail({ version: 'v1', auth });

  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  return response.data;
}

/**
 * Extract PDF URL from message
 */
function extractPdfUrl(message) {
  // Get HTML body
  let htmlBody = '';

  function getPart(parts) {
    if (!parts) return;
    for (const part of parts) {
      if (part.mimeType === 'text/html' && part.body.data) {
        htmlBody = Buffer.from(part.body.data, 'base64').toString('utf-8');
        return;
      }
      if (part.parts) {
        getPart(part.parts);
      }
    }
  }

  getPart([message.payload]);

  // Extract FactSet link
  const match = htmlBody.match(/href=["']([^"']*parp\.hosting\.factset\.com[^"']*)["']/i);
  if (match) {
    return match[1].replace(/&amp;/g, '&');
  }

  return null;
}

/**
 * Main function
 */
async function main() {
  console.log('Gmail PDF Downloader\n');

  // Check for credentials (only in local mode)
  if (!CONFIG.useEnvCredentials && !fs.existsSync(CONFIG.credentialsPath)) {
    console.error('Error: gmail-credentials.json not found!');
    console.log('\nPlease follow these steps:');
    console.log('1. Go to: https://console.cloud.google.com/apis/credentials');
    console.log('2. Create OAuth 2.0 credentials');
    console.log('3. Download as gmail-credentials.json');
    console.log('4. Place it in the project root');
    process.exit(1);
  }

  // Get documents without PDFs
  const docsResult = await pool.query(`
    SELECT id, subject, ticker, email_message_id, received_date
    FROM research_documents
    WHERE (attachment_count = 0 OR attachment_count IS NULL)
      AND source = 'Pareto Securities'
      AND received_date >= CURRENT_DATE - INTERVAL '7 days'
    ORDER BY received_date DESC
    LIMIT 50
  `);

  console.log(`Found ${docsResult.rows.length} documents without PDFs\n`);

  if (docsResult.rows.length === 0) {
    console.log('All documents already have PDFs!');
    await pool.end();
    return;
  }

  // Authorize
  console.log('Authorizing Gmail API...');
  const auth = await authorize();
  console.log('✓ Authorized\n');

  // Get messages
  console.log('Fetching Gmail messages...');
  const messages = await getMessages(auth);
  console.log(`✓ Found ${messages.length} messages\n`);

  let successCount = 0;
  let failCount = 0;

  // Process each document
  for (const doc of docsResult.rows) {
    try {
      console.log(`\nProcessing: ${doc.subject.substring(0, 60)}...`);

      // Find Gmail message by Message-ID
      const searchQuery = `rfc822msgid:${doc.email_message_id}`;

      const gmail = google.gmail({ version: 'v1', auth });
      const searchResponse = await gmail.users.messages.list({
        userId: 'me',
        q: searchQuery,
      });

      if (!searchResponse.data.messages || searchResponse.data.messages.length === 0) {
        console.log(`  ✗ Email not found in Gmail`);
        failCount++;
        continue;
      }

      const messageId = searchResponse.data.messages[0].id;

      // Get full message with raw content
      const fullMessage = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'raw',
      });

      // Decode the raw message
      const rawEmail = Buffer.from(fullMessage.data.raw, 'base64url').toString('utf-8');

      // Extract PDF URL from email body
      let pdfUrl = null;

      // Method 1: FactSet hosting link (quoted-printable encoded with line breaks)
      // The URL spans multiple lines with = at the end of each line
      const factsetMatch = rawEmail.match(/href=3D["']([^"']*parp\.hosting[^"']{0,2000})["']/i);
      if (factsetMatch) {
        // Decode the quoted-printable URL
        // Order matters: remove line breaks, decode hex, THEN decode =3D
        pdfUrl = factsetMatch[1]
          .replace(/=\r?\n/g, '')  // Remove soft line breaks (= at end of line)
          .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16))) // Decode =XX to chars
          .replace(/=3D/gi, '=');   // Finally convert remaining =3D to =

        console.log(`  Decoded URL length: ${pdfUrl.length} chars`);
      }

      // Method 2: Direct research.paretosec.com link
      if (!pdfUrl) {
        const directMatch = rawEmail.match(/href=["']([^"']*research\.paretosec\.com[^"']*)["']/i);
        if (directMatch) pdfUrl = directMatch[1];
      }

      // Method 3: Plain FactSet URL
      if (!pdfUrl) {
        const plainMatch = rawEmail.match(/https:\/\/parp\.hosting\.factset\.com[^\s"'<>]+/i);
        if (plainMatch) pdfUrl = plainMatch[0];
      }

      if (!pdfUrl) {
        console.log(`  ✗ No PDF URL found in email`);
        failCount++;
        continue;
      }

      console.log(`  Found URL: ${pdfUrl.substring(0, 60)}...`);
      console.log(`  Downloading PDF...`);

      // Download PDF from URL
      const response = await downloadPDF(pdfUrl);

      if (response.statusCode === 200 && response.buffer.length > 1000) {
        const cleanSubject = doc.subject.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        const filename = `${doc.ticker || 'report'}_${cleanSubject}.pdf`;

        const receivedDate = new Date(doc.received_date);
        const relativePath = `${receivedDate.getFullYear()}/${String(receivedDate.getMonth() + 1).padStart(2, '0')}/${doc.id}/${filename}`;

        await saveToSupabaseStorage(response.buffer, relativePath);
        console.log(`  ✓ Uploaded to Supabase: ${relativePath}`);

        await pool.query(
          `INSERT INTO research_attachments (
            document_id, filename, content_type, file_size, file_path
          ) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT DO NOTHING`,
          [doc.id, filename, 'application/pdf', response.buffer.length, relativePath]
        );

        await pool.query(
          `UPDATE research_documents
           SET attachment_count = (SELECT COUNT(*) FROM research_attachments WHERE document_id = $1),
               has_attachments = true
           WHERE id = $1`,
          [doc.id]
        );

        console.log(`  ✓ Success: ${Math.round(response.buffer.length / 1024)}KB`);
        successCount++;
      } else {
        console.log(`  ✗ Failed: HTTP ${response.statusCode}`);
        failCount++;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.log(`  ✗ Error: ${error.message}`);
      failCount++;
    }
  }

  console.log(`\n\n=== Results ===`);
  console.log(`✓ Downloaded: ${successCount}`);
  console.log(`✗ Failed: ${failCount}`);

  await pool.end();
}

main().catch(console.error);
