require('dotenv').config();
const { Pool } = require('pg');

let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function fix() {
  // Fix Mondays -> Monday's
  const r1 = await pool.query(`
    UPDATE research_documents
    SET body_text = REPLACE(body_text, 'Mondays ', 'Monday''s ')
    WHERE body_text LIKE '%Mondays %'
  `);
  console.log('Fixed Mondays:', r1.rowCount);

  // Fix ones -> one's (before "hardest")
  const r2 = await pool.query(`
    UPDATE research_documents
    SET body_text = REPLACE(body_text, 'ones hardest', 'one''s hardest')
    WHERE body_text LIKE '%ones hardest%'
  `);
  console.log('Fixed ones:', r2.rowCount);

  // Fix double spaces
  const r3 = await pool.query(`
    UPDATE research_documents
    SET body_text = REPLACE(body_text, '  ', ' ')
    WHERE body_text LIKE '%  %'
  `);
  console.log('Fixed double spaces:', r3.rowCount);

  await pool.end();
}

fix();
