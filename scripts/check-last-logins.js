require('dotenv').config();
const { Pool } = require('pg');

let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    const result = await pool.query(`
      SELECT id, description, is_active, created_at, last_used_at
      FROM research_access_tokens
      WHERE is_active = true
      ORDER BY last_used_at DESC NULLS LAST, created_at DESC
    `);

    console.log('\n=== Active Passwords (sorted by last login) ===\n');

    result.rows.forEach((token, index) => {
      console.log(`${index + 1}. ${token.description || 'Unnamed'}`);
      console.log(`   Created: ${token.created_at.toLocaleDateString()}`);
      console.log(`   Last Login: ${token.last_used_at ? token.last_used_at.toLocaleString('nb-NO') : 'Never'}`);
      console.log('');
    });
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
})();
