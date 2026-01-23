#!/usr/bin/env node
/**
 * Test IMAP connection and search for recent emails
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

async function test() {
  console.log('Testing IMAP connection...\n');

  try {
    await client.connect();
    console.log('✓ Connected to IMAP\n');

    await client.mailboxOpen('INBOX');
    console.log('✓ Opened INBOX\n');

    // Search for emails from today
    console.log('Searching for emails from January 23, 2026...');
    const searchResults = await client.search({
      since: new Date('2026-01-23'),
      before: new Date('2026-01-24'),
    });

    console.log(`Found ${searchResults.length} emails\n`);

    if (searchResults.length > 0) {
      console.log('First 5 emails:');
      for (let i = 0; i < Math.min(5, searchResults.length); i++) {
        const uid = searchResults[i];
        const envelope = await client.fetchOne(uid, { envelope: true });
        console.log(`  ${i+1}. ${envelope.envelope.subject}`);
        console.log(`     From: ${envelope.envelope.from[0].address}`);
      }
    }

    await client.logout();
    console.log('\n✓ Test successful');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

test();
