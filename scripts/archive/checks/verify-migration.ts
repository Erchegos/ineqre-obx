#!/usr/bin/env tsx
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

async function verify() {
  console.log('Verifying migration results...\n');

  // Check renamed tickers
  const result = await pool.query(`
    SELECT s.ticker, s.name, s.currency, s.exchange,
           COUNT(p.date) as price_count,
           MIN(p.date) as first_date,
           MAX(p.date) as last_date
    FROM stocks s
    LEFT JOIN prices_daily p ON s.ticker = p.ticker
    WHERE s.ticker IN ('BORR.US', 'BWLP.US', 'ECO.US', 'HAFN.US', 'HSHP.US', 'EQNR.US', 'FRO.US')
       OR (s.ticker IN ('BORR', 'BWLP', 'ECO', 'HAFN', 'HSHP', 'EQNR', 'FRO') AND s.currency = 'USD')
    GROUP BY s.ticker, s.name, s.currency, s.exchange
    ORDER BY s.ticker
  `);

  console.log('US Tickers (.US suffix):');
  console.log('='.repeat(80));
  result.rows.filter(r => r.ticker.endsWith('.US')).forEach(row => {
    console.log(`${row.ticker.padEnd(12)} | ${row.currency} | ${row.exchange.padEnd(6)} | ${String(row.price_count).padStart(5)} prices | ${row.first_date} to ${row.last_date}`);
  });

  console.log('\n\nPlain tickers (USD currency - should be none):');
  console.log('='.repeat(80));
  const plainUsd = result.rows.filter(r => !r.ticker.endsWith('.US') && r.currency === 'USD');
  if (plainUsd.length === 0) {
    console.log('✓ No USD stocks with plain tickers (as expected)');
  } else {
    plainUsd.forEach(row => {
      console.log(`${row.ticker.padEnd(12)} | ${row.currency} | ${row.exchange.padEnd(6)} | ${String(row.price_count).padStart(5)} prices`);
    });
  }

  // Check OSE versions
  console.log('\n\nOSE versions (NOK currency):');
  console.log('='.repeat(80));
  const oseResult = await pool.query(`
    SELECT s.ticker, s.currency, s.exchange, COUNT(p.date) as price_count
    FROM stocks s
    LEFT JOIN prices_daily p ON s.ticker = p.ticker
    WHERE s.ticker IN ('BORR', 'BWLP', 'ECO', 'HAFN', 'HSHP', 'EQNR', 'FRO')
      AND s.currency = 'NOK'
    GROUP BY s.ticker, s.currency, s.exchange
    ORDER BY s.ticker
  `);

  oseResult.rows.forEach(row => {
    console.log(`${row.ticker.padEnd(12)} | ${row.currency} | ${row.exchange.padEnd(6)} | ${String(row.price_count).padStart(5)} prices`);
  });

  await pool.end();
}

verify();
