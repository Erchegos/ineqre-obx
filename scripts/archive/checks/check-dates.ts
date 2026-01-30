#!/usr/bin/env tsx
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

async function main() {
  // Check OBX date range
  const obx = await pool.query(`
    SELECT MIN(date) as first_date, MAX(date) as last_date, COUNT(*) as total_rows
    FROM prices_daily WHERE ticker = 'OBX' AND source = 'ibkr'
  `);
  console.log('OBX data range:');
  console.table(obx.rows);

  // Check new stock date ranges
  const stocks = await pool.query(`
    SELECT ticker, MIN(date) as first_date, MAX(date) as last_date, COUNT(*) as rows
    FROM prices_daily
    WHERE ticker IN ('KID', 'HUNT', 'KCC', 'NONG', 'PARB', 'AKSO', 'DNB', 'EQNR')
    AND source = 'ibkr'
    GROUP BY ticker
    ORDER BY ticker
  `);
  console.log('\nStock date ranges:');
  console.table(stocks.rows);

  await pool.end();
}

main();
