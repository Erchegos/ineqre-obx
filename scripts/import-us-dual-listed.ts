#!/usr/bin/env tsx
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

interface USStock {
  ticker: string;
  name: string;
  sector: string;
  exchange: string;
  currency: string;
  asset_type: string;
}

// US-listed versions of dual-listed stocks (use .US suffix to avoid collision with OSE versions)
const usStocks: USStock[] = [
  {
    ticker: "BORR.US",
    name: "Borr Drilling Ltd (Dual Listed US)",
    sector: "Shipping",
    exchange: "NYSE",
    currency: "USD",
    asset_type: "equity"
  },
  {
    ticker: "BWLP.US",
    name: "BW LPG Ltd (Dual Listed US)",
    sector: "Shipping",
    exchange: "NYSE",
    currency: "USD",
    asset_type: "equity"
  },
  {
    ticker: "CDLR",
    name: "Cadeler A/S (Dual Listed US)",
    sector: "Shipping",
    exchange: "NYSE",
    currency: "USD",
    asset_type: "equity"
  },
  {
    ticker: "ECO.US",
    name: "Okeanis Eco Tankers Corp (Dual Listed US)",
    sector: "Shipping",
    exchange: "NYSE",
    currency: "USD",
    asset_type: "equity"
  },
  {
    ticker: "HAFN.US",
    name: "Hafnia Ltd (Dual Listed US)",
    sector: "Shipping",
    exchange: "NYSE",
    currency: "USD",
    asset_type: "equity"
  },
  {
    ticker: "HSHP.US",
    name: "Hamilton Shipping Partners (Dual Listed US)",
    sector: "Shipping",
    exchange: "NYSE",
    currency: "USD",
    asset_type: "equity"
  },
  {
    ticker: "EQNR.US",
    name: "Equinor ASA (Dual Listed US)",
    sector: "Energy",
    exchange: "NYSE",
    currency: "USD",
    asset_type: "equity"
  },
  {
    ticker: "FRO.US",
    name: "Frontline Ltd (Dual Listed US)",
    sector: "Shipping",
    exchange: "NYSE",
    currency: "USD",
    asset_type: "equity"
  }
];

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function insertStock(stock: USStock) {
  await pool.query(
    `INSERT INTO stocks (ticker, name, sector, exchange, currency, asset_type, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     ON CONFLICT (ticker) DO UPDATE SET
       name = EXCLUDED.name,
       sector = EXCLUDED.sector,
       exchange = EXCLUDED.exchange,
       currency = EXCLUDED.currency,
       asset_type = EXCLUDED.asset_type`,
    [stock.ticker, stock.name, stock.sector, stock.exchange, stock.currency, stock.asset_type]
  );
}

async function insertPriceData(ticker: string, bar: any) {
  const dateStr = bar.time.replace(/-/g, '');

  await pool.query(
    `INSERT INTO prices_daily (ticker, date, open, high, low, close, volume, adj_close, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ibkr')
     ON CONFLICT (ticker, date, source) DO UPDATE SET
       open = EXCLUDED.open,
       high = EXCLUDED.high,
       low = EXCLUDED.low,
       close = EXCLUDED.close,
       volume = EXCLUDED.volume,
       adj_close = EXCLUDED.adj_close`,
    [
      ticker,
      dateStr,
      bar.open,
      bar.high,
      bar.low,
      bar.close,
      Math.round(bar.volume),
      bar.close,
    ]
  );
}

async function main() {
  const client = new TWSClient();

  try {
    console.log("Connecting to IB Gateway...");
    await client.connect();
    console.log("✓ Connected to IB Gateway\n");

    const results: { ticker: string; success: boolean; bars?: number; error?: string }[] = [];

    for (const stock of usStocks) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`Processing: ${stock.ticker} (${stock.name})`);
      console.log(`Exchange: ${stock.exchange}, Currency: ${stock.currency}`);
      console.log(`${"=".repeat(60)}\n`);

      try {
        // For IB fetch, use plain ticker (IB doesn't recognize .US suffix)
        const ibTicker = stock.ticker.replace('.US', '');

        // Fetch US version using SMART routing
        console.log(`Fetching ${ibTicker} from US markets (storing as ${stock.ticker})...`);
        const usData = await client.getHistoricalData(
          ibTicker,
          "SMART",
          "10 Y",
          "1 day",
          SecType.STK,
          stock.currency
        );

        console.log(`✓ Fetched ${usData.length} bars for ${ibTicker}`);

        // Insert stock master record (with .US suffix)
        await insertStock(stock);
        console.log(`✓ Inserted stock record: ${stock.ticker}`);

        // Insert price data (with .US suffix)
        for (const bar of usData) {
          await insertPriceData(stock.ticker, bar);
        }
        console.log(`✓ Inserted ${usData.length} price records for ${stock.ticker}\n`);

        results.push({ ticker: stock.ticker, success: true, bars: usData.length });

      } catch (error: any) {
        console.error(`✗ Error fetching ${stock.ticker}:`, error.message);
        results.push({ ticker: stock.ticker, success: false, error: error.message });
        continue;
      }

      // Rate limiting
      await sleep(500);
    }

    console.log("\n" + "=".repeat(60));
    console.log("IMPORT COMPLETE");
    console.log("=".repeat(60));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`\nTotal stocks: ${usStocks.length}`);
    console.log(`Successfully imported: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);

    if (successful.length > 0) {
      console.log("\n✓ Successfully imported:");
      successful.forEach(r => {
        console.log(`  ${r.ticker}: ${r.bars} bars`);
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
