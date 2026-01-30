#!/usr/bin/env tsx
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

const NEW_TICKERS = [
  'NONG', 'PARB', 'AKSO', 'BWO', 'SOFF', 'BONHR', 'ODF', 'HUNT', 'KCC', 'KID',
  'AKVA', 'MULTI', 'PHO', 'NEXT', 'IDEX', 'OTEC', 'PEXIP', 'PCIB', 'MEDI', 'GSF',
  'ENDUR', 'KMCP', 'BOUV', 'ABG', 'NORBT', 'NEL', 'NAPA', 'KOA', '2020', 'ABL',
  'ARCH', 'AKAST'
];

async function main() {
  try {
    // Check current state
    const check = await pool.query(`
      SELECT ticker, source, COUNT(*) as cnt
      FROM prices_daily
      WHERE ticker = ANY($1)
      GROUP BY ticker, source
      ORDER BY ticker, source
    `, [NEW_TICKERS]);

    console.log('Current source values for new stocks:');
    console.table(check.rows);

    // Update to 'ibkr' source
    const update = await pool.query(`
      UPDATE prices_daily
      SET source = 'ibkr'
      WHERE source = 'yfinance'
      AND ticker = ANY($1)
    `, [NEW_TICKERS]);

    console.log('\nUpdated', update.rowCount, 'rows to source=ibkr');

    // Verify
    const verify = await pool.query(`
      SELECT ticker, source, COUNT(*) as cnt
      FROM prices_daily
      WHERE ticker = ANY($1)
      GROUP BY ticker, source
      ORDER BY ticker, source
    `, [NEW_TICKERS]);

    console.log('\nAfter update:');
    console.table(verify.rows);

  } finally {
    await pool.end();
  }
}

main();
