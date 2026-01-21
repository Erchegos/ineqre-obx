require('dotenv').config();
const { Pool } = require('pg');

let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function fix() {
  const result = await pool.query('SELECT id, body_text FROM research_documents');

  let count = 0;
  for (const row of result.rows) {
    let fixed = row.body_text.replace(/"Taco Wednesday"/g, 'Taco Wednesday');

    if (fixed !== row.body_text) {
      await pool.query('UPDATE research_documents SET body_text = $1 WHERE id = $2', [fixed, row.id]);
      count++;
    }
  }

  console.log('Removed quotes from', count, 'documents');
  await pool.end();
}

fix().catch(err => { console.error(err); process.exit(1); });
