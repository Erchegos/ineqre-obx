#!/usr/bin/env tsx
/**
 * Check equity historical data coverage
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: 'apps/web/.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  // Get equities sorted by first data date
  const equities = await pool.query(`
    SELECT s.ticker, s.name, MIN(p.date) as first_date, MAX(p.date) as last_date, COUNT(*) as rows
    FROM stocks s
    JOIN prices_daily p ON s.ticker = p.ticker
    WHERE s.asset_type = 'equity'
    GROUP BY s.ticker, s.name
    ORDER BY MIN(p.date) ASC
    LIMIT 30
  `);

  console.log('Equities with earliest data (oldest first):');
  equities.rows.forEach(r => {
    const firstDate = r.first_date.toISOString().slice(0, 10);
    const ticker = r.ticker.padEnd(8);
    const rows = r.rows.toString().padStart(5);
    console.log(`  ${ticker} | ${firstDate} | ${rows} rows | ${r.name.substring(0, 35)}`);
  });

  // Count by year of first data
  const byYear = await pool.query(`
    WITH first_dates AS (
      SELECT s.ticker, MIN(p.date) as first_date
      FROM stocks s
      JOIN prices_daily p ON s.ticker = p.ticker
      WHERE s.asset_type = 'equity'
      GROUP BY s.ticker
    )
    SELECT EXTRACT(YEAR FROM first_date) as year, COUNT(*) as count
    FROM first_dates
    GROUP BY EXTRACT(YEAR FROM first_date)
    ORDER BY year
  `);

  console.log('\n\nEquities by year of first data:');
  byYear.rows.forEach(r => {
    console.log(`  ${r.year}: ${r.count} equities`);
  });

  // Get equities with potential for more history (starting 2015+)
  const candidates = await pool.query(`
    SELECT s.ticker, s.name, MIN(p.date) as first_date, COUNT(*) as rows
    FROM stocks s
    JOIN prices_daily p ON s.ticker = p.ticker
    WHERE s.asset_type = 'equity'
    GROUP BY s.ticker, s.name
    HAVING MIN(p.date) > '2015-01-01'
    ORDER BY s.ticker
  `);

  console.log(`\n\nEquities starting after 2015 (${candidates.rows.length} total):`);
  candidates.rows.forEach(r => {
    const firstDate = r.first_date.toISOString().slice(0, 10);
    console.log(`  ${r.ticker.padEnd(8)} | ${firstDate} | ${r.name.substring(0, 40)}`);
  });

  await pool.end();
}

main();
