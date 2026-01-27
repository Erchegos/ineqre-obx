#!/usr/bin/env tsx
import { TWSClient } from '../packages/ibkr/src/tws-client';
import { SecType } from '@stoqey/ib';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

async function main() {
  const client = new TWSClient();
  await client.connect();

  console.log('Fetching EQNR with maximum history (20Y)...\n');

  // Fetch adjusted (20 years)
  console.log('Fetching adjusted prices...');
  const adjustedData = await client.getHistoricalData(
    'EQNR', 'OSE', '20 Y', '1 day', SecType.STK, 'NOK', true
  );
  console.log(`✓ Fetched ${adjustedData.length} adjusted bars`);

  // Fetch raw (20 years)
  console.log('Fetching raw prices...');
  const rawData = await client.getHistoricalData(
    'EQNR', 'OSE', '20 Y', '1 day', SecType.STK, 'NOK', false
  );
  console.log(`✓ Fetched ${rawData.length} raw bars`);
  console.log(`Date range: ${adjustedData[0]?.time} to ${adjustedData[adjustedData.length-1]?.time}\n`);

  // Delete and re-insert
  await pool.query('DELETE FROM prices_daily WHERE ticker = $1', ['EQNR']);
  console.log('✓ Deleted existing EQNR data\n');

  const rawMap = new Map();
  rawData.forEach(bar => {
    const dateStr = bar.time.replace(/-/g, '').split(' ')[0];
    rawMap.set(dateStr, bar);
  });

  const adjMap = new Map();
  adjustedData.forEach(bar => {
    const dateStr = bar.time.replace(/-/g, '').split(' ')[0];
    adjMap.set(dateStr, bar);
  });

  let inserted = 0;
  for (const [dateStr, rawBar] of rawMap.entries()) {
    const adjBar = adjMap.get(dateStr);
    if (!adjBar) continue;

    await pool.query(`
      INSERT INTO prices_daily (ticker, date, open, high, low, close, volume, adj_close, source)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ibkr')
    `, [
      'EQNR', dateStr, rawBar.open, rawBar.high, rawBar.low,
      rawBar.close, Math.round(rawBar.volume), adjBar.close
    ]);
    inserted++;
  }

  console.log(`✓ Inserted ${inserted} bars for EQNR\n`);

  // Check earliest dividend
  const divCheck = await pool.query(`
    SELECT date, close, adj_close,
           ROUND((close - adj_close) / close * 100, 2) as div_pct
    FROM prices_daily
    WHERE ticker = 'EQNR'
    AND ABS(close - adj_close) > 1
    ORDER BY date
    LIMIT 10
  `);

  console.log('Earliest dividend adjustments:');
  divCheck.rows.forEach(r => {
    console.log(`  ${r.date}: Close=${Number(r.close).toFixed(2)} Adj=${Number(r.adj_close).toFixed(2)} (${r.div_pct}% div)`);
  });

  // Overall stats
  const stats = await pool.query(`
    SELECT
      COUNT(*) as total_bars,
      MIN(date) as first_date,
      MAX(date) as last_date,
      ROUND(AVG(adj_close / close * 100)::numeric, 2) as avg_adj_factor
    FROM prices_daily
    WHERE ticker = 'EQNR'
  `);

  console.log('\nEQNR Statistics:');
  console.log(`  Total bars: ${stats.rows[0].total_bars}`);
  console.log(`  Date range: ${stats.rows[0].first_date} to ${stats.rows[0].last_date}`);
  console.log(`  Avg adjustment factor: ${stats.rows[0].avg_adj_factor}%`);

  await client.disconnect();
  await pool.end();
}

main();
