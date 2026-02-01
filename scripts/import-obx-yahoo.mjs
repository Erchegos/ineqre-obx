#!/usr/bin/env node

/**
 * Import historical OBX data from Yahoo Finance
 *
 * Yahoo Finance has OBX data (ticker: OBX.OL) going back to 2004-09-27
 * while IBKR only provides data from 2020-04-22.
 *
 * This script:
 * 1. Downloads OBX.OL historical data from Yahoo Finance
 * 2. Imports it into the price_data_adjusted table
 * 3. Skips dates that already exist in the database
 */

import { spawn } from 'child_process';
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from apps/web/.env.local
dotenv.config({ path: join(__dirname, '../apps/web/.env.local') });

const { Pool } = pg;

// Database connection using DATABASE_URL (same pattern as apps/web/src/lib/db.ts)
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined in .env.local');
}

const connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '').replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: {
    rejectUnauthorized: false
  },
  query_timeout: 30000,
  statement_timeout: 30000
});

/**
 * Download OBX historical data from Yahoo Finance
 */
async function downloadYahooData() {
  return new Promise((resolve, reject) => {
    const pythonScript = `
import yfinance as yf
import json

ticker = yf.Ticker('OBX.OL')
hist = ticker.history(period='max')

data = []
for date, row in hist.iterrows():
    data.append({
        'date': date.strftime('%Y-%m-%d'),
        'open': float(row['Open']),
        'high': float(row['High']),
        'low': float(row['Low']),
        'close': float(row['Close']),
        'volume': int(row['Volume']) if row['Volume'] > 0 else 0
    })

print(json.dumps(data))
`;

    const python = spawn('python3', ['-c', pythonScript]);
    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python script failed: ${stderr}`));
      } else {
        try {
          const data = JSON.parse(stdout);
          resolve(data);
        } catch (err) {
          reject(new Error(`Failed to parse JSON: ${err.message}`));
        }
      }
    });
  });
}

/**
 * Detect which price table exists (prices_daily or obx_equities)
 */
async function detectPriceTable() {
  const result = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'prices_daily'
    ) as has_prices_daily,
    EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'obx_equities'
    ) as has_obx_equities
  `);

  const { has_prices_daily, has_obx_equities } = result.rows[0];

  if (has_prices_daily) {
    return 'prices_daily';
  } else if (has_obx_equities) {
    return 'obx_equities';
  } else {
    throw new Error('No price data table found (prices_daily or obx_equities)');
  }
}

/**
 * Get existing dates for OBX in the database
 */
async function getExistingDates(tableName) {
  const result = await pool.query(
    `SELECT date::date as date
     FROM ${tableName}
     WHERE UPPER(ticker) = 'OBX'
     ORDER BY date`
  );
  return new Set(result.rows.map(row => {
    const date = row.date instanceof Date
      ? row.date.toISOString().split('T')[0]
      : String(row.date);
    return date;
  }));
}

/**
 * Import OBX data into database
 */
async function importData(tableName, data, existingDates) {
  let inserted = 0;
  let skipped = 0;

  for (const bar of data) {
    if (existingDates.has(bar.date)) {
      skipped++;
      continue;
    }

    try {
      await pool.query(
        `INSERT INTO ${tableName}
         (ticker, date, open, high, low, close, volume, adj_close)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (ticker, date) DO NOTHING`,
        ['OBX', bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume, bar.close]
      );
      inserted++;

      if (inserted % 100 === 0) {
        console.log(`Inserted ${inserted} records...`);
      }
    } catch (err) {
      console.error(`Failed to insert ${bar.date}:`, err.message);
    }
  }

  return { inserted, skipped };
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('Detecting price table in database...');
    const tableName = await detectPriceTable();
    console.log(`Using table: ${tableName}`);

    console.log('\nDownloading OBX historical data from Yahoo Finance (OBX.OL)...');
    const data = await downloadYahooData();
    console.log(`Downloaded ${data.length} trading days`);
    console.log(`Date range: ${data[0]?.date} to ${data[data.length - 1]?.date}`);

    console.log('\nChecking existing data in database...');
    const existingDates = await getExistingDates(tableName);
    console.log(`Found ${existingDates.size} existing OBX dates in database`);

    console.log('\nImporting new data...');
    const { inserted, skipped } = await importData(tableName, data, existingDates);

    console.log('\n✓ Import complete!');
    console.log(`  Inserted: ${inserted} new records`);
    console.log(`  Skipped: ${skipped} existing records`);
    console.log(`  Total: ${data.length} records processed`);

    // Show date range in database after import
    const rangeResult = await pool.query(
      `SELECT
        MIN(date)::date as start_date,
        MAX(date)::date as end_date,
        COUNT(*) as total_days
       FROM ${tableName}
       WHERE UPPER(ticker) = 'OBX'`
    );
    const range = rangeResult.rows[0];
    console.log(`\nOBX data in database:`);
    console.log(`  Start: ${range.start_date instanceof Date ? range.start_date.toISOString().split('T')[0] : range.start_date}`);
    console.log(`  End: ${range.end_date instanceof Date ? range.end_date.toISOString().split('T')[0] : range.end_date}`);
    console.log(`  Total days: ${range.total_days}`);

  } catch (err) {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
