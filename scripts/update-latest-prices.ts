#!/usr/bin/env tsx
/**
 * Update all stocks with the latest closing prices from IBKR
 * Fetches the most recent data and updates the database
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
});

async function getAllTickers(): Promise<string[]> {
  const result = await pool.query('SELECT DISTINCT ticker FROM prices_daily ORDER BY ticker');
  return result.rows.map(row => row.ticker);
}

async function updateTickerData(client: TWSClient, ticker: string): Promise<{ updated: number; latestDate: string }> {
  // Fetch last 10 days to ensure we get latest data
  const historicalData = await client.getHistoricalData(
    ticker,
    "OSE",
    "10 D",
    "1 day",
    SecType.STK,
    "NOK"
  );

  if (!historicalData || historicalData.length === 0) {
    throw new Error("No data returned");
  }

  let updatedCount = 0;
  let latestDate = "";

  for (const bar of historicalData) {
    try {
      const volumeInt = Math.round(bar.volume); // Convert to integer
      const result = await pool.query(`
        INSERT INTO prices_daily (ticker, date, open, high, low, close, volume, adj_close, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ibkr')
        ON CONFLICT (ticker, date, source) DO UPDATE SET
          open = EXCLUDED.open,
          high = EXCLUDED.high,
          low = EXCLUDED.low,
          close = EXCLUDED.close,
          volume = EXCLUDED.volume,
          adj_close = EXCLUDED.adj_close
      `, [
        ticker,
        bar.time,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        volumeInt,
        bar.close
      ]);

      if (result.rowCount && result.rowCount > 0) {
        updatedCount++;
        if (bar.time > latestDate) {
          latestDate = bar.time;
        }
      }
    } catch (e: any) {
      // Skip errors silently
    }
  }

  return { updated: updatedCount, latestDate };
}

async function main() {
  console.log("Updating all stocks with latest closing prices...\n");

  const client = new TWSClient();

  try {
    // Get all tickers from database
    const tickers = await getAllTickers();
    console.log(`Found ${tickers.length} tickers to update\n`);

    await client.connect();
    console.log("[OK] Connected to IB Gateway\n");

    const results: { ticker: string; success: boolean; updated?: number; latestDate?: string; error?: string }[] = [];

    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i];
      process.stdout.write(`[${i + 1}/${tickers.length}] Updating ${ticker}...`);

      try {
        const { updated, latestDate } = await updateTickerData(client, ticker);
        results.push({ ticker, success: true, updated, latestDate });
        console.log(` OK (${updated} rows, latest: ${latestDate})`);
      } catch (e: any) {
        results.push({ ticker, success: false, error: e.message });
        console.log(` FAILED (${e.message})`);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("UPDATE SUMMARY");
    console.log("=".repeat(70));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`Total tickers: ${tickers.length}`);
    console.log(`Successfully updated: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);

    // Find latest date across all tickers
    const latestDates = successful.map(r => r.latestDate).filter(Boolean).sort().reverse();
    if (latestDates.length > 0) {
      console.log(`\nMost recent data date: ${latestDates[0]}`);
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
