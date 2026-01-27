#!/usr/bin/env tsx
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

async function main() {
  // Check fundamentals data
  const f = await pool.query(`SELECT ticker, as_of_date, market_cap, pe_ratio, source
    FROM fundamentals_snapshot WHERE ticker IN ('PARB', 'AKSO', 'DNB') ORDER BY ticker, as_of_date DESC`);
  console.log('Fundamentals snapshot data:');
  console.table(f.rows);

  // Check stock names
  const n = await pool.query(`SELECT ticker, name FROM stocks
    WHERE ticker IN ('PARB', 'AKSO', 'DNB', 'EQNR', 'HUNT', 'KID', 'NONG', 'BWO') ORDER BY ticker`);
  console.log('\nStock names:');
  console.table(n.rows);

  // Check if there's a company_fundamentals table
  const tables = await pool.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE '%fund%'`);
  console.log('\nTables with fund:');
  console.table(tables.rows);

  await pool.end();
}

main();
