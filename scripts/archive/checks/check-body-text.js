require('dotenv').config();
const { Pool } = require('pg');

let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const result = await pool.query(`
    SELECT subject, body_text
    FROM research_documents
    WHERE subject LIKE '%Knowit%'
    ORDER BY received_date DESC
    LIMIT 1
  `);

  if (result.rows.length > 0) {
    const doc = result.rows[0];
    console.log('Subject:', doc.subject);
    console.log('\n=== Last 1000 characters of body_text ===');
    console.log(doc.body_text.slice(-1000));
    console.log('\n=== Searching for links ===');

    const allLinks = doc.body_text.match(/https?:\/\/[^\s<>"]+/g) || [];
    console.log('Found', allLinks.length, 'links:');
    allLinks.forEach((link, i) => {
      console.log(`${i + 1}. ${link}`);
    });
  }

  await pool.end();
}

run().catch(console.error);
