#!/usr/bin/env tsx

/**
 * Batch Factor Calculation Script
 *
 * Calculates all 19 technical factors for stocks with 3+ years of data.
 * Run nightly after IBKR price updates at 1 AM.
 *
 * Target runtime: < 10 minutes for ~78 stocks
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') });

import { pool } from '../src/lib/db';
import {
  calculateTechnicalFactorsForDate,
  insertTechnicalFactors,
  type TechnicalFactors,
} from '../src/lib/factors';

const MIN_TRADING_DAYS = 756; // 3 years
const REQUIRED_LOOKBACK = 1008 + 50; // 36m momentum + buffer
const BETA_CALC_INTERVAL = 5; // Calculate beta every 5 days to save time

// Exclude indices, ETFs, and non-OSE tickers (only OSE-listed companies need ML predictions)
const EXCLUDED_TICKERS = new Set([
  'OBX', 'OSEBX', 'OSEAX',                          // Norwegian indices
  'DAX', 'ESTX50', 'NDX', 'SPX', 'VIX',             // International indices
  'SPY', 'QQQ', 'IWM', 'EFA', 'EWD', 'EWN',         // ETFs
  'GLD', 'SLV', 'USO', 'XLE', 'XOP', 'VGK',         // Commodity/sector ETFs
  'NORW', 'COPX', 'DBB', 'DBC',                      // More ETFs
  'EQNR.US', 'FRO.US', 'BORR.US', 'FLNG.US',        // US-listed duplicates
]);

interface StockCandidate {
  ticker: string;
  rows: number;
}

/**
 * Fetch all stocks with sufficient data for factor calculation
 */
async function getEligibleStocks(): Promise<StockCandidate[]> {
  const result = await pool.query<{ ticker: string; row_count: number }>(
    `
    SELECT
      ticker,
      COUNT(*) as row_count
    FROM prices_daily
    WHERE adj_close IS NOT NULL
      AND adj_close > 0
    GROUP BY ticker
    HAVING COUNT(*) >= $1
    ORDER BY ticker
    `,
    [MIN_TRADING_DAYS]
  );

  return result.rows
    .filter((row) => !EXCLUDED_TICKERS.has(row.ticker))
    .map((row) => ({
      ticker: row.ticker,
      rows: Number(row.row_count),
    }));
}

/**
 * Fetch price history for a ticker
 */
async function fetchPriceHistory(
  ticker: string,
  limit?: number
): Promise<Array<{ date: string; adjClose: number }>> {
  const query = `
    SELECT
      date::text,
      adj_close as "adjClose"
    FROM prices_daily
    WHERE ticker = $1
      AND adj_close IS NOT NULL
      AND adj_close > 0
    ORDER BY date DESC
    ${limit ? `LIMIT ${limit}` : ''}
  `;

  const result = await pool.query<{ date: string; adjClose: number }>(query, [ticker]);
  return result.rows.reverse(); // Oldest first for calculations
}

/**
 * Get existing factor dates to avoid recalculating
 */
async function getExistingFactorDates(ticker: string): Promise<Set<string>> {
  const result = await pool.query<{ date: string }>(
    `
    SELECT date::text
    FROM factor_technical
    WHERE ticker = $1
    `,
    [ticker]
  );

  return new Set(result.rows.map((row) => row.date));
}

/**
 * Calculate factors for a single ticker
 */
