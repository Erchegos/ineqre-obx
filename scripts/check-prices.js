#!/usr/bin/env node
/**
 * Check latest price data in database
 */

require('dotenv').config();
const { Pool } = require('pg');

let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function checkPrices() {
  console.log('=== Price Data Status ===\n');

  const result = await pool.query(`
    SELECT ticker, MAX(date) as latest_date, COUNT(*) as total_records
    FROM prices_daily
    WHERE ticker IN ('OBX', 'EQNR', 'DNB', 'MOWI', 'NHY', 'TEL', 'YAR', 'AKER', 'SALM', 'ORK', 'AKRBP', 'STB', 'MPCC', 'SCATC', 'GJF', 'TGS', 'VEND')
    GROUP BY ticker
    ORDER BY ticker
  `);

  const today = new Date().toISOString().split('T')[0];
  console.log(`Today: ${today}\n`);

  for (const row of result.rows) {
    const latest = row.latest_date.toISOString().split('T')[0];
    const isToday = latest === today;
    const isYesterday = latest === new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const status = isToday ? '✓' : isYesterday ? '○' : '⚠️';
    console.log(`${status} ${row.ticker.padEnd(6)} Latest: ${latest}  (${row.total_records} records)`);
  }

  // Show detail for one stock
  console.log('\n=== Recent EQNR data ===');
  const detail = await pool.query(`
    SELECT date, close, volume
    FROM prices_daily
    WHERE ticker = 'EQNR'
    ORDER BY date DESC
    LIMIT 5
  `);

  for (const row of detail.rows) {
    console.log(`  ${row.date.toISOString().split('T')[0]}  Close: ${Number(row.close).toFixed(2).padStart(7)}  Volume: ${row.volume}`);
  }

  await pool.end();
}

checkPrices().catch(console.error);
