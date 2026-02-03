#!/usr/bin/env tsx

/**
 * Backfill Beta and IVOL for existing factor_technical rows
 *
 * The original batch calculation had a bug: OBX ticker was 'OBX.OSE' instead of 'OBX',
 * and Date objects were used as Map keys (reference equality fails).
 * Both bugs are now fixed in factors.ts. This script backfills the missing values.
 *
 * Usage:
 *   npx tsx scripts/backfill-beta-ivol.ts           # All stocks
 *   npx tsx scripts/backfill-beta-ivol.ts DNB        # Single stock
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { pool } from '../src/lib/db';
import { calculateBetaAndIVOL } from '../src/lib/factors';

const BETA_CALC_INTERVAL = 5; // Calculate every 5 days, forward-fill the rest

async function backfillTicker(ticker: string): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;

  // Get all dates with null beta for this ticker
  const result = await pool.query<{ date: string }>(
    `SELECT date::text FROM factor_technical
     WHERE ticker = $1 AND beta IS NULL
     ORDER BY date ASC`,
    [ticker]
  );

  const dates = result.rows.map(r => r.date);
  if (dates.length === 0) {
    console.log(`  [${ticker}] No null beta rows found`);
    return { updated: 0, errors: 0 };
  }

  console.log(`  [${ticker}] ${dates.length} rows need beta/ivol`);

  // Calculate beta every BETA_CALC_INTERVAL dates
  let lastBeta: number | null = null;
  let lastIvol: number | null = null;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];

    if (i % BETA_CALC_INTERVAL === 0) {
      // Actually calculate
      const { beta, ivol } = await calculateBetaAndIVOL(ticker, date);
      lastBeta = beta;
      lastIvol = ivol;
    }

    // Update DB (using calculated or forward-filled values)
    if (lastBeta !== null || lastIvol !== null) {
      try {
        await pool.query(
          `UPDATE factor_technical SET beta = $1, ivol = $2
           WHERE ticker = $3 AND date = $4`,
          [lastBeta, lastIvol, ticker, date]
        );
        updated++;
      } catch (err: any) {
        errors++;
        if (errors <= 3) console.error(`  [${ticker}] Error on ${date}:`, err.message);
      }
    }

    // Progress
    if ((i + 1) % 500 === 0) {
      console.log(`  [${ticker}] ${i + 1}/${dates.length} processed (beta=${lastBeta?.toFixed(3)})`);
    }
  }

  console.log(`  [${ticker}] Done: ${updated} updated, ${errors} errors, last beta=${lastBeta?.toFixed(3)}, ivol=${lastIvol?.toFixed(3)}`);
  return { updated, errors };
}

async function main() {
  const startTime = Date.now();
  const targetTicker = process.argv[2]?.toUpperCase();

  console.log('='.repeat(70));
  console.log('BACKFILL BETA/IVOL');
  console.log('='.repeat(70));

  // Check OBX data availability first
  const obxCheck = await pool.query(
    `SELECT COUNT(*) as cnt FROM prices_daily WHERE ticker = 'OBX' AND adj_close > 0`
  );
  console.log(`OBX market data: ${obxCheck.rows[0].cnt} rows`);

  if (parseInt(obxCheck.rows[0].cnt) < 200) {
    console.error('ERROR: Insufficient OBX data for beta calculation (need 200+ rows)');
    process.exit(1);
  }

  // Skip non-OSE tickers (indexes, ETFs, commodities, US-listed)
  const SKIP = new Set([
    'OBX','OSEBX','OSEAX','SPX','SPY','QQQ','IWM','NDX','VIX','DAX','ESTX50','HEX',
    'GLD','SLV','DBC','DBB','EFA','VGK','EWD','EWN','XLE','XOP','USO','COPX','NORW',
    '2020','KCC','BORR.US','BWLP.US','ECO.US','EQNR.US','FLNG.US','FRO.US','HAFN.US',
  ]);

  // Get tickers to process
  let tickers: string[];
  if (targetTicker) {
    tickers = [targetTicker];
  } else {
    const result = await pool.query<{ ticker: string }>(
      `SELECT DISTINCT ticker FROM factor_technical WHERE beta IS NULL ORDER BY ticker`
    );
    tickers = result.rows.map(r => r.ticker).filter(t => !SKIP.has(t));
  }

  console.log(`Processing ${tickers.length} tickers: ${tickers.join(', ')}\n`);

  let totalUpdated = 0;
  let totalErrors = 0;

  for (const ticker of tickers) {
    const { updated, errors } = await backfillTicker(ticker);
    totalUpdated += updated;
    totalErrors += errors;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${'='.repeat(70)}`);
  console.log(`COMPLETE: ${totalUpdated} rows updated, ${totalErrors} errors, ${duration}s`);
  console.log('='.repeat(70));

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
