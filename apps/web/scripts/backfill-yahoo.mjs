#!/usr/bin/env node
/**
 * Backfill recent missing days using Yahoo Finance
 * Usage: node scripts/backfill-yahoo.mjs
 */

import { spawn } from 'child_process';
import pg from 'pg';
import { readFileSync } from 'fs';

const { Pool } = pg;

// Load .env.local
const envContent = readFileSync('.env.local', 'utf-8');
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }
});

// OBX stocks with their Yahoo Finance tickers
const STOCKS = {
  'AKER': 'AKER.OL',
  'DNB': 'DNB.OL',
  'OBX': 'OBX.OL',
  // Add more as needed
};

async function downloadYahooData(yahooTicker, days = 10) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const period1 = Math.floor(startDate.getTime() / 1000);
  const period2 = Math.floor(endDate.getTime() / 1000);

  const url = `https://query1.finance.yahoo.com/v7/finance/download/${yahooTicker}?period1=${period1}&period2=${period2}&interval=1d&events=history`;

  console.log(`Downloading ${yahooTicker}...`);

  return new Promise((resolve, reject) => {
    const curl = spawn('curl', ['-s', '-L', url]);
    let data = '';

    curl.stdout.on('data', (chunk) => {
      data += chunk;
    });

    curl.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`curl failed with code ${code}`));
        return;
      }
      resolve(data);
    });
  });
}

function parseCSV(csv, ticker) {
  const lines = csv.trim().split('\n');
  const headers = lines[0].split(',');
  const prices = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    if (values.length < 6) continue;

    const [date, open, high, low, close, adjClose, volume] = values;

    // Skip if any required field is null or invalid
    if (!date || open === 'null' || close === 'null') continue;

    prices.push({
      ticker,
      date,
      open: parseFloat(open),
      high: parseFloat(high),
      low: parseFloat(low),
      close: parseFloat(close),
      adj_close: parseFloat(adjClose || close),
      volume: parseInt(volume || '0', 10)
    });
  }

  return prices;
}

async function upsertPrices(prices) {
  let inserted = 0;
  let updated = 0;

  for (const price of prices) {
    const result = await pool.query(`
      INSERT INTO prices_daily (ticker, date, open, high, low, close, adj_close, volume, source)
      VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, 'yahoo')
      ON CONFLICT (ticker, date) DO UPDATE SET
        open = EXCLUDED.open,
        high = EXCLUDED.high,
        low = EXCLUDED.low,
        close = EXCLUDED.close,
        adj_close = EXCLUDED.adj_close,
        volume = EXCLUDED.volume,
        source = EXCLUDED.source
      RETURNING (xmax = 0) AS is_insert
    `, [
      price.ticker,
      price.date,
      price.open,
      price.high,
      price.low,
      price.close,
      price.adj_close,
      price.volume
    ]);

    if (result.rows[0]?.is_insert) {
      inserted++;
    } else {
      updated++;
    }
  }

  return { inserted, updated };
}

async function main() {
  console.log('=== Backfilling Recent Data from Yahoo Finance ===\n');

  try {
    await pool.connect();
    console.log('✓ Database connected\n');

    for (const [ticker, yahooTicker] of Object.entries(STOCKS)) {
      try {
        console.log(`[${ticker}] Processing...`);
        const csv = await downloadYahooData(yahooTicker, 10);
        const prices = parseCSV(csv, ticker);

        if (prices.length === 0) {
          console.log(`[${ticker}] ✗ No data found\n`);
          continue;
        }

        const { inserted, updated } = await upsertPrices(prices);
        console.log(`[${ticker}] ✓ Complete: ${inserted} inserted, ${updated} updated\n`);
      } catch (error) {
        console.error(`[${ticker}] ✗ Error: ${error.message}\n`);
      }
    }

    console.log('✓ Backfill complete!');
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
