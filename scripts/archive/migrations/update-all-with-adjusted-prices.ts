#!/usr/bin/env tsx
/**
 * Update ALL stocks in database with proper adjusted prices
 * This should be run once to fix all historical data
 */
import { Pool } from "pg";
import { TWSClient } from "../packages/ibkr/src/tws-client";
import { SecType } from "@stoqey/ib";
import dotenv from "dotenv";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getAllOseStocks() {
  const result = await pool.query(`
    SELECT ticker, name, exchange, currency, sector
    FROM stocks
    WHERE exchange = 'OSE'
    AND currency = 'NOK'
    AND asset_type = 'equity'
    ORDER BY ticker
  `);
  return result.rows;
}

async function reimportWithAdjustedPrices(
  client: TWSClient,
  ticker: string,
  exchange: string,
  currency: string,
  duration: string = "10 Y"
) {
  console.log(`\n[${ticker}] Fetching adjusted prices...`);

  try {
    // Fetch adjusted prices
    const adjustedData = await client.getHistoricalData(
      ticker,
      exchange,
      duration,
      "1 day",
      SecType.STK,
      currency,
      true
    );

    // Fetch raw prices
    const rawData = await client.getHistoricalData(
      ticker,
      exchange,
      duration,
      "1 day",
      SecType.STK,
      currency,
      false
    );

    // Create maps
    const adjustedMap = new Map();
    adjustedData.forEach(bar => {
      const dateStr = bar.time.replace(/-/g, '').split(' ')[0];
      adjustedMap.set(dateStr, bar);
    });

    const rawMap = new Map();
    rawData.forEach(bar => {
      const dateStr = bar.time.replace(/-/g, '').split(' ')[0];
      rawMap.set(dateStr, bar);
    });

    // Delete existing data
    await pool.query(`DELETE FROM prices_daily WHERE ticker = $1`, [ticker]);

    // Insert combined data
    let inserted = 0;
    for (const [dateStr, rawBar] of rawMap.entries()) {
      const adjBar = adjustedMap.get(dateStr);
      if (!adjBar) continue;

      await pool.query(
        `INSERT INTO prices_daily (ticker, date, open, high, low, close, volume, adj_close, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ibkr')`,
        [
          ticker,
          dateStr,
          rawBar.open,
          rawBar.high,
          rawBar.low,
          rawBar.close,
          Math.round(rawBar.volume),
          adjBar.close,
        ]
      );
      inserted++;
    }

    const avgFactor = Array.from(rawMap.values()).reduce((sum, rawBar, i) => {
      const adjBar = adjustedMap.get(rawBar.time.replace(/-/g, '').split(' ')[0]);
      return sum + (adjBar ? (adjBar.close / rawBar.close) : 1);
    }, 0) / rawMap.size * 100;

    console.log(`[${ticker}] ✓ ${inserted} bars, avg adj factor: ${avgFactor.toFixed(2)}%`);
    return { success: true, bars: inserted, avgFactor };

  } catch (error: any) {
    console.error(`[${ticker}] ✗ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("UPDATE ALL STOCKS WITH ADJUSTED PRICES");
  console.log("=".repeat(70));

  const stocks = await getAllOseStocks();
  console.log(`\nFound ${stocks.length} OSE stocks to update\n`);

  const client = new TWSClient();

  try {
    await client.connect();
    console.log("✓ Connected to IB Gateway\n");

    const results = [];
    let count = 0;

    for (const stock of stocks) {
      count++;
      console.log(`[${count}/${stocks.length}] ${stock.ticker} (${stock.name})`);

      const result = await reimportWithAdjustedPrices(
        client,
        stock.ticker,
        stock.exchange,
        stock.currency
      );

      results.push({ ticker: stock.ticker, ...result });

      // Rate limiting
      await sleep(1000);
    }

    console.log("\n" + "=".repeat(70));
    console.log("UPDATE SUMMARY");
    console.log("=".repeat(70));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`\nTotal stocks: ${stocks.length}`);
    console.log(`Successfully updated: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);

    if (failed.length > 0) {
      console.log("\nFailed tickers:");
      failed.forEach(r => console.log(`  ${r.ticker}: ${r.error}`));
    }

    // Show stocks with high adjustment factors (likely high dividends)
    const highDividend = successful.filter(r => r.avgFactor < 90).sort((a, b) => a.avgFactor - b.avgFactor);
    if (highDividend.length > 0) {
      console.log("\nHigh dividend stocks (>10% adjustment):");
      highDividend.forEach(r => {
        console.log(`  ${r.ticker}: ${r.avgFactor.toFixed(2)}% (${(100 - r.avgFactor).toFixed(2)}% dividends)`);
      });
    }

  } catch (error) {
    console.error("Fatal error:", error);
  } finally {
    await client.disconnect();
    await pool.end();
  }
}

main();
