#!/usr/bin/env tsx
/**
 * Import OSE versions of dual-listed stocks with RAW + ADJUSTED prices
 * These stocks also trade on NYSE but we need the Norwegian versions too
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

interface StockInfo {
  ticker: string;
  usTicker: string;
  name: string;
  sector: string;
  exchange: string;
  currency: string;
  asset_type: string;
}

// OSE versions of dual-listed stocks (US tickers get .US suffix)
const oseStocks: StockInfo[] = [
  {
    ticker: "FRO",
    usTicker: "FRO.US",
    name: "Frontline Ltd",
    sector: "Shipping",
    exchange: "OSE",
    currency: "NOK",
    asset_type: "equity"
  },
  {
    ticker: "EQNR",
    usTicker: "EQNR.US",
    name: "Equinor ASA",
    sector: "Energy",
    exchange: "OSE",
    currency: "NOK",
    asset_type: "equity"
  },
  {
    ticker: "BORR",
    usTicker: "BORR.US",
    name: "Borr Drilling Ltd",
    sector: "Shipping",
    exchange: "OSE",
    currency: "NOK",
    asset_type: "equity"
  },
  {
    ticker: "BWLPG",
    usTicker: "BWLP.US",
    name: "BW LPG Ltd",
    sector: "Shipping",
    exchange: "OSE",
    currency: "NOK",
    asset_type: "equity"
  },
  {
    ticker: "ECO",
    usTicker: "ECO.US",
    name: "Okeanis Eco Tankers Corp",
    sector: "Shipping",
    exchange: "OSE",
    currency: "NOK",
    asset_type: "equity"
  },
  {
    ticker: "HAFNI",
    usTicker: "HAFN.US",
    name: "Hafnia Ltd",
    sector: "Shipping",
    exchange: "OSE",
    currency: "NOK",
    asset_type: "equity"
  },
  {
    ticker: "FLNG",
    usTicker: "FLNG.US",
    name: "Flex LNG Ltd",
    sector: "Shipping/LNG",
    exchange: "OSE",
    currency: "NOK",
    asset_type: "equity"
  }
];

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function insertStock(stock: StockInfo) {
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
      bar.adjClose || bar.close, // Use adjClose if available, fallback to close
    ]
  );
}

async function main() {
  console.log("=".repeat(70));
  console.log("IMPORTING OSE DUAL-LISTED STOCKS (RAW + ADJUSTED PRICES)");
  console.log("=".repeat(70));
  console.log("\nNote: US versions should already have .US suffix\n");

  const client = new TWSClient({ requestTimeout: 120000 });

  try {
    await client.connect();
    console.log("✓ Connected to IB Gateway\n");

    const results: { ticker: string; success: boolean; bars?: number; error?: string }[] = [];

    for (const stock of oseStocks) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`Processing: ${stock.ticker} (${stock.name})`);
      console.log(`Exchange: ${stock.exchange}, Currency: ${stock.currency}`);
      console.log(`${"=".repeat(60)}\n`);

      try {
        // Step 1: Fetch RAW prices (TRADES)
        console.log(`[1/3] Fetching RAW prices for ${stock.ticker} from OSE...`);
        const rawData = await client.getHistoricalData(
          stock.ticker,
          "OSE",
          "10 Y",
          "1 day",
          SecType.STK,
          "NOK",
          false // adjusted = false → get raw TRADES data
        );
        console.log(`✓ Fetched ${rawData.length} raw bars`);

        if (rawData.length === 0) {
          console.log(`⚠️  No data available for ${stock.ticker}`);
          results.push({ ticker: stock.ticker, success: false, error: "No data available" });
          continue;
        }

        // Step 2: Fetch ADJUSTED prices (ADJUSTED_LAST)
        console.log(`[2/3] Fetching ADJUSTED prices for ${stock.ticker} from OSE...`);
        const adjData = await client.getHistoricalData(
          stock.ticker,
          "OSE",
          "10 Y",
          "1 day",
          SecType.STK,
          "NOK",
          true // adjusted = true → get ADJUSTED_LAST data
        );
        console.log(`✓ Fetched ${adjData.length} adjusted bars`);

        // Step 3: Merge adjusted prices into raw data
        const adjMap = new Map<string, number>();
        for (const bar of adjData) {
          adjMap.set(bar.time, bar.close); // adjusted close
        }

        for (const bar of rawData) {
          const adjPrice = adjMap.get(bar.time);
          (bar as any).adjClose = adjPrice !== undefined ? adjPrice : bar.close;
        }

        console.log(`✓ Merged ${rawData.length} raw bars with ${adjData.length} adjusted records`);

        // Insert stock master record
        await insertStock(stock);
        console.log(`✓ Inserted stock record: ${stock.ticker}`);

        // Insert price data with both raw close and adj_close
        console.log(`[3/3] Inserting ${rawData.length} price records...`);
        for (const bar of rawData) {
          await insertPriceData(stock.ticker, bar);
        }
        console.log(`✓ Inserted ${rawData.length} price records for ${stock.ticker}`);
        console.log(`   → close (raw) and adj_close (dividend-adjusted)\n`);

        results.push({ ticker: stock.ticker, success: true, bars: rawData.length });

      } catch (error: any) {
        console.error(`✗ Error fetching ${stock.ticker}:`, error.message);
        results.push({ ticker: stock.ticker, success: false, error: error.message });
        continue;
      }

      // Rate limiting
      await sleep(1000);
    }

    console.log("\n" + "=".repeat(70));
    console.log("IMPORT COMPLETE");
    console.log("=".repeat(70));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`\nTotal stocks: ${oseStocks.length}`);
    console.log(`Successfully imported: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);

    if (successful.length > 0) {
      console.log("\n✓ Successfully imported OSE versions:");
      successful.forEach(r => {
        console.log(`  ${r.ticker} (OSE, NOK): ${r.bars} bars (raw + adjusted)`);
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
