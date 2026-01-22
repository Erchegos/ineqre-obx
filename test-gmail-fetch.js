require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  credentialsPath: path.join(__dirname, 'gmail-credentials.json'),
  tokenPath: path.join(__dirname, 'gmail-token.json'),
};

async function authorize() {
  const credentials = JSON.parse(fs.readFileSync(CONFIG.credentialsPath));
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  
  if (fs.existsSync(CONFIG.tokenPath)) {
    const token = JSON.parse(fs.readFileSync(CONFIG.tokenPath));
    oAuth2Client.setCredentials(token);
  }
  return oAuth2Client;
}

async function test() {
  console.log('Authorizing...');
  const auth = await authorize();
  const gmail = google.gmail({ version: 'v1', auth });
  
  console.log('Searching for recent Investor email...');
  const searchResponse = await gmail.users.messages.list({
    userId: 'me',
    q: 'subject:"Investor - NAV" from:noreply@research.paretosec.com newer_than:1d',
    maxResults: 1,
  });
  
  if (!searchResponse.data.messages || searchResponse.data.messages.length === 0) {
    console.log('No messages found');
    return;
  }
  
  const messageId = searchResponse.data.messages[0].id;
  console.log(`Found message ID: ${messageId}`);
  
  console.log('\nFetching raw email...');
  const fullMessage = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'raw',
  });
  
  const rawEmail = Buffer.from(fullMessage.data.raw, 'base64url').toString('utf-8');
  
  console.log('\nSearching for PDF link patterns...\n');
  
  // Try different patterns
  console.log('1. Quoted-printable href (href=3D):');
  const qpMatch = rawEmail.match(/href=3D["']([^"']*factset[^"']{0,500})["']/i);
  if (qpMatch) {
    console.log('   Found:', qpMatch[1].substring(0, 150));
    const decoded = qpMatch[1]
      .replace(/=\r?\n/g, '')
      .replace(/=3D/gi, '=')
      .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
    console.log('   Decoded:', decoded.substring(0, 150));
  } else {
    console.log('   Not found');
  }
  
  console.log('\n2. Plain href:');
  const plainMatch = rawEmail.match(/href=["']([^"']*factset[^"']{0,500})["']/i);
  if (plainMatch) {
    console.log('   Found:', plainMatch[1].substring(0, 150));
  } else {
    console.log('   Not found');
  }
  
  console.log('\n3. Plain URL (no href):');
  const urlMatch = rawEmail.match(/https:\/\/parp\.hosting\.factset\.com[^\s"'<>]{0,500}/i);
  if (urlMatch) {
    console.log('   Found:', urlMatch[0].substring(0, 150));
  } else {
    console.log('   Not found');
  }
  
  console.log('\n4. Looking for "download?q" pattern:');
  const downloadMatch = rawEmail.match(/download\?q[^\s"'<>]{0,500}/i);
  if (downloadMatch) {
    console.log('   Found:', downloadMatch[0].substring(0, 150));
  } else {
    console.log('   Not found');
  }
  
  // Save a sample of the raw email for inspection
  const sampleStart = rawEmail.indexOf('CLICK HERE') - 200;
  const sampleEnd = sampleStart + 1000;
  if (sampleStart > 0) {
    console.log('\n\nRaw email sample around link:');
    console.log('---');
    console.log(rawEmail.substring(Math.max(0, sampleStart), sampleEnd));
    console.log('---');
  }
}

test().catch(console.error);
