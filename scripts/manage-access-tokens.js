/**
 * Manage Research Portal Access Tokens
 *
 * This script allows you to:
 * - List existing access tokens
 * - Create new access tokens with passwords
 * - Deactivate tokens
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const readline = require('readline');

// Database setup
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function listTokens() {
  console.log('\n=== Current Access Tokens ===\n');

  const result = await pool.query(`
    SELECT id, description, is_active, created_at, last_used_at, expires_at
    FROM research_access_tokens
    ORDER BY created_at DESC
  `);

  if (result.rows.length === 0) {
    console.log('No access tokens found.\n');
    return;
  }

  result.rows.forEach((row, index) => {
    console.log(`${index + 1}. ${row.description || 'Unnamed Token'}`);
    console.log(`   ID: ${row.id}`);
    console.log(`   Status: ${row.is_active ? '✓ Active' : '✗ Inactive'}`);
    console.log(`   Created: ${row.created_at.toLocaleString()}`);
    console.log(`   Last Used: ${row.last_used_at ? row.last_used_at.toLocaleString() : 'Never'}`);
    console.log(`   Expires: ${row.expires_at ? row.expires_at.toLocaleString() : 'Never'}`);
    console.log('');
  });
}

async function createToken() {
  console.log('\n=== Create New Access Token ===\n');

  const description = await question('Description (e.g., "John Doe", "Client Access"): ');
  const password = await question('Password: ');

  if (!password) {
    console.log('\n✗ Password is required!\n');
    return;
  }

  // Hash the password
  const tokenHash = await bcrypt.hash(password, 10);

  // Insert into database
  const result = await pool.query(`
    INSERT INTO research_access_tokens (description, token_hash, is_active)
    VALUES ($1, $2, true)
    RETURNING id, description
  `, [description || null, tokenHash]);

  console.log('\n✓ Access token created successfully!\n');
  console.log(`ID: ${result.rows[0].id}`);
  console.log(`Description: ${result.rows[0].description || 'N/A'}`);
  console.log(`Password: ${password}`);
  console.log('\nUsers can now log in with this password.\n');
}

async function deactivateToken() {
  await listTokens();

  const tokenId = await question('\nEnter Token ID to deactivate (or "cancel"): ');

  if (tokenId.toLowerCase() === 'cancel') {
    console.log('Cancelled.\n');
    return;
  }

  const result = await pool.query(
    'UPDATE research_access_tokens SET is_active = false WHERE id = $1 RETURNING description',
    [tokenId]
  );

  if (result.rows.length > 0) {
    console.log(`\n✓ Token deactivated: ${result.rows[0].description || 'Unnamed Token'}\n`);
  } else {
    console.log('\n✗ Token not found!\n');
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Research Portal - Access Token Manager  ║');
  console.log('╚════════════════════════════════════════╝\n');

  while (true) {
    console.log('What would you like to do?');
    console.log('1. List all tokens');
    console.log('2. Create new token');
    console.log('3. Deactivate token');
    console.log('4. Exit');
    console.log('');

    const choice = await question('Enter choice (1-4): ');

    try {
      switch (choice) {
        case '1':
          await listTokens();
          break;
        case '2':
          await createToken();
          break;
        case '3':
          await deactivateToken();
          break;
        case '4':
          console.log('\nGoodbye!\n');
          rl.close();
          await pool.end();
          process.exit(0);
        default:
          console.log('\nInvalid choice. Please try again.\n');
      }
    } catch (error) {
      console.error('\n✗ Error:', error.message, '\n');
    }
  }
}

main().catch(console.error);
