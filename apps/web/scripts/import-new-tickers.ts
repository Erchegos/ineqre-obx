#!/usr/bin/env tsx
/**
 * Import new tickers with full historical data from Yahoo Finance
 * Then calculate factors for ML predictions
 */

import { config } from "dotenv";
import { resolve } from "path";
import { Client } from "pg";

config({ path: resolve(__dirname, "../.env.local") });

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const DATABASE_URL = process.env.DATABASE_URL!;

// New tickers to import (from scanner results 2026-02-05)
const NEW_TICKERS = [
  { ticker: "DNO", yahoo: "DNO.OL", name: "DNO ASA" },
  { ticker: "BNOR", yahoo: "BNOR.OL", name: "SpareBank 1 BV" },
  { ticker: "ELO", yahoo: "ELO.OL", name: "Elopak ASA" },
  { ticker: "EPR", yahoo: "EPR.OL", name: "Equinor Petroleum" },
  { ticker: "GIGA", yahoo: "GIGA.OL", name: "Gigante Salmon ASA" },
  { ticker: "HSHP", yahoo: "HSHP.OL", name: "Höegh Autoliners ASA" },
  { ticker: "LINK", yahoo: "LINK.OL", name: "Link Mobility Group" },
  { ticker: "NORCO", yahoo: "NCLH", name: "Norwegian Cruise Line" }, // Listed on NYSE
  { ticker: "PEN", yahoo: "PEN.OL", name: "Polaris Media ASA" },
  { ticker: "PLSV", yahoo: "PLSV.OL", name: "Passer Shipping ASA" },
];

interface YahooBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose: number;
}

async function fetchYahooData(yahooTicker: string): Promise<YahooBar[]> {
  // 10 years of data
  const period1 = Math.floor(Date.now() / 1000) - 10 * 365 * 24 * 60 * 60;
  const period2 = Math.floor(Date.now() / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}?period1=${period1}&period2=${period2}&interval=1d&events=history`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`Yahoo API error: ${res.status}`);
  }

  const data = await res.json();
  const result = data.chart?.result?.[0];

  if (!result || !result.timestamp) {
    throw new Error("No data from Yahoo");
  }

  const timestamps = result.timestamp;
  const quote = result.indicators?.quote?.[0];
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose;

  if (!quote || !adjClose) {
    throw new Error("Missing quote data");
  }

  const bars: YahooBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = quote.open[i];
    const h = quote.high[i];
    const l = quote.low[i];
    const c = quote.close[i];
    const v = quote.volume[i];
    const ac = adjClose[i];

    if (o != null && h != null && l != null && c != null && v != null && ac != null) {
      const date = new Date(timestamps[i] * 1000).toISOString().split("T")[0];
      bars.push({ date, open: o, high: h, low: l, close: c, volume: v, adjClose: ac });
    }
  }

  return bars;
}

async function insertPriceData(client: Client, ticker: string, bars: YahooBar[]): Promise<number> {
  const BATCH_SIZE = 200;
  let inserted = 0;

  for (let i = 0; i < bars.length; i += BATCH_SIZE) {
    const batch = bars.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const placeholders: string[] = [];

    batch.forEach((bar, idx) => {
      const offset = idx * 8;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`
      );
      values.push(
        ticker,
        bar.date,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        Math.round(bar.volume),
        bar.adjClose
      );
    });

    await client.query(
      `INSERT INTO prices_daily (ticker, date, open, high, low, close, volume, adj_close)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (ticker, date) DO UPDATE SET
         open = EXCLUDED.open,
         high = EXCLUDED.high,
         low = EXCLUDED.low,
         close = EXCLUDED.close,
         volume = EXCLUDED.volume,
         adj_close = EXCLUDED.adj_close`,
      values
    );
    inserted += batch.length;
  }

  return inserted;
}

async function ensureStockExists(client: Client, ticker: string, name: string): Promise<void> {
  await client.query(
    `INSERT INTO stocks (ticker, name, currency, exchange, is_active)
     VALUES ($1, $2, 'NOK', 'OSE', true)
     ON CONFLICT (ticker) DO UPDATE SET name = EXCLUDED.name, is_active = true`,
    [ticker, name]
  );
}

async function main() {
  console.log("=== Import New Tickers ===\n");
  console.log(`Tickers: ${NEW_TICKERS.map(t => t.ticker).join(", ")}\n`);

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("Connected to database\n");

  const results: { ticker: string; success: boolean; rows?: number; error?: string }[] = [];

  for (let i = 0; i < NEW_TICKERS.length; i++) {
    const { ticker, yahoo, name } = NEW_TICKERS[i];
    console.log(`[${i + 1}/${NEW_TICKERS.length}] ${ticker} (${yahoo})...`);

    try {
      // Ensure stock record exists
      await ensureStockExists(client, ticker, name);

      // Fetch from Yahoo
      const bars = await fetchYahooData(yahoo);
      console.log(`  Fetched ${bars.length} bars from Yahoo`);

      if (bars.length === 0) {
        throw new Error("No data returned");
      }

      // Insert to database
      const inserted = await insertPriceData(client, ticker, bars);
      console.log(`  Inserted ${inserted} rows`);

      results.push({ ticker, success: true, rows: inserted });
    } catch (e: any) {
      console.log(`  FAILED: ${e.message}`);
      results.push({ ticker, success: false, error: e.message });
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 1000));
  }

  await client.end();

  // Summary
  console.log("\n=== SUMMARY ===");
  const success = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  console.log(`Success: ${success.length}, Failed: ${failed.length}`);
  console.log(`Total rows: ${success.reduce((s, r) => s + (r.rows || 0), 0)}`);

  if (failed.length > 0) {
    console.log("\nFailed:");
    failed.forEach((r) => console.log(`  ${r.ticker}: ${r.error}`));
  }

  console.log("\n=== NEXT STEPS ===");
  console.log("Run factor calculation: pnpm ml:factors");
  console.log("Run predictions: pnpm ml:predict");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
