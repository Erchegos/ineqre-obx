#!/usr/bin/env tsx
import { Pool } from "pg";
import { TWSClient, SecType } from "../packages/ibkr/src/tws-client";
import dotenv from "dotenv";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

interface TickerInfo {
  ticker: string;
  exchange: string;
  currency: string;
  asset_type: string;
  last_update: string | null;
  days_old: number;
}

async function getStaleStocks(): Promise<TickerInfo[]> {
  const result = await pool.query(`
    SELECT
      s.ticker,
      s.exchange,
      s.currency,
      s.asset_type,
      MAX(p.date) as last_update,
      EXTRACT(DAY FROM NOW() - MAX(p.date))::integer as days_old
    FROM stocks s
    LEFT JOIN prices_daily p ON s.ticker = p.ticker
    WHERE s.is_active = true
    GROUP BY s.ticker, s.exchange, s.currency, s.asset_type
    HAVING MAX(p.date) IS NULL OR MAX(p.date) < CURRENT_DATE - INTERVAL '1 day'
    ORDER BY days_old DESC NULLS FIRST
    LIMIT 20
  `);
  return result.rows;
}

async function updateStock(client: TWSClient, stock: TickerInfo): Promise<boolean> {
  try {
    console.log(`[${stock.ticker}] Fetching data from ${stock.exchange}...`);

    // Use SMART exchange for US stocks/ETFs, otherwise use the configured exchange
    const exchange = stock.exchange === 'NYSE' || stock.exchange === 'NASDAQ' || stock.currency === 'USD'
      ? 'SMART'
      : stock.exchange;

    const priceData = await client.importAsset(stock.ticker, exchange, "5 D", {
      secType: SecType.STK,
      currency: stock.currency || "NOK",
    });

    if (priceData.length === 0) {
      console.log(`[${stock.ticker}] ✗ No data returned`);
      return false;
    }

    // Insert prices into database
    for (const price of priceData) {
      await pool.query(
        `INSERT INTO prices_daily (ticker, date, open, high, low, close, volume, source)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, 'ibkr')
         ON CONFLICT (ticker, date) DO UPDATE SET
           open = EXCLUDED.open,
           high = EXCLUDED.high,
           low = EXCLUDED.low,
           close = EXCLUDED.close,
           volume = EXCLUDED.volume`,
        [price.ticker, price.date, price.open, price.high, price.low, price.close, price.volume]
      );
    }

    const latest = priceData[priceData.length - 1];
    console.log(`[${stock.ticker}] ✓ Updated with ${priceData.length} bars (latest: ${latest.date})`);
    return true;
  } catch (error: any) {
    console.log(`[${stock.ticker}] ✗ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log("=== Stock Data Update ===");
  console.log(`Time: ${new Date().toISOString()}\n`);

  const client = new TWSClient();

  try {
    console.log("Connecting to TWS...");
    await client.connect();
    console.log("✓ Connected to TWS\n");

    const staleStocks = await getStaleStocks();
    console.log(`Found ${staleStocks.length} stocks needing update\n`);

    let successCount = 0;
    let failCount = 0;

    for (const stock of staleStocks) {
      const success = await updateStock(client, stock);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log("\n=== Update Summary ===");
    console.log(`✓ Success: ${successCount}/${staleStocks.length}`);
    console.log(`✗ Failed: ${failCount}/${staleStocks.length}`);

  } catch (error) {
    console.error("\n✗ Fatal error:", error);
    process.exit(1);
  } finally {
    await client.disconnect();
    await pool.end();
  }
}

main();
