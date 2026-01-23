#!/usr/bin/env node
/**
 * Analyze email structure to find any alternative PDF links or attachments
 */

require('dotenv').config();
const { ImapFlow } = require('imapflow');

const client = new ImapFlow({
  host: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
  port: parseInt(process.env.EMAIL_IMAP_PORT || '993'),
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
  logger: false,
});

async function main() {
  console.log('Analyzing Storebrand email structure...\n');

  await client.connect();
  await client.mailboxOpen('INBOX');

  // Search for the Storebrand email
  const results = await client.search({
    subject: 'Storebrand - Likely to end 2025E on a high note - Quarterly Preview',
    since: new Date('2026-01-22'),
    before: new Date('2026-01-24'),
  });

  if (results.length === 0) {
    console.log('Email not found');
    await client.logout();
    return;
  }

  console.log(`Found email (UID: ${results[0]})\n`);

  // Fetch full email source
  const message = await client.fetchOne(results[0], {
    source: true,
    bodyStructure: true,
    envelope: true,
  });

  console.log('ENVELOPE:');
  console.log(`From: ${message.envelope.from[0].address}`);
  console.log(`Subject: ${message.envelope.subject}`);
  console.log(`Date: ${message.envelope.date}\n`);

  console.log('BODY STRUCTURE:');
  console.log(JSON.stringify(message.bodyStructure, null, 2));

  console.log('\n\nRAW EMAIL SOURCE (first 5000 chars):');
  const rawEmail = message.source.toString();
  console.log(rawEmail.substring(0, 5000));

  console.log('\n\nSEARCHING FOR PDF LINKS IN RAW EMAIL:');

  // Search for all href links
  const hrefMatches = rawEmail.matchAll(/href=["']([^"']+)["']/gi);
  let linkCount = 0;
  for (const match of hrefMatches) {
    linkCount++;
    const url = match[1];
    if (url.includes('factset') || url.includes('pareto') || url.includes('.pdf') || url.includes('research')) {
      console.log(`  ${linkCount}. ${url}`);
    }
  }

  // Search for encoded href links (quoted-printable)
  console.log('\n\nSEARCHING FOR ENCODED LINKS:');
  const encodedHrefMatches = rawEmail.matchAll(/href=3D["']([^"']+)["']/gi);
  linkCount = 0;
  for (const match of encodedHrefMatches) {
    linkCount++;
    let url = match[1]
      .replace(/=\r?\n/g, '')
      .replace(/=3D/gi, '=')
      .replace(/=([0-9A-F]{2})/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
    console.log(`  ${linkCount}. ${url}`);
  }

  await client.logout();
}

main().catch(console.error);
