#!/usr/bin/env node
/**
 * Remove delisted tickers from the system
 */

require('dotenv').config();
const { Pool } = require('pg');

let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

const DELISTED = ['SUBSEA', 'KAHOT', 'GOGL', 'PGS', 'XXL'];

async function cleanup() {
  console.log('Cleaning up delisted tickers...\n');

  for (const ticker of DELISTED) {
    console.log(`Checking ${ticker}...`);

    // Check if exists in stocks table
    const check = await pool.query(
      'SELECT ticker FROM stocks WHERE ticker = $1',
      [ticker]
    );

    if (check.rows.length > 0) {
      console.log(`  Found in stocks table, removing...`);
      await pool.query('DELETE FROM stocks WHERE ticker = $1', [ticker]);
      console.log(`  ✓ Removed ${ticker}`);
    } else {
      console.log(`  Not found in stocks table`);
    }
  }

  console.log('\n✓ Cleanup complete');
  await pool.end();
}

cleanup().catch(console.error);
