/**
 * Change Password for Existing Access Token
 *
 * This script allows you to update the password for an existing token
 * while keeping the same description and ID.
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
  const result = await pool.query(`
    SELECT id, description, is_active, created_at, last_used_at
    FROM research_access_tokens
    WHERE is_active = true
    ORDER BY created_at DESC
  `);

  console.log('\n=== Active Access Tokens ===\n');

  if (result.rows.length === 0) {
    console.log('No active tokens found.\n');
    return [];
  }

  result.rows.forEach((row, index) => {
    console.log(`${index + 1}. ${row.description || 'Unnamed Token'}`);
    console.log(`   ID: ${row.id}`);
    console.log(`   Created: ${row.created_at.toLocaleString()}`);
    console.log(`   Last Used: ${row.last_used_at ? row.last_used_at.toLocaleString() : 'Never'}`);
    console.log('');
  });

  return result.rows;
}

async function changePassword() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║        Change Access Password           ║');
  console.log('╚════════════════════════════════════════╝\n');

  const tokens = await listTokens();

  if (tokens.length === 0) {
    console.log('No tokens available to update.\n');
    return;
  }

  const tokenId = await question('Enter Token ID to change password (or "cancel"): ');

  if (tokenId.toLowerCase() === 'cancel') {
    console.log('Cancelled.\n');
    return;
  }

  // Verify token exists
  const checkResult = await pool.query(
    'SELECT id, description FROM research_access_tokens WHERE id = $1 AND is_active = true',
    [tokenId]
  );

  if (checkResult.rows.length === 0) {
    console.log('\n✗ Token not found or inactive!\n');
    return;
  }

  const token = checkResult.rows[0];
  console.log(`\nChanging password for: ${token.description || 'Unnamed Token'}`);

  const newPassword = await question('Enter new password: ');
  const confirmPassword = await question('Confirm new password: ');

  if (newPassword !== confirmPassword) {
    console.log('\n✗ Passwords do not match!\n');
    return;
  }

  if (!newPassword) {
    console.log('\n✗ Password cannot be empty!\n');
    return;
  }

  // Hash the new password
  const tokenHash = await bcrypt.hash(newPassword, 10);

  // Update in database
  await pool.query(
    'UPDATE research_access_tokens SET token_hash = $1 WHERE id = $2',
    [tokenHash, tokenId]
  );

  console.log('\n✓ Password updated successfully!\n');
  console.log(`Token: ${token.description || 'Unnamed'}`);
  console.log(`ID: ${token.id}`);
  console.log(`New Password: ${newPassword}`);
  console.log('\nUsers can now log in with the new password.\n');
}

async function main() {
  try {
    await changePassword();
  } catch (error) {
    console.error('\n✗ Error:', error.message, '\n');
  } finally {
    rl.close();
    await pool.end();
  }
}

main().catch(console.error);
