#!/usr/bin/env tsx
/**
 * Fetch DNB Historical Data from Yahoo Finance
 *
 * Special case: IBKR doesn't have pre-merger DNB data (before July 2, 2021).
 * Yahoo Finance should have the complete history back to ~2003.
 *
 * This script:
 * 1. Fetches all available DNB.OL data from Yahoo Finance
 * 2. Only inserts data for dates NOT already in database from IBKR
 * 3. Uses source='yahoo' to distinguish from IBKR data
 */
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

interface YahooBar {
  date: string; // YYYYMMDD format
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose: number;
}

async function getExistingDates(): Promise<Set<string>> {
  const result = await pool.query(
    `SELECT to_char(date, 'YYYYMMDD') as date_str
     FROM prices_daily
     WHERE ticker = 'DNB'
     ORDER BY date ASC`
  );

  return new Set(result.rows.map(row => row.date_str));
}

async function fetchYahooData(ticker: string): Promise<YahooBar[]> {
  // Yahoo Finance uses Unix timestamps
  const period1 = Math.floor(new Date('2000-01-01').getTime() / 1000); // Start from 2000
  const period2 = Math.floor(Date.now() / 1000); // Current time

  const url = `https://query1.finance.yahoo.com/v7/finance/download/${ticker}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`;

  // Add headers to mimic browser request
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Referer': 'https://finance.yahoo.com/',
    },
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance API error: ${response.status} ${response.statusText}`);
  }

  const csvText = await response.text();
  const lines = csvText.trim().split('\n');

  // Skip header row
  const dataLines = lines.slice(1);

  const bars: YahooBar[] = [];

  for (const line of dataLines) {
    const [dateStr, openStr, highStr, lowStr, closeStr, adjCloseStr, volumeStr] = line.split(',');

    // Skip invalid rows (nulls, etc)
    if (!dateStr || dateStr === 'null' || openStr === 'null') {
      continue;
    }

    const date = dateStr.replace(/-/g, ''); // YYYY-MM-DD -> YYYYMMDD
    const open = parseFloat(openStr);
    const high = parseFloat(highStr);
    const low = parseFloat(lowStr);
    const close = parseFloat(closeStr);
    const adjClose = parseFloat(adjCloseStr);
    const volume = parseInt(volumeStr);

    // Skip if any value is NaN
    if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close) || isNaN(adjClose) || isNaN(volume)) {
      continue;
    }

    bars.push({
      date,
      open,
      high,
      low,
      close,
      adjClose,
      volume,
    });
  }

  return bars;
}

async function insertPriceData(ticker: string, bar: YahooBar) {
  await pool.query(
    `INSERT INTO prices_daily (ticker, date, open, high, low, close, volume, adj_close, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'yahoo')
     ON CONFLICT (ticker, date, source) DO UPDATE SET
       open = EXCLUDED.open,
       high = EXCLUDED.high,
       low = EXCLUDED.low,
       close = EXCLUDED.close,
       volume = EXCLUDED.volume,
       adj_close = EXCLUDED.adj_close`,
    [
      ticker,
      bar.date,
      bar.open,
      bar.high,
      bar.low,
      bar.close,
      Math.round(bar.volume),
      bar.adjClose,
    ]
  );
}

async function main() {
  console.log("=".repeat(70));
  console.log("FETCH DNB HISTORICAL DATA FROM YAHOO FINANCE");
  console.log("=".repeat(70));
  console.log("\nSpecial case: IBKR doesn't have pre-merger data");
  console.log("Fetching from Yahoo Finance as alternative source\n");

  try {
    // Step 1: Get existing dates from database
    console.log("[1/4] Loading existing DNB dates from database...");
    const existingDates = await getExistingDates();
    console.log(`✓ Found ${existingDates.size} existing dates in database\n`);

    // Step 2: Fetch from Yahoo Finance
    console.log("[2/4] Fetching DNB.OL data from Yahoo Finance...");
    console.log("  Ticker: DNB.OL (Oslo Børs)");
    console.log("  Period: Maximum available history");
    console.log("  This may take 30-60 seconds...\n");

    const result = await fetchYahooData('DNB.OL');

    console.log(`✓ Fetched ${result.length} bars from Yahoo Finance`);

    if (result.length === 0) {
      console.log("✗ No data returned from Yahoo Finance. Aborting.");
      return;
    }

    const firstDate = result[0].date.slice(0, 4) + '-' + result[0].date.slice(4, 6) + '-' + result[0].date.slice(6, 8);
    const lastDate = result[result.length - 1].date.slice(0, 4) + '-' + result[result.length - 1].date.slice(4, 6) + '-' + result[result.length - 1].date.slice(6, 8);
    console.log(`  Date range: ${firstDate} to ${lastDate}\n`);

    // Step 3: Filter out dates that already exist
    console.log("[3/4] Filtering data...");
    const newBars = result.filter(bar => !existingDates.has(bar.date));

    console.log(`✓ Found ${newBars.length} new dates to insert`);
    console.log(`  (${existingDates.size} dates already exist from IBKR)\n`);

    if (newBars.length === 0) {
      console.log("✓ No new data to insert. Database is up to date.");
      return;
    }

    // Step 4: Insert new data
    console.log("[4/4] Inserting new data into database...");
    console.log(`Inserting ${newBars.length} price records from Yahoo Finance...\n`);

    let inserted = 0;
    for (let i = 0; i < newBars.length; i++) {
      const bar = newBars[i];
      await insertPriceData('DNB', bar);
      inserted++;

      // Progress indicator every 500 rows
      if ((i + 1) % 500 === 0) {
        console.log(`  Progress: ${i + 1}/${newBars.length} rows inserted...`);
      }
    }

    console.log(`\n✓ Database update complete!`);
    console.log(`  New records inserted: ${inserted}`);
    console.log(`  Source: Yahoo Finance (yahoo)`);

    // Get final statistics
    const statsResult = await pool.query(
      `SELECT
         COUNT(*) as total_rows,
         MIN(date) as start_date,
         MAX(date) as end_date,
         COUNT(DISTINCT source) as sources
       FROM prices_daily
       WHERE ticker = 'DNB'`
    );

    const stats = statsResult.rows[0];
    const startDate = stats.start_date.toISOString().slice(0, 10);
    const endDate = stats.end_date.toISOString().slice(0, 10);
    const yearsOfHistory = ((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 365)).toFixed(1);

    console.log("\n" + "=".repeat(70));
    console.log("UPDATED DNB METRICS");
    console.log("=".repeat(70));
    console.log(`Start Date: ${startDate}`);
    console.log(`End Date: ${endDate}`);
    console.log(`Total Rows: ${stats.total_rows}`);
    console.log(`Years of History: ${yearsOfHistory} years`);
    console.log(`Data Sources: ${stats.sources} (IBKR + Yahoo Finance)`);

    console.log("\n✓ DNB historical data successfully extended!");
    console.log("\nNext steps:");
    console.log("1. Refresh the stocks page to see updated metrics");
    console.log("2. Verify DNB now shows improved data tier");
    console.log("3. Check data quality completeness percentage");

  } catch (error: any) {
    console.error("\n✗ Fatal error:", error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
    console.log("\n✓ Disconnected from database");
  }
}

main();
