#!/usr/bin/env tsx

/**
 * Calculate NOK Volume and store in factor_fundamentals
 *
 * NOK Volume = 20-day average of (close * volume)
 * Calculated from existing price data, no IBKR connection needed.
 *
 * Usage:
 *   npx tsx scripts/calculate-nokvol.ts           # All stocks with factor data
 *   npx tsx scripts/calculate-nokvol.ts DNB        # Single stock
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { pool } from '../src/lib/db';
import { calculateNOKVolume } from '../src/lib/factors';

async function calculateForTicker(ticker: string): Promise<{ inserted: number; errors: number }> {
  let inserted = 0;
  let errors = 0;

  // Get all dates from factor_technical for this ticker
  const factorDates = await pool.query<{ date: string }>(
    `SELECT date::text FROM factor_technical WHERE ticker = $1 ORDER BY date ASC`,
    [ticker]
  );

  if (factorDates.rows.length === 0) {
    console.log(`  [${ticker}] No factor_technical rows found`);
    return { inserted: 0, errors: 0 };
  }

  // Check what's already in factor_fundamentals
  const existingDates = await pool.query<{ date: string }>(
    `SELECT date::text FROM factor_fundamentals WHERE ticker = $1 AND nokvol IS NOT NULL`,
    [ticker]
  );
  const existingSet = new Set(existingDates.rows.map(r => r.date));

  // Get price data with close and volume
  const priceResult = await pool.query<{ date: string; close: number; volume: number }>(
    `SELECT date::text, close, volume::int
     FROM prices_daily
     WHERE ticker = $1 AND close > 0 AND volume > 0
     ORDER BY date ASC`,
    [ticker]
  );

  const prices = priceResult.rows.map(r => ({
    date: r.date,
    close: parseFloat(String(r.close)),
    volume: Number(r.volume),
  }));

  if (prices.length < 20) {
    console.log(`  [${ticker}] Insufficient price data (${prices.length} rows)`);
    return { inserted: 0, errors: 0 };
  }

  // Build date-to-index map for fast lookup
  const dateToIndex = new Map<string, number>();
  for (let i = 0; i < prices.length; i++) {
    dateToIndex.set(prices[i].date, i);
  }

  // Calculate NOK volume for each factor date
  const batch: Array<{ date: string; nokvol: number }> = [];

  for (const row of factorDates.rows) {
    if (existingSet.has(row.date)) continue;

    const idx = dateToIndex.get(row.date);
    if (idx === undefined || idx < 20) continue;

    const nokvol = calculateNOKVolume(prices, idx);
    if (nokvol !== null) {
      batch.push({ date: row.date, nokvol });
    }
  }

  if (batch.length === 0) {
    console.log(`  [${ticker}] No new NOK volume rows to insert`);
    return { inserted: 0, errors: 0 };
  }

  console.log(`  [${ticker}] Inserting ${batch.length} NOK volume rows...`);

  // Batch insert into factor_fundamentals
  for (const item of batch) {
    try {
      await pool.query(
        `INSERT INTO factor_fundamentals (ticker, date, nokvol)
         VALUES ($1, $2, $3)
         ON CONFLICT (ticker, date) DO UPDATE SET nokvol = EXCLUDED.nokvol`,
        [ticker, item.date, item.nokvol]
      );
      inserted++;
    } catch (err: any) {
      errors++;
      if (errors <= 3) console.error(`  [${ticker}] Error on ${item.date}:`, err.message);
    }
  }

  console.log(`  [${ticker}] Done: ${inserted} inserted, ${errors} errors`);
  return { inserted, errors };
}

async function main() {
  const startTime = Date.now();
  const targetTicker = process.argv[2]?.toUpperCase();

  console.log('='.repeat(70));
  console.log('CALCULATE NOK VOLUME');
  console.log('='.repeat(70));

  // Skip non-OSE tickers (indexes, ETFs, commodities, US-listed)
  const SKIP = new Set([
    'OBX','OSEBX','OSEAX','SPX','SPY','QQQ','IWM','NDX','VIX','DAX','ESTX50','HEX',
    'GLD','SLV','DBC','DBB','EFA','VGK','EWD','EWN','XLE','XOP','USO','COPX','NORW',
    '2020','KCC','BORR.US','BWLP.US','ECO.US','EQNR.US','FLNG.US','FRO.US','HAFN.US',
  ]);

  let tickers: string[];
  if (targetTicker) {
    tickers = [targetTicker];
  } else {
    const result = await pool.query<{ ticker: string }>(
      `SELECT DISTINCT ticker FROM factor_technical ORDER BY ticker`
    );
    tickers = result.rows.map(r => r.ticker).filter(t => !SKIP.has(t));
  }

  console.log(`Processing ${tickers.length} tickers\n`);

  let totalInserted = 0;
  let totalErrors = 0;

  for (const ticker of tickers) {
    const { inserted, errors } = await calculateForTicker(ticker);
    totalInserted += inserted;
    totalErrors += errors;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${'='.repeat(70)}`);
  console.log(`COMPLETE: ${totalInserted} rows inserted, ${totalErrors} errors, ${duration}s`);
  console.log('='.repeat(70));

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
