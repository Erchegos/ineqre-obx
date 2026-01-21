require('dotenv').config();
const { ImapFlow } = require('imapflow');

const CONFIG = {
  email: {
    host: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.EMAIL_IMAP_PORT || '993'),
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  },
};

async function test() {
  const imap = new ImapFlow(CONFIG.email);
  await imap.connect();
  await imap.mailboxOpen('INBOX');

  let count = 0;
  for await (const msg of imap.fetch(
    { from: 'noreply@research.paretosec.com', since: new Date('2026-01-21') },
    { envelope: true, source: true }
  )) {
    const rawEmail = msg.source.toString('utf-8');

    // Try to find ALL href links
    const allLinks = rawEmail.match(/href=3D["']([^"']+)["']/gi) || [];
    const allLinks2 = rawEmail.match(/href=["']([^"']+)["']/gi) || [];

    console.log('\nEmail:', msg.envelope.subject);
    console.log('Links with href=3D:', allLinks.length);
    if (allLinks.length > 0) {
      console.log('  First:', allLinks[0].substring(0, 100));
    }
    console.log('Links with href:', allLinks2.length);
    if (allLinks2.length > 0) {
      console.log('  First:', allLinks2[0].substring(0, 100));
    }

    // Show first 2000 chars to see HTML structure
    const htmlStart = rawEmail.search(/(?:<!DOCTYPE|<html|<table[^>]*cellspacing)/i);
    if (htmlStart > 0) {
      const sample = rawEmail.substring(htmlStart, htmlStart + 2000);
      console.log('\nHTML sample (first 500 chars):');
      console.log(sample.substring(0, 500));
    }

    if (++count >= 3) break;
  }

  await imap.logout();
}

test().catch(console.error);
