#!/usr/bin/env node
import pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Use Supabase connection (production)
const SUPABASE_DB_URL = "postgresql://postgres.gznnailatxljhfadbwxr:Su.201712949340@aws-1-us-east-1.pooler.supabase.com:6543/postgres";

const pool = new Pool({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkHavi() {
  try {
    console.log('Checking HAVI data...\n');

    // Check stocks_latest
    console.log('1. HAVI in stocks_latest:');
    const stocksResult = await pool.query(
      `SELECT ticker, is_active, name FROM public.stocks_latest WHERE upper(ticker) = 'HAVI'`
    );
    console.log(stocksResult.rows);
    console.log('');

    // Check price data statistics
    console.log('2. HAVI price data statistics:');
    const statsResult = await pool.query(`
      SELECT
        upper(ticker) as ticker,
        count(*) as row_count,
        max(date) as last_date,
        min(date) as first_date,
        current_date - max(date) as days_since_last_update
      FROM public.prices_daily
      WHERE upper(ticker) = 'HAVI'
        AND close IS NOT NULL
        AND close > 0
      GROUP BY upper(ticker)
    `);
    console.log(statsResult.rows);
    console.log('');

    // Check the full query from API
    console.log('3. Why HAVI is excluded (checking all criteria):');
    const fullCheckResult = await pool.query(`
      WITH ticker_stats AS (
        SELECT
          upper(ticker) AS ticker,
          count(*) AS row_count,
          max(date) AS last_date
        FROM public.prices_daily
        WHERE close IS NOT NULL
          AND close > 0
        GROUP BY upper(ticker)
      )
      SELECT
        t.ticker,
        t.row_count,
        t.last_date,
        current_date - t.last_date AS days_since_last_update,
        s.is_active,
        CASE
          WHEN t.row_count < 100 THEN 'Not enough rows (needs 100, has ' || t.row_count || ')'
          WHEN t.last_date < current_date - interval '90 days' THEN 'Data too old (last update: ' || t.last_date || ')'
          WHEN s.is_active = false THEN 'Not active'
          ELSE 'Should be included!'
        END AS exclusion_reason
      FROM ticker_stats t
      LEFT JOIN public.stocks_latest s ON upper(s.ticker) = t.ticker
      WHERE t.ticker = 'HAVI'
    `);
    console.log(fullCheckResult.rows);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkHavi();
