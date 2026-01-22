#!/usr/bin/env node

const { Pool } = require('pg');
require('dotenv').config();

async function testStatsQuery() {
  let connectionString = process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, '');
  connectionString = connectionString.replace(/[?&]sslmode=\w+/g, '');

  const pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('Testing stats query...\n');

    const query = `
      SELECT
        COUNT(DISTINCT ticker_summary.ticker) as securities,
        MAX(ticker_summary.max_date) as last_updated,
        SUM(ticker_summary.record_count) as data_points
      FROM (
        SELECT
          p.ticker,
          MAX(p.date) as max_date,
          COUNT(*) as record_count
        FROM prices_daily p
        INNER JOIN stocks s ON p.ticker = s.ticker
        WHERE p.close IS NOT NULL AND p.close > 0
        GROUP BY p.ticker
        HAVING COUNT(*) >= 100
      ) ticker_summary
    `;

    const result = await pool.query(query);

    if (result.rows.length === 0) {
      console.log('❌ No results returned');
      return;
    }

    const stats = result.rows[0];
    console.log('✓ Query successful!');
    console.log(`Securities: ${stats.securities}`);
    console.log(`Last updated: ${stats.last_updated}`);
    console.log(`Data points: ${stats.data_points}`);

  } catch (e) {
    console.error('❌ Query failed:', e.message);
    console.error('Full error:', e);
  } finally {
    await pool.end();
  }
}

testStatsQuery();
