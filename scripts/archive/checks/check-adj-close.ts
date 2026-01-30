#!/usr/bin/env tsx
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

async function main() {
  // Check old stocks (original OBX stocks)
  const old = await pool.query(`
    SELECT ticker, date, close, adj_close, close - adj_close as diff
    FROM prices_daily
    WHERE ticker IN ('DNB', 'EQNR', 'YAR', 'TEL')
    AND date > '2024-01-01'
    AND adj_close IS NOT NULL
    AND adj_close != close
    ORDER BY ticker, date DESC
    LIMIT 20
  `);
  console.log('OLD stocks (adj_close != close):');
  console.table(old.rows);

  // Check new stocks
  const newStocks = await pool.query(`
    SELECT ticker, date, close, adj_close, close - adj_close as diff
    FROM prices_daily
    WHERE ticker IN ('PARB', 'AKSO', 'KID', 'NONG')
    AND date > '2024-01-01'
    ORDER BY ticker, date DESC
    LIMIT 20
  `);
  console.log('\nNEW stocks:');
  console.table(newStocks.rows);

  // Check if any old stocks have adj_close different from close
  const diffCount = await pool.query(`
    SELECT ticker, COUNT(*) as diff_count
    FROM prices_daily
    WHERE adj_close IS NOT NULL AND adj_close != close
    GROUP BY ticker
    ORDER BY diff_count DESC
    LIMIT 20
  `);
  console.log('\nStocks with adj_close != close:');
  console.table(diffCount.rows);

  await pool.end();
}

main();
