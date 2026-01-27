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

interface StockInfo {
  ticker: string;
  name: string;
  sector: string;
  exchange: string;
  currency: string;
  asset_type: string;
  us_ticker?: string;
}

// Dual-listed stocks to import
const dualListedStocks: StockInfo[] = [
  {
    ticker: "BORR",
    name: "Borr Drilling Limited",
    sector: "Shipping",
    exchange: "OSE",
    currency: "NOK",
    asset_type: "equity",
    us_ticker: "BORR"
  },
  {
    ticker: "BWLP",
    name: "BW LPG Limited",
    sector: "Shipping",
    exchange: "OSE",
    currency: "NOK",
    asset_type: "equity",
    us_ticker: "BWLP"
  },
  {
    ticker: "CMBT",
    name: "Cadeler A/S",
    sector: "Shipping",
    exchange: "OSE",
    currency: "NOK",
    asset_type: "equity",
    us_ticker: "CDLR"
  },
  {
    ticker: "ECO",
    name: "Okeanis Eco Tankers Corp",
    sector: "Shipping",
    exchange: "OSE",
    currency: "NOK",
    asset_type: "equity",
    us_ticker: "ECO"
  },
  {
    ticker: "HAFN",
    name: "Hafnia Limited",
    sector: "Shipping",
    exchange: "OSE",
    currency: "NOK",
    asset_type: "equity",
    us_ticker: "HAFN"
  },
  {
    ticker: "HSHP",
    name: "Hamilton Shipping Partners",
    sector: "Shipping",
    exchange: "OSE",
    currency: "NOK",
    asset_type: "equity",
    us_ticker: "HSHP"
  },
  {
    ticker: "OET",
    name: "Okea ASA",
    sector: "Energy",
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

    for (const stock of dualListedStocks) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`Processing: ${stock.ticker} (${stock.name})`);
      console.log(`Sector: ${stock.sector}`);
      console.log(`${"=".repeat(60)}\n`);

      try {
        // Fetch Norwegian (OSE) version
        console.log(`Fetching ${stock.ticker} from OSE...`);
        const oseData = await client.getHistoricalData(
          stock.ticker,
          "OSE",
          "10 Y",
          "1 day",
          SecType.STK,
          "NOK"
        );

        console.log(`✓ Fetched ${oseData.length} bars for ${stock.ticker} (OSE)`);

        // Insert stock master record
        await insertStock(stock);
        console.log(`✓ Inserted stock record: ${stock.ticker}`);

        // Insert price data
        for (const bar of oseData) {
          await insertPriceData(stock.ticker, bar);
        }
        console.log(`✓ Inserted ${oseData.length} price records for ${stock.ticker}\n`);

        // If US ticker exists and is different from OSE ticker, fetch US version
        if (stock.us_ticker && stock.us_ticker !== stock.ticker) {
          await sleep(500);

          console.log(`Fetching ${stock.us_ticker} from US markets...`);
          const usData = await client.getHistoricalData(
            stock.us_ticker,
            "SMART",
            "10 Y",
            "1 day",
            SecType.STK,
            "USD"
          );

          console.log(`✓ Fetched ${usData.length} bars for ${stock.us_ticker} (US)`);

          // Insert US version as separate stock
          const usStock = {
            ...stock,
            ticker: stock.us_ticker,
            exchange: "NASDAQ",
            currency: "USD"
          };

          await insertStock(usStock);
          console.log(`✓ Inserted stock record: ${stock.us_ticker}`);

          // Insert US price data
          for (const bar of usData) {
            await insertPriceData(stock.us_ticker, bar);
          }
          console.log(`✓ Inserted ${usData.length} price records for ${stock.us_ticker}\n`);
        }

      } catch (error: any) {
        console.error(`✗ Error fetching ${stock.ticker}:`, error.message);
        continue;
      }

      // Rate limiting
      await sleep(500);
    }

    console.log("\n" + "=".repeat(60));
    console.log("IMPORT COMPLETE");
    console.log("=".repeat(60));

    // Show summary
    const result = await pool.query(`
      SELECT s.ticker, s.name, s.sector, s.exchange, COUNT(p.*) as price_count
      FROM stocks s
      LEFT JOIN prices_daily p ON s.ticker = p.ticker
      WHERE s.ticker = ANY($1)
      GROUP BY s.ticker, s.name, s.sector, s.exchange
      ORDER BY s.ticker
    `, [
      dualListedStocks.map(s => s.ticker),
      dualListedStocks.filter(s => s.us_ticker && s.us_ticker !== s.ticker).map(s => s.us_ticker!)
    ].flat());

    console.log("\nImported stocks:");
    result.rows.forEach(row => {
      console.log(`  ${row.ticker} (${row.exchange}): ${row.price_count} bars - ${row.name} [${row.sector}]`);
    });

  } catch (error) {
    console.error("Fatal error:", error);
  } finally {
    await client.disconnect();
    await pool.end();
  }
}

main();
