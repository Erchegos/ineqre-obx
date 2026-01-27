#!/usr/bin/env tsx
/**
 * Import historical data for newly discovered OSE stocks
 * Fetches 5+ years of daily data from IBKR and imports to database
 */

import { TWSClient } from "../packages/ibkr/src/tws-client";
import { Pool } from "pg";
import { SecType } from "@stoqey/ib";
import dotenv from "dotenv";

dotenv.config();

// Disable SSL cert validation for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 60000,
  max: 10,
});

// New tickers to import (from discovery script)
// Already imported: NONG, PARB, AKSO, BWO, SOFF, BONHR, ODF, HUNT, KCC, KID, AKVA, MULTI, PHO, NEXT
const NEW_TICKERS = [
  "IDEX", "OTEC", "PEXIP", "PCIB", "MEDI", "GSF",
  "ENDUR", "KMCP", "BOUV", "ABG", "NORBT", "NEL", "NAPA", "KOA", "2020", "ABL",
  "ARCH", "AKAST"
];

async function ensureStockExists(ticker: string, name?: string): Promise<void> {
  await pool.query(`
    INSERT INTO stocks (ticker, name, currency, exchange, is_active)
    VALUES ($1, $2, 'NOK', 'OSE', true)
    ON CONFLICT (ticker) DO NOTHING
  `, [ticker, name || ticker]);
}

async function importTickerData(client: TWSClient, ticker: string): Promise<number> {
  console.log(`  Fetching historical data...`);

  const historicalData = await client.getHistoricalData(
    ticker,
    "OSE",
    "10 Y",  // Try to get as much data as possible
    "1 day",
    SecType.STK,
    "NOK"
  );

  if (!historicalData || historicalData.length === 0) {
    throw new Error("No historical data returned");
  }

  console.log(`  Got ${historicalData.length} days of data, inserting in batches...`);

  // Batch inserts (100 rows at a time)
  const BATCH_SIZE = 100;
  let insertedCount = 0;

  for (let i = 0; i < historicalData.length; i += BATCH_SIZE) {
    const batch = historicalData.slice(i, i + BATCH_SIZE);

    // Build batch insert query
    const values: any[] = [];
    const placeholders: string[] = [];

    batch.forEach((bar, idx) => {
      const offset = idx * 8;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, 'ibkr')`);
      // Convert volume to integer (IBKR sometimes returns floats)
      const volumeInt = Math.round(bar.volume);
      values.push(ticker, bar.time, bar.open, bar.high, bar.low, bar.close, volumeInt, bar.close);
    });

    try {
      await pool.query(`
        INSERT INTO prices_daily (ticker, date, open, high, low, close, volume, adj_close, source)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (ticker, date, source) DO UPDATE SET
          open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
          close = EXCLUDED.close, volume = EXCLUDED.volume, adj_close = EXCLUDED.adj_close
      `, values);
      insertedCount += batch.length;
    } catch (e: any) {
      console.log(`    Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${e.message}`);
    }
  }
  console.log(`  Inserted ${insertedCount} rows`)

  return insertedCount;
}

async function main() {
  console.log(`Importing historical data for ${NEW_TICKERS.length} new stocks...\n`);

  const client = new TWSClient();
  const results: { ticker: string; success: boolean; rows?: number; error?: string }[] = [];

  try {
    await client.connect();
    console.log("[OK] Connected to IB Gateway\n");

    for (let i = 0; i < NEW_TICKERS.length; i++) {
      const ticker = NEW_TICKERS[i];
      console.log(`[${i + 1}/${NEW_TICKERS.length}] Importing ${ticker}...`);

      try {
        // First ensure the stock exists in the stocks table
        await ensureStockExists(ticker);
        const rows = await importTickerData(client, ticker);
        results.push({ ticker, success: true, rows });
        console.log(`  [OK] Imported ${rows} rows\n`);
      } catch (e: any) {
        results.push({ ticker, success: false, error: e.message });
        console.log(`  [FAILED] ${e.message}\n`);
      }

      // Rate limiting - wait between requests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Summary
    console.log("=".repeat(70));
    console.log("IMPORT SUMMARY");
    console.log("=".repeat(70));
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`Total: ${NEW_TICKERS.length}`);
    console.log(`Successful: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);

    if (successful.length > 0) {
      console.log(`\nTotal rows imported: ${successful.reduce((sum, r) => sum + (r.rows || 0), 0)}`);
    }

    if (failed.length > 0) {
      console.log("\nFailed tickers:");
      failed.forEach(r => console.log(`  - ${r.ticker}: ${r.error}`));
    }

  } catch (error: any) {
    console.error("[ERROR]", error.message);
  } finally {
    await client.disconnect();
    await pool.end();
  }
}

main();
