require('dotenv').config();
const { Pool } = require('pg');
const { google } = require('googleapis');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=\w+/g, ''),
  ssl: { rejectUnauthorized: false }
});

const credentials = JSON.parse(fs.readFileSync('./gmail-credentials.json'));
const token = JSON.parse(fs.readFileSync('./gmail-token.json'));
const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
oAuth2Client.setCredentials(token);

const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

(async () => {
  const result = await pool.query(`
    SELECT id, subject, email_message_id
    FROM research_documents
    WHERE subject LIKE '%Knowit%Heading%'
    LIMIT 1
  `);

  if (!result.rows[0]) {
    console.log('Document not found');
    process.exit(0);
  }

  const doc = result.rows[0];
  console.log('Document:', doc.subject);
  console.log('Email ID:', doc.email_message_id);

  const searchQuery = `rfc822msgid:${doc.email_message_id}`;

  const searchResponse = await gmail.users.messages.list({
    userId: 'me',
    q: searchQuery,
  });

  if (!searchResponse.data.messages) {
    console.log('Email not found in Gmail');
    process.exit(0);
  }

  const messageId = searchResponse.data.messages[0].id;
  const fullMessage = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'raw',
  });

  const rawEmail = Buffer.from(fullMessage.data.raw, 'base64url').toString('utf-8');

  // Find all FactSet URLs in quoted-printable format
  const matches = rawEmail.match(/href=3D["']([^"']*parp[^"']{0,2000})["']/gi);

  if (matches) {
    console.log('\nFound', matches.length, 'FactSet URL(s):\n');
    matches.forEach((match, i) => {
      let url = match
        .replace(/href=3D["']/i, '')
        .replace(/["']$/, '')
        .replace(/=\r?\n/g, '')  // Remove soft line breaks
        .replace(/=([0-9A-F]{2})/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16)))  // Decode hex
        .replace(/=3D/gi, '=');  // Decode =3D to =

      console.log(`${i + 1}. ${url.substring(0, 150)}...`);
      console.log(`   Full length: ${url.length} chars\n`);
    });
  } else {
    console.log('\nNo FactSet URLs found in quoted-printable format');

    // Try plain href
    const plainMatches = rawEmail.match(/href=["']([^"']*parp[^"']{0,500})["']/gi);
    if (plainMatches) {
      console.log('Found plain href:', plainMatches[0].substring(0, 200));
    }
  }

  pool.end();
})().catch(err => { console.error(err); pool.end(); });
