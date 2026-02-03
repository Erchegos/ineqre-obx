#!/usr/bin/env tsx
/**
 * Update a single stock with both raw and adjusted close prices
 */

import { Pool } from "pg";
import { TWSClient, SecType } from "../packages/ibkr/src/tws-client";
import dotenv from "dotenv";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function updateStock(ticker: string, exchange: string, currency: string = "NOK") {
  const client = new TWSClient();

  try {
    console.log(`\n=== Updating ${ticker} with Raw + Adjusted Prices ===`);
    console.log(`Time: ${new Date().toISOString()}\n`);

    console.log("Connecting to TWS...");
    await client.connect();
    console.log("✓ Connected to TWS\n");

    const duration = "10 Y"; // Get maximum historical data

    // Fetch BOTH raw and adjusted prices
    console.log(`[${ticker}] Fetching raw prices...`);
    const rawData = await client.importAsset(ticker, exchange, duration, {
      secType: SecType.STK,
      currency,
      adjusted: false, // Raw prices
    });

    console.log(`[${ticker}] Fetching adjusted prices...`);
    const adjData = await client.importAsset(ticker, exchange, duration, {
      secType: SecType.STK,
      currency,
      adjusted: true, // Dividend-adjusted prices
    });

    if (rawData.length === 0 || adjData.length === 0) {
      console.log(`✗ No data returned (raw: ${rawData.length}, adj: ${adjData.length})`);
      process.exit(1);
    }

    console.log(`\nMerging ${rawData.length} raw bars with ${adjData.length} adjusted bars...`);

    // Create a map of adjusted close prices by date
    const adjMap = new Map(adjData.map(d => [d.date, d.close]));

    // Insert prices with both raw and adjusted close
    let insertedCount = 0;
    let updatedCount = 0;
    let divAdjCount = 0;

    for (const price of rawData) {
      const adjClose = adjMap.get(price.date) || price.close;

      // Count records with dividend adjustments
      if (adjClose !== price.close) {
        divAdjCount++;
      }

      const result = await pool.query(
        `INSERT INTO prices_daily (ticker, date, open, high, low, close, adj_close, volume, source)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, 'ibkr')
         ON CONFLICT (ticker, date) DO UPDATE SET
           open = EXCLUDED.open,
           high = EXCLUDED.high,
           low = EXCLUDED.low,
           close = EXCLUDED.close,
           adj_close = EXCLUDED.adj_close,
           volume = EXCLUDED.volume
         RETURNING (xmax = 0) AS inserted`,
        [
          ticker,
          price.date,
          price.open,
          price.high,
          price.low,
          price.close, // Raw close price
          adjClose, // Dividend-adjusted close price
          price.volume
        ]
      );

      if (result.rows[0]?.inserted) {
        insertedCount++;
      } else {
        updatedCount++;
      }
    }

    const latest = rawData[rawData.length - 1];
    const adjLatest = adjMap.get(latest.date);

    console.log(`\n=== Summary ===`);
    console.log(`✓ Inserted: ${insertedCount} records`);
    console.log(`✓ Updated: ${updatedCount} records`);
    console.log(`✓ Records with dividend adjustments: ${divAdjCount} (${(divAdjCount/rawData.length*100).toFixed(1)}%)`);
    console.log(`✓ Latest date: ${latest.date}`);
    console.log(`✓ Latest close: ${latest.close} (raw), ${adjLatest} (adjusted)`);

    // Show sample of dividend adjustments
    if (divAdjCount > 0) {
      console.log(`\n=== Sample Dividend Adjustments ===`);
      const sampleCheck = await pool.query(`
        SELECT date, close, adj_close,
               ROUND(((close - adj_close) / close * 100)::numeric, 2) as diff_pct
        FROM prices_daily
        WHERE ticker = $1
          AND adj_close != close
        ORDER BY date DESC
        LIMIT 5
      `, [ticker]);

      sampleCheck.rows.forEach(row => {
        console.log(`  ${row.date.toISOString().slice(0,10)}: close=${row.close}, adj_close=${row.adj_close} (diff: ${row.diff_pct}%)`);
      });
    }

  } catch (error: any) {
    console.error(`\n✗ Error: ${error.message}`);
    process.exit(1);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// Get ticker from command line argument
const ticker = process.argv[2] || 'ORK';
const exchange = process.argv[3] || 'OSE';
const currency = process.argv[4] || 'NOK';

updateStock(ticker, exchange, currency);