async function calculateFactorsForTicker(
  ticker: string,
  skipExisting: boolean = true
): Promise<{ success: boolean; calculated: number; skipped: number; errors: number; error?: string }> {
  try {
    console.log(`[${ticker}] Fetching price history...`);
    const prices = await fetchPriceHistory(ticker);

    if (prices.length < REQUIRED_LOOKBACK) {
      return {
        success: false,
        calculated: 0,
        skipped: 0,
        errors: 0,
        error: `Insufficient data: ${prices.length} rows (need ${REQUIRED_LOOKBACK})`,
      };
    }

    // Get existing dates if skipping
    const existingDates = skipExisting ? await getExistingFactorDates(ticker) : new Set<string>();

    console.log(`[${ticker}] Calculating factors for ${prices.length} dates...`);
    const factors: TechnicalFactors[] = [];
    let skipped = 0;

    // Start from index where we have sufficient lookback data
    for (let i = REQUIRED_LOOKBACK; i < prices.length; i++) {
      const date = prices[i].date;

      // Skip if already calculated
      if (existingDates.has(date)) {
        skipped++;
        continue;
      }

      // Calculate beta/IVOL every 5 days to save time, but ALWAYS on the last 5 dates
      // so the most recent factor row always has beta/ivol populated
      const isRecentDate = i >= prices.length - 5;
      const shouldCalculateBeta = isRecentDate || i % BETA_CALC_INTERVAL === 0;

      const factorData = await calculateTechnicalFactorsForDate(
        ticker,
        prices,
        i,
        shouldCalculateBeta
      );

      factors.push(factorData);

      // Progress indicator every 100 rows
      if (factors.length % 100 === 0) {
        console.log(`[${ticker}] Calculated ${factors.length} factors...`);
      }
    }

    if (factors.length === 0) {
      console.log(`[${ticker}] No new factors to insert (${skipped} already exist)`);
      return { success: true, calculated: 0, skipped, errors: 0 };
    }

    // Insert into database
    console.log(`[${ticker}] Inserting ${factors.length} factors into database...`);
    const { inserted, errors } = await insertTechnicalFactors(ticker, factors);

    console.log(
      `[${ticker}] ✓ Complete: ${inserted} inserted, ${skipped} skipped, ${errors} errors`
    );

    return {
      success: true,
      calculated: inserted,
      skipped,
      errors,
    };
  } catch (error: any) {
    console.error(`[${ticker}] ✗ Error:`, error.message);
    return {
      success: false,
      calculated: 0,
      skipped: 0,
      errors: 1,
      error: error.message,
    };
  }
}

/**
 * Process stocks in batches with concurrency limit
 */
async function processBatch(
  stocks: StockCandidate[],
  concurrency: number = 5
): Promise<{
  succeeded: number;
  failed: number;
  totalCalculated: number;
  totalSkipped: number;
  totalErrors: number;
}> {
  const results = {
    succeeded: 0,
    failed: 0,
    totalCalculated: 0,
    totalSkipped: 0,
    totalErrors: 0,
  };

  // Process in chunks of {concurrency}
  for (let i = 0; i < stocks.length; i += concurrency) {
    const chunk = stocks.slice(i, i + concurrency);
    console.log(
      `\n=== Processing batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(stocks.length / concurrency)} (${chunk.map((s) => s.ticker).join(', ')}) ===\n`
    );

    const chunkResults = await Promise.all(
      chunk.map((stock) => calculateFactorsForTicker(stock.ticker))
    );

    for (const result of chunkResults) {
      if (result.success) {
        results.succeeded++;
        results.totalCalculated += result.calculated;
        results.totalSkipped += result.skipped;
        results.totalErrors += result.errors;
      } else {
        results.failed++;
      }
    }
  }

  return results;
}

/**
 * Main execution
 */
async function main() {
  const startTime = Date.now();
  console.log('='.repeat(80));
  console.log('BATCH FACTOR CALCULATION');
  console.log('='.repeat(80));
  console.log(`Started at: ${new Date().toISOString()}\n`);

  try {
    // Get eligible stocks
    console.log('Fetching eligible stocks...');
    const stocks = await getEligibleStocks();
    console.log(`Found ${stocks.length} stocks with >= ${MIN_TRADING_DAYS} trading days\n`);

    if (stocks.length === 0) {
      console.log('No stocks to process. Exiting.');
      return;
    }

    // List all stocks
    console.log('Eligible stocks:');
    stocks.forEach((stock, index) => {
      console.log(`  ${index + 1}. ${stock.ticker.padEnd(15)} (${stock.rows} rows)`);
    });
    console.log('');

    // Process all stocks
    const results = await processBatch(stocks, 5);

    // Summary
    const endTime = Date.now();
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(80));
    console.log('BATCH CALCULATION COMPLETE');
    console.log('='.repeat(80));
    console.log(`Stocks processed: ${stocks.length}`);
    console.log(`  Succeeded: ${results.succeeded}`);
    console.log(`  Failed: ${results.failed}`);
    console.log(`Factors calculated: ${results.totalCalculated}`);
    console.log(`Factors skipped (existing): ${results.totalSkipped}`);
    console.log(`Errors during insertion: ${results.totalErrors}`);
    console.log(`Duration: ${durationSeconds}s`);
    console.log(`Completed at: ${new Date().toISOString()}`);
    console.log('='.repeat(80));

    process.exit(results.failed > 0 ? 1 : 0);
  } catch (error: any) {
    console.error('\n✗ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
