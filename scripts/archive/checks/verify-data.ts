#!/usr/bin/env tsx
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

async function main() {
  // Check sample stocks and their names
  const stocks = await pool.query(`
    SELECT s.ticker, s.name, cf.company_name, cf.business_summary IS NOT NULL as has_summary
    FROM stocks s
    LEFT JOIN company_fundamentals cf ON s.ticker = cf.ticker
    WHERE s.ticker IN ('PARB', 'DNB', 'EQNR', 'AKSO', 'KID', 'NONG', 'HUNT', 'CMBTO')
    ORDER BY s.ticker
  `);
  console.log('Sample stocks with fundamentals:');
  console.table(stocks.rows);

  // Count total
  const count = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM stocks WHERE ticker != 'OBX') as total_stocks,
      (SELECT COUNT(*) FROM company_fundamentals) as has_fundamentals
  `);
  console.log('\nCounts:', count.rows[0]);

  // Check for name mismatches
  const mismatches = await pool.query(`
    SELECT s.ticker, s.name as stock_name, cf.company_name as fundamental_name
    FROM stocks s
    JOIN company_fundamentals cf ON s.ticker = cf.ticker
    WHERE s.name != cf.company_name
    LIMIT 10
  `);
  if (mismatches.rows.length > 0) {
    console.log('\nName mismatches (stocks vs fundamentals):');
    console.table(mismatches.rows);
  }

  await pool.end();
}

main();
