/**
 * Clean up and reimport DNB Carnegie reports
 */

require('dotenv').config();
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

// Database setup
let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

// Supabase setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function cleanup() {
  console.log('Cleaning up DNB Carnegie documents...\n');

  // Get all DNB Carnegie documents
  const docs = await pool.query(
    `SELECT id, subject FROM research_documents WHERE source = 'DNB Carnegie'`
  );

  console.log(`Found ${docs.rows.length} documents to clean up`);

  // Delete from database (cascade will delete attachments)
  await pool.query(`DELETE FROM research_documents WHERE source = 'DNB Carnegie'`);

  console.log('✓ Deleted from database');
  console.log('\nNow run: node scripts/import-dnb-pdfs.js ~/Documents/Intelligence_Equity_Research/code/Manual_PDF_Analysis\n');

  await pool.end();
}

cleanup().catch(console.error);
