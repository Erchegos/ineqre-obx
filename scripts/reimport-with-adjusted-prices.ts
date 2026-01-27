#!/usr/bin/env tsx
/**
 * Re-import stocks with proper adjusted close prices
 * Fetches both raw and adjusted prices from IB Gateway
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

async function reimportWithAdjustedPrices(
  client: TWSClient,
  ticker: string,
  exchange: string,
  currency: string,
  duration: string = "10 Y"
) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Re-importing: ${ticker} (${exchange}, ${currency})`);
  console.log(`${"=".repeat(70)}\n`);

  try {
    // Fetch adjusted prices (dividend-adjusted)
    console.log(`Fetching adjusted prices for ${ticker}...`);
    const adjustedData = await client.getHistoricalData(
      ticker,
      exchange,
      duration,
      "1 day",
      SecType.STK,
      currency,
      true // adjusted = true
    );
    console.log(`✓ Fetched ${adjustedData.length} adjusted bars`);

    // Fetch raw prices (unadjusted)
    console.log(`Fetching raw prices for ${ticker}...`);
    const rawData = await client.getHistoricalData(
      ticker,
      exchange,
      duration,
      "1 day",
      SecType.STK,
      currency,
      false // adjusted = false
    );
    console.log(`✓ Fetched ${rawData.length} raw bars\n`);

    // Create a map of date to prices
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

    // Delete existing data for this ticker
    await pool.query(
      `DELETE FROM prices_daily WHERE ticker = $1`,
      [ticker]
    );
    console.log(`✓ Deleted existing price data for ${ticker}`);

    // Insert combined data
    let inserted = 0;
    for (const [dateStr, rawBar] of rawMap.entries()) {
      const adjBar = adjustedMap.get(dateStr);

      if (!adjBar) {
        console.warn(`⚠ No adjusted data for ${dateStr}, skipping`);
        continue;
      }

      await pool.query(
        `INSERT INTO prices_daily (ticker, date, open, high, low, close, volume, adj_close, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ibkr')`,
        [
          ticker,
          dateStr,
          rawBar.open,
          rawBar.high,
          rawBar.low,
          rawBar.close, // Raw close
          Math.round(rawBar.volume),
          adjBar.close, // Adjusted close from adjusted data
        ]
      );
      inserted++;
    }

    console.log(`✓ Inserted ${inserted} price records with proper adjustments\n`);

    // Show adjustment factor example
    const sampleDate = Array.from(rawMap.keys())[Math.floor(rawMap.size / 2)];
    const sampleRaw = rawMap.get(sampleDate);
    const sampleAdj = adjustedMap.get(sampleDate);
    if (sampleRaw && sampleAdj) {
      const adjFactor = (sampleAdj.close / sampleRaw.close * 100).toFixed(4);
      console.log(`Sample adjustment factor (mid-period):`);
      console.log(`  Date: ${sampleDate}`);
      console.log(`  Raw close: ${sampleRaw.close.toFixed(2)} ${currency}`);
      console.log(`  Adj close: ${sampleAdj.close.toFixed(2)} ${currency}`);
      console.log(`  Factor: ${adjFactor}%\n`);
    }

    return { success: true, bars: inserted };

  } catch (error: any) {
    console.error(`✗ Error re-importing ${ticker}:`, error.message);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("RE-IMPORT STOCKS WITH ADJUSTED PRICES");
  console.log("=".repeat(70));

  // Stocks to re-import with adjusted prices
  const stocks = [
    { ticker: "EQNR", exchange: "OSE", currency: "NOK" },
    { ticker: "FRO", exchange: "OSE", currency: "NOK" },
    { ticker: "DNB", exchange: "OSE", currency: "NOK" },
    { ticker: "MOWI", exchange: "OSE", currency: "NOK" },
    { ticker: "YAR", exchange: "OSE", currency: "NOK" },
    { ticker: "NHY", exchange: "OSE", currency: "NOK" },
  ];

  const client = new TWSClient();

  try {
    await client.connect();
    console.log("\n✓ Connected to IB Gateway\n");

    const results = [];

    for (const stock of stocks) {
      const result = await reimportWithAdjustedPrices(
        client,
        stock.ticker,
        stock.exchange,
        stock.currency
      );
      results.push({ ...stock, ...result });

      // Rate limiting
      await sleep(1000);
    }

    console.log("\n" + "=".repeat(70));
    console.log("RE-IMPORT SUMMARY");
    console.log("=".repeat(70));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`\nTotal stocks: ${stocks.length}`);
    console.log(`Successfully re-imported: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);

    if (successful.length > 0) {
      console.log("\n✓ Successfully re-imported:");
      successful.forEach(r => {
        console.log(`  ${r.ticker} (${r.exchange}, ${r.currency}): ${r.bars} bars`);
      });
    }

    if (failed.length > 0) {
      console.log("\n✗ Failed:");
      failed.forEach(r => {
        console.log(`  ${r.ticker}: ${r.error}`);
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
