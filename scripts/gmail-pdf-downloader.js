/**
 * Gmail API PDF Downloader
 *
 * Downloads PDFs directly from Gmail using OAuth authentication.
 * This bypasses the browser automation issues.
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
};

// Ensure storage directory exists
if (!fs.existsSync(CONFIG.storageDir)) {
  fs.mkdirSync(CONFIG.storageDir, { recursive: true });
}

/**
 * Save file to local storage and Supabase
 */
async function saveToStorage(content, relativePath) {
  // Save to local storage (for backup)
  const fullPath = path.join(CONFIG.storageDir, relativePath);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(fullPath, content);

  // Upload to Supabase Storage
  const { error } = await supabase.storage
    .from('research-pdfs')
    .upload(relativePath, content, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) {
    console.log(`    Warning: Failed to upload to Supabase: ${error.message}`);
  }

  return relativePath;
}

/**
 * Download PDF from URL
 */
async function downloadPDF(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/pdf,*/*',
      }
    };

    const req = client.request(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadPDF(res.headers.location).then(resolve).catch(reject);
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        buffer: Buffer.concat(chunks)
      }));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.end();
  });
}

/**
 * Authorize Gmail API
 */
async function authorize() {
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

  // Check for credentials
  if (!fs.existsSync(CONFIG.credentialsPath)) {
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
    SELECT d.id, d.subject, d.ticker, d.email_message_id
    FROM research_documents d
    LEFT JOIN research_attachments a ON d.id = a.document_id AND a.content_type = 'application/pdf'
    WHERE a.id IS NULL
      AND d.source = 'Pareto Securities'
      AND d.received_date >= '2026-01-01'
    ORDER BY d.received_date DESC
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

  // Process each message
  for (const msg of messages) { // Process all messages
    try {
      const fullMessage = await getMessage(auth, msg.id);

      // Get subject
      const subjectHeader = fullMessage.payload.headers.find(h => h.name === 'Subject');
      const subject = subjectHeader ? subjectHeader.value : 'Unknown';

      // Find matching document
      const doc = docsResult.rows.find(d =>
        subject.toLowerCase().includes(d.subject.toLowerCase().substring(0, 30))
      );

      if (!doc) {
        console.log(`Skipping: ${subject.substring(0, 60)}... (no match in DB)`);
        continue;
      }

      console.log(`\nProcessing: ${subject.substring(0, 60)}...`);

      // Extract PDF URL
      const pdfUrl = extractPdfUrl(fullMessage);

      if (!pdfUrl) {
        console.log('  ✗ No PDF link found');
        failCount++;
        continue;
      }

      console.log(`  Downloading from: ${pdfUrl.substring(0, 60)}...`);

      // Download PDF
      const response = await downloadPDF(pdfUrl);

      if (response.statusCode === 200 && response.buffer.length > 1000) {
        const cleanSubject = doc.subject.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        const filename = `${doc.ticker || 'report'}_${cleanSubject}.pdf`;

        const now = new Date();
        const relativePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${doc.id}/${filename}`;

        await saveToStorage(response.buffer, relativePath);

        await pool.query(
          `INSERT INTO research_attachments (
            document_id, filename, content_type, file_size, file_path
          ) VALUES ($1, $2, $3, $4, $5)`,
          [doc.id, filename, 'application/pdf', response.buffer.length, relativePath]
        );

        await pool.query(
          `UPDATE research_documents
           SET attachment_count = attachment_count + 1, has_attachments = true
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
