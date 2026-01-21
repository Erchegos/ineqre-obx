/**
 * Update Research Portal Password
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

// Database setup
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

const NEW_PASSWORD = 'HIOInvest';

async function updatePassword() {
  console.log('Updating research portal password...\n');

  // Hash the new password
  const hash = await bcrypt.hash(NEW_PASSWORD, 10);
  console.log('New password hashed');

  // Update all active tokens
  const result = await pool.query(
    `UPDATE research_access_tokens
     SET token_hash = $1
     WHERE is_active = true
     RETURNING id`,
    [hash]
  );

  console.log(`\n✓ Updated ${result.rows.length} access token(s)`);

  console.log(`\nNew password: ${NEW_PASSWORD}`);

  await pool.end();
}

updatePassword().catch(console.error);
