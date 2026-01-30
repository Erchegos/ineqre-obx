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
      // Fix possessives
      .replace(/\bMondays\b/g, "Monday's")
      .replace(/\bTuesdays\b/g, "Tuesday's")
      .replace(/\bWednesdays\b/g, "Wednesday's")
      .replace(/\bThursdays\b/g, "Thursday's")
      .replace(/\bFridays\b/g, "Friday's")
      .replace(/\bSaturdays\b/g, "Saturday's")
      .replace(/\bSundays\b/g, "Sunday's")
      .replace(/\bones\b/g, "one's")
      .replace(/\btwos\b/g, "two's")
      .replace(/\bthrees\b/g, "three's")
      // Fix double spaces
      .replace(/  +/g, ' ');

    if (fixed !== row.body_text) {
      await pool.query('UPDATE research_documents SET body_text = $1 WHERE id = $2', [fixed, row.id]);
      count++;
      if (count <= 5) {
        console.log('Fixed document', row.id);
      }
    }
  }

  console.log('Total fixed:', count, 'documents');
  await pool.end();
}

fix().catch(err => { console.error(err); process.exit(1); });
