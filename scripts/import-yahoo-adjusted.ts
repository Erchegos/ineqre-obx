#!/usr/bin/env tsx
/**
 * Import Historical Data with Adjusted Close from Yahoo Finance
 *
 * This script fetches both raw close and adjusted close prices for all stocks
 * to properly calculate total return (with dividend reinvestment)
 */

import { Pool } from "pg";
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
}

// Yahoo Finance symbol mapping for Norwegian stocks
function getYahooSymbol(ticker: string, exchange: string): string {
  if (exchange === "OSE" || exchange === "Oslo") {
    return `${ticker}.OL`;
  }
  // US stocks use ticker as-is
  return ticker;
}

async function fetchYahooData(
  yahooSymbol: string,
  startDate: string = "1999-01-01"
): Promise<any[]> {
  const endDate = new Date().toISOString().split("T")[0];

  // Convert to Unix timestamps
  const period1 = Math.floor(new Date(startDate).getTime() / 1000);
  const period2 = Math.floor(new Date(endDate).getTime() / 1000);

  const url = `https://query1.finance.yahoo.com/v7/finance/download/${yahooSymbol}?period1=${period1}&period2=${period2}&interval=1d&events=history`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/csv,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://finance.yahoo.com/',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const csvText = await response.text();
    const lines = csvText.trim().split("\n");

    if (lines.length < 2) {
      throw new Error("No data");
    }

    const results: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      if (parts.length < 7) continue;

      const [date, open, high, low, close, adjClose, volume] = parts;

      if (!date || date === "null" || !close || close === "null") continue;

      results.push({
        date: date.trim(),
        open: parseFloat(open) || 0,
        high: parseFloat(high) || 0,
        low: parseFloat(low) || 0,
        close: parseFloat(close),
        adj_close: parseFloat(adjClose) || parseFloat(close),
        volume: parseInt(volume) || 0,
      });
    }

    return results;
  } catch (error: any) {
    throw new Error(`Yahoo fetch failed: ${error.message}`);
  }
}

async function updateStockData(stock: StockInfo): Promise<boolean> {
  try {
    const yahooSymbol = getYahooSymbol(stock.ticker, stock.exchange);
    console.log(`[${stock.ticker}] Fetching from Yahoo Finance (${yahooSymbol})...`);

    const data = await fetchYahooData(yahooSymbol);

    if (data.length === 0) {
      console.log(`[${stock.ticker}] ✗ No data returned`);
      return false;
    }

    // Insert/update prices with adjusted close
    let insertedCount = 0;
    let updatedCount = 0;

    for (const price of data) {
      const result = await pool.query(
        `INSERT INTO prices_daily (ticker, date, open, high, low, close, adj_close, volume, source)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, 'yahoo')
         ON CONFLICT (ticker, date) DO UPDATE SET
           open = EXCLUDED.open,
           high = EXCLUDED.high,
           low = EXCLUDED.low,
           close = EXCLUDED.close,
           adj_close = EXCLUDED.adj_close,
           volume = EXCLUDED.volume,
           source = EXCLUDED.source
         RETURNING (xmax = 0) AS inserted`,
        [
          stock.ticker,
          price.date,
          price.open,
          price.high,
          price.low,
          price.close,
          price.adj_close,
          price.volume
        ]
      );

      if (result.rows[0]?.inserted) {
        insertedCount++;
      } else {
        updatedCount++;
      }
    }

    const latest = data[data.length - 1];
    console.log(
      `[${stock.ticker}] ✓ Inserted ${insertedCount}, Updated ${updatedCount} bars (latest: ${latest.date})`
    );
    return true;
  } catch (error: any) {
    console.log(`[${stock.ticker}] ✗ Error: ${error.message}`);
    return false;
  }
}

async function getActiveStocks(): Promise<StockInfo[]> {
  const result = await pool.query(`
    SELECT ticker, name, exchange, currency
    FROM stocks
    WHERE is_active = true
      AND asset_type = 'equity'
    ORDER BY ticker
  `);

  return result.rows;
}

async function main() {
  console.log("=== Yahoo Finance Historical Data Import ===");
  console.log(`Time: ${new Date().toISOString()}\n`);

  try {
    const stocks = await getActiveStocks();
    console.log(`Found ${stocks.length} active stocks\n`);

    let successCount = 0;
    let failCount = 0;

    for (const stock of stocks) {
      const success = await updateStockData(stock);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      // Rate limiting - Yahoo needs much longer delays to avoid 429 errors
      // Use 15-30 second delays between requests to avoid being blocked
      const delay = 15000 + Math.random() * 15000; // 15-30 seconds
      console.log(`  Waiting ${(delay/1000).toFixed(1)}s before next request...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    console.log("\n=== Import Summary ===");
    console.log(`✓ Success: ${successCount}/${stocks.length}`);
    console.log(`✗ Failed: ${failCount}/${stocks.length}`);

    // Show sample of data to verify
    console.log("\n=== Sample Data Check ===");
    const sampleCheck = await pool.query(`
      SELECT ticker, date, close, adj_close,
             ROUND(((close - adj_close) / close * 100)::numeric, 2) as diff_pct
      FROM prices_daily
      WHERE ticker IN ('DNB', 'EQNR', 'ORK')
        AND adj_close != close
      ORDER BY ticker, date DESC
      LIMIT 5
    `);

    console.log("Stocks with dividend adjustments:");
    sampleCheck.rows.forEach(row => {
      console.log(`  ${row.ticker} ${row.date}: close=${row.close}, adj_close=${row.adj_close} (diff: ${row.diff_pct}%)`);
    });

  } catch (error) {
    console.error("\n✗ Fatal error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
