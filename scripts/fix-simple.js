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
    let fixed = row.body_text
      .replace(/\bMondays\b/g, "Monday's")
      .replace(/\bones\b(?= hardest)/g, "one's")
      .replace(/  +/g, ' ');

    if (fixed !== row.body_text) {
      await pool.query('UPDATE research_documents SET body_text = $1 WHERE id = $2', [fixed, row.id]);
      count++;
      if (count <= 3) {
        console.log('Fixed doc', row.id);
      }
    }
  }

  console.log('Total fixed:', count);
  await pool.end();
}

fix().catch(err => { console.error(err); process.exit(1); });
