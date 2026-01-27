/**
 * Quick Add Multiple Users
 *
 * This script allows you to quickly add multiple users with passwords.
 * Usage: node scripts/add-users.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

// Database setup
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

// Define users to add (you can edit this list)
const usersToAdd = [
  // { description: 'Example User', password: 'ExamplePass123' },
];

async function addUser(description, password) {
  const tokenHash = await bcrypt.hash(password, 10);

  const result = await pool.query(`
    INSERT INTO research_access_tokens (description, token_hash, is_active)
    VALUES ($1, $2, true)
    RETURNING id, description
  `, [description, tokenHash]);

  return result.rows[0];
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║      Adding Multiple Users              ║');
  console.log('╚════════════════════════════════════════╝\n');

  try {
    for (const user of usersToAdd) {
      console.log(`Adding: ${user.description}...`);
      const result = await addUser(user.description, user.password);
      console.log(`✓ Created (ID: ${result.id})`);
      console.log(`  Password: ${user.password}\n`);
    }

    console.log('\n=== Summary ===');
    console.log(`Successfully added ${usersToAdd.length} users.\n`);

    // Show all active tokens
    const allTokens = await pool.query(`
      SELECT id, description, created_at
      FROM research_access_tokens
      WHERE is_active = true
      ORDER BY created_at DESC
    `);

    console.log('Active Access Tokens:');
    allTokens.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.description || 'Unnamed'} (ID: ${row.id})`);
    });
    console.log('');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
