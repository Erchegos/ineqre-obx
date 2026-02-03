#!/usr/bin/env tsx
/**
 * Update Tier B & C Equities with Extended Historical Data
 *
 * This script:
 * 1. Focuses on Tier B & C equities that need more historical data
 * 2. Updates all equities missing Jan 29-30, 2026 data
 * 3. Fetches both raw and adjusted close prices from IBKR
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

interface StockInfo {
  ticker: string;
  name: string;
  exchange: string;
  currency: string;
  tier: string;
  last_date: string | null;
  data_count: number;
  completeness: number;
}

async function getTargetStocks(): Promise<StockInfo[]> {
  // Get Tier B & C equities, plus any equity missing recent data
  const result = await pool.query(`
    WITH stock_stats AS (
      SELECT
        s.ticker,
        s.name,
        s.exchange,
        s.currency,
        CASE
          WHEN COUNT(p.date) >= 3000 THEN 'A'
          WHEN COUNT(p.date) >= 1500 THEN 'B'
          ELSE 'C'
        END as tier,
        MAX(p.date) as last_date,
        COUNT(p.date) as data_count,
        ROUND(((COUNT(p.date)::float /
          GREATEST(1, EXTRACT(DAY FROM NOW() - MIN(p.date))::int)) * 100)::numeric, 1) as completeness
      FROM stocks s
      LEFT JOIN prices_daily p ON s.ticker = p.ticker
      WHERE s.is_active = true
        AND s.asset_type = 'equity'
      GROUP BY s.ticker, s.name, s.exchange, s.currency
    )
    SELECT *
    FROM stock_stats
    WHERE tier IN ('B', 'C')
       OR last_date < '2026-01-29'
       OR last_date IS NULL
    ORDER BY
      CASE tier
        WHEN 'C' THEN 1
        WHEN 'B' THEN 2
        ELSE 3
      END,
      completeness ASC
  `);

  return result.rows;
}

async function updateStockData(
  client: TWSClient,
  stock: StockInfo,
  mode: 'recent' | 'historical'
): Promise<boolean> {
  try {
    const duration = mode === 'recent' ? '5 D' : '1 Y';
    console.log(`[${stock.ticker}] Fetching ${mode} data (raw + adjusted) from ${stock.exchange}...`);

    // Use SMART for US stocks
    const exchange = stock.currency === 'USD' ? 'SMART' : stock.exchange;

    // Fetch BOTH raw and adjusted prices
    const [rawData, adjData] = await Promise.all([
      client.importAsset(stock.ticker, exchange, duration, {
        secType: SecType.STK,
        currency: stock.currency || "NOK",
        adjusted: false, // Raw prices
      }),
      client.importAsset(stock.ticker, exchange, duration, {
        secType: SecType.STK,
        currency: stock.currency || "NOK",
        adjusted: true, // Dividend-adjusted prices
      })
    ]);

    if (rawData.length === 0 || adjData.length === 0) {
      console.log(`[${stock.ticker}] ✗ No data returned (raw: ${rawData.length}, adj: ${adjData.length})`);
      return false;
    }

    // Create a map of adjusted close prices by date
    const adjMap = new Map(adjData.map(d => [d.date, d.close]));

    // Insert prices with both raw and adjusted close
    let insertedCount = 0;
    for (const price of rawData) {
      const adjClose = adjMap.get(price.date) || price.close;

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
         RETURNING date`,
        [
          price.ticker,
          price.date,
          price.open,
          price.high,
          price.low,
          price.close, // Raw close price
          adjClose, // Dividend-adjusted close price
          price.volume
        ]
      );
      if (result.rowCount && result.rowCount > 0) insertedCount++;
    }

    const latest = rawData[rawData.length - 1];
    const adjLatest = adjMap.get(latest.date);
    const hasDivAdj = adjLatest && adjLatest !== latest.close;
    console.log(`[${stock.ticker}] ✓ Updated ${insertedCount}/${rawData.length} bars (latest: ${latest.date}) ${hasDivAdj ? '[HAS DIV ADJ]' : ''} [Tier ${stock.tier}]`);
    return true;
  } catch (error: any) {
    console.log(`[${stock.ticker}] ✗ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log("=== Tier B & C Equity Data Update ===");
  console.log(`Time: ${new Date().toISOString()}\n`);

  const client = new TWSClient();

  try {
    console.log("Connecting to TWS...");
    await client.connect();
    console.log("✓ Connected to TWS\n");

    const targetStocks = await getTargetStocks();
    console.log(`Found ${targetStocks.length} stocks needing update\n`);

    // Separate into categories
    const tierC = targetStocks.filter(s => s.tier === 'C');
    const tierB = targetStocks.filter(s => s.tier === 'B');
    const missingRecent = targetStocks.filter(s => !s.last_date || s.last_date < '2026-01-29');

    console.log(`Tier C: ${tierC.length} stocks`);
    console.log(`Tier B: ${tierB.length} stocks`);
    console.log(`Missing recent data: ${missingRecent.length} stocks\n`);

    let successCount = 0;
    let failCount = 0;

    // Process each stock
    for (const stock of targetStocks) {
      // Determine if we need historical or just recent data
      const needsHistorical = stock.tier === 'C' || stock.tier === 'B';
      const mode = needsHistorical ? 'historical' : 'recent';

      const success = await updateStockData(client, stock, mode);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log("\n=== Update Summary ===");
    console.log(`✓ Success: ${successCount}/${targetStocks.length}`);
    console.log(`✗ Failed: ${failCount}/${targetStocks.length}`);

    // Show updated tier distribution
    const tierUpdate = await pool.query(`
      WITH stock_stats AS (
        SELECT
          s.ticker,
          CASE
            WHEN COUNT(p.date) >= 3000 THEN 'A'
            WHEN COUNT(p.date) >= 1500 THEN 'B'
            ELSE 'C'
          END as tier
        FROM stocks s
        LEFT JOIN prices_daily p ON s.ticker = p.ticker
        WHERE s.is_active = true AND s.asset_type = 'equity'
        GROUP BY s.ticker
      )
      SELECT tier, COUNT(*) as count
      FROM stock_stats
      GROUP BY tier
      ORDER BY tier
    `);

    console.log("\n=== Updated Tier Distribution ===");
    tierUpdate.rows.forEach(row => {
      console.log(`Tier ${row.tier}: ${row.count} stocks`);
    });

  } catch (error) {
    console.error("\n✗ Fatal error:", error);
    process.exit(1);
  } finally {
    await client.disconnect();
    await pool.end();
  }
}

main();
