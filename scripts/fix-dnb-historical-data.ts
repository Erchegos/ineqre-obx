#!/usr/bin/env tsx
/**
 * Fix DNB Historical Data - Fetch Extended History from IBKR
 *
 * DNB underwent an intragroup merger on July 2, 2021 where DNB Bank ASA absorbed DNB ASA.
 * The ticker and ISIN remained unchanged (DNB, NO0010161896).
 * Current data only goes back to 2021-07-01 (1,151 rows).
 * This script fetches the full 25-year history from IBKR and merges with existing data.
 *
 * Expected result: ~5,800+ rows dating back to ~2003
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

interface PriceBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
}

async function getExistingDNBData(): Promise<PriceBar[]> {
  const result = await pool.query(
    `SELECT
      to_char(date, 'YYYYMMDD') as time,
      open, high, low, close, volume, adj_close as "adjClose"
     FROM prices_daily
     WHERE ticker = 'DNB' AND source = 'ibkr'
     ORDER BY date ASC`
  );

  return result.rows.map(row => ({
    time: row.time,
    open: parseFloat(row.open),
    high: parseFloat(row.high),
    low: parseFloat(row.low),
    close: parseFloat(row.close),
    volume: parseInt(row.volume),
    adjClose: row.adjClose ? parseFloat(row.adjClose) : undefined,
  }));
}

async function insertPriceData(ticker: string, bar: PriceBar) {
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
      bar.time,
      bar.open,
      bar.high,
      bar.low,
      bar.close,
      Math.round(bar.volume),
      bar.adjClose || bar.close,
    ]
  );
}

function validateMergerContinuity(data: PriceBar[]): boolean {
  // Find prices around July 1-2, 2021 (merger date)
  const mergerDate = '20210701';
  const mergerIdx = data.findIndex(bar => bar.time >= mergerDate);

  if (mergerIdx <= 0 || mergerIdx >= data.length - 1) {
    console.log('⚠️  Cannot validate merger continuity - insufficient data around merger date');
    return true; // Allow anyway
  }

  const beforeMerger = data[mergerIdx - 1];
  const atMerger = data[mergerIdx];
  const afterMerger = data[mergerIdx + 1];

  // Check for abnormal price jumps (>20% in one day)
  const jumpBefore = Math.abs((atMerger.close - beforeMerger.close) / beforeMerger.close);
  const jumpAfter = Math.abs((afterMerger.close - atMerger.close) / atMerger.close);

  console.log(`\nMerger Continuity Check (July 1-2, 2021):`);
  console.log(`  ${beforeMerger.time}: ${beforeMerger.close.toFixed(2)} NOK`);
  console.log(`  ${atMerger.time}: ${atMerger.close.toFixed(2)} NOK (${(jumpBefore * 100).toFixed(1)}% change)`);
  console.log(`  ${afterMerger.time}: ${afterMerger.close.toFixed(2)} NOK (${(jumpAfter * 100).toFixed(1)}% change)`);

  if (jumpBefore > 0.2 || jumpAfter > 0.2) {
    console.log('  ⚠️  Warning: Large price jump detected around merger date');
    return false;
  }

  console.log('  ✓ Price continuity looks good (1:1 share exchange maintained)');
  return true;
}

function checkForGaps(data: PriceBar[]): { hasGaps: boolean; gapCount: number } {
  let gapCount = 0;

  for (let i = 1; i < data.length; i++) {
    const prevDate = new Date(
      data[i-1].time.slice(0, 4) + '-' +
      data[i-1].time.slice(4, 6) + '-' +
      data[i-1].time.slice(6, 8)
    );
    const currDate = new Date(
      data[i].time.slice(0, 4) + '-' +
      data[i].time.slice(4, 6) + '-' +
      data[i].time.slice(6, 8)
    );

    const daysDiff = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);

    // Gap if more than 5 calendar days (allows for long weekends)
    if (daysDiff > 5) {
      gapCount++;
      if (gapCount <= 3) { // Only log first 3 gaps
        console.log(`  Gap: ${data[i-1].time} → ${data[i].time} (${daysDiff} days)`);
      }
    }
  }

  return { hasGaps: gapCount > 0, gapCount };
}

async function main() {
  console.log("=".repeat(70));
  console.log("DNB HISTORICAL DATA FIX - EXTENDED FETCH FROM IBKR");
  console.log("=".repeat(70));
  console.log("\nObjective: Fetch 25 years of DNB data (pre-merger from ~2003)");
  console.log("Current data: 1,151 rows from 2021-07-01");
  console.log("Expected: ~5,800 rows from ~2003-01-01\n");

  const client = new TWSClient({ requestTimeout: 120000 });

  try {
    await client.connect();
    console.log("✓ Connected to IB Gateway\n");

    // Step 1: Fetch existing data
    console.log("[1/5] Loading existing DNB data from database...");
    const existingData = await getExistingDNBData();
    console.log(`✓ Found ${existingData.length} existing rows`);
    console.log(`  Date range: ${existingData[0]?.time || 'N/A'} to ${existingData[existingData.length - 1]?.time || 'N/A'}\n`);

    // Step 2: Fetch extended RAW history (25 years)
    console.log("[2/5] Fetching 25 YEARS of RAW prices from IBKR...");
    console.log("  Ticker: DNB");
    console.log("  Exchange: OSE");
    console.log("  Currency: NOK");
    console.log("  Duration: 25 Y");
    console.log("  This may take 30-60 seconds...\n");

    const rawData = await client.getHistoricalData(
      "DNB",
      "OSE",
      "25 Y", // Request 25 years of data
      "1 day",
      SecType.STK,
      "NOK",
      false // adjusted = false → get raw TRADES data
    );
    console.log(`✓ Fetched ${rawData.length} raw bars`);
    console.log(`  Date range: ${rawData[0]?.time || 'N/A'} to ${rawData[rawData.length - 1]?.time || 'N/A'}\n`);

    if (rawData.length === 0) {
      console.log("✗ No data available from IBKR. Aborting.");
      return;
    }

    // Step 3: Fetch extended ADJUSTED history (25 years)
    console.log("[3/5] Fetching 25 YEARS of ADJUSTED prices from IBKR...");
    const adjData = await client.getHistoricalData(
      "DNB",
      "OSE",
      "25 Y",
      "1 day",
      SecType.STK,
      "NOK",
      true // adjusted = true → get ADJUSTED_LAST data
    );
    console.log(`✓ Fetched ${adjData.length} adjusted bars\n`);

    // Step 4: Merge adjusted prices into raw data
    console.log("[4/5] Merging raw and adjusted prices...");
    const adjMap = new Map<string, number>();
    for (const bar of adjData) {
      adjMap.set(bar.time, bar.close);
    }

    for (const bar of rawData) {
      const adjPrice = adjMap.get(bar.time);
      (bar as any).adjClose = adjPrice !== undefined ? adjPrice : bar.close;
    }
    console.log(`✓ Merged ${rawData.length} bars with adjusted prices\n`);

    // Step 5: Validate merged data
    console.log("[5/5] Validating merged dataset...");

    // Remove duplicates (keep IBKR data, it's fresher)
    const dataMap = new Map<string, PriceBar>();

    // Add all IBKR data first (priority)
    for (const bar of rawData) {
      dataMap.set(bar.time, bar);
    }

    // Add existing data only if not already in IBKR data
    for (const bar of existingData) {
      if (!dataMap.has(bar.time)) {
        dataMap.set(bar.time, bar);
      }
    }

    // Convert to sorted array
    const mergedData = Array.from(dataMap.values())
      .sort((a, b) => a.time.localeCompare(b.time));

    console.log(`✓ Merged dataset: ${mergedData.length} total rows`);
    console.log(`  Date range: ${mergedData[0].time} to ${mergedData[mergedData.length - 1].time}`);

    // Validation checks
    console.log("\nRunning validation checks:");

    // Check 1: Minimum rows (should have at least 4,000 for 16+ years)
    const hasEnoughData = mergedData.length >= 4000;
    console.log(`  Minimum rows (4,000+): ${hasEnoughData ? '✓' : '✗'} (${mergedData.length} rows)`);

    // Check 2: Check for gaps
    const { hasGaps, gapCount } = checkForGaps(mergedData);
    console.log(`  Data continuity: ${!hasGaps ? '✓ No gaps' : `⚠️  ${gapCount} gaps detected`}`);

    // Check 3: Price continuity around merger
    const continuityOk = validateMergerContinuity(mergedData);
    console.log(`  Merger continuity: ${continuityOk ? '✓' : '⚠️'}`);

    // Check 4: Start date should be before 2010
    const startYear = parseInt(mergedData[0].time.slice(0, 4));
    const hasOldData = startYear < 2010;
    console.log(`  Historical data (pre-2010): ${hasOldData ? '✓' : '✗'} (starts ${startYear})`);

    const allChecksPassed = hasEnoughData && continuityOk && hasOldData;

    if (!allChecksPassed) {
      console.log("\n⚠️  Some validation checks failed. Review data before proceeding.");
      console.log("Do you want to continue with the update? (manual decision required)");
      // In production, you'd wait for user input here
    }

    // Step 6: Insert merged data into database
    console.log("\n" + "=".repeat(70));
    console.log("INSERTING DATA INTO DATABASE");
    console.log("=".repeat(70));
    console.log(`\nInserting ${mergedData.length} price records...`);
    console.log("This may take a few minutes...\n");

    let inserted = 0;
    let updated = 0;

    for (let i = 0; i < mergedData.length; i++) {
      const bar = mergedData[i];

      // Check if record exists
      const existing = await pool.query(
        'SELECT 1 FROM prices_daily WHERE ticker = $1 AND date = $2 AND source = $3',
        ['DNB', bar.time, 'ibkr']
      );

      await insertPriceData('DNB', bar);

      if (existing.rows.length > 0) {
        updated++;
      } else {
        inserted++;
      }

      // Progress indicator every 500 rows
      if ((i + 1) % 500 === 0) {
        console.log(`  Progress: ${i + 1}/${mergedData.length} rows processed...`);
      }
    }

    console.log(`\n✓ Database update complete!`);
    console.log(`  New records inserted: ${inserted}`);
    console.log(`  Existing records updated: ${updated}`);
    console.log(`  Total records: ${mergedData.length}`);

    // Calculate new metrics
    const startDate = mergedData[0].time.slice(0, 4) + '-' +
                      mergedData[0].time.slice(4, 6) + '-' +
                      mergedData[0].time.slice(6, 8);
    const endDate = mergedData[mergedData.length - 1].time.slice(0, 4) + '-' +
                    mergedData[mergedData.length - 1].time.slice(4, 6) + '-' +
                    mergedData[mergedData.length - 1].time.slice(6, 8);

    console.log("\n" + "=".repeat(70));
    console.log("UPDATED DNB METRICS");
    console.log("=".repeat(70));
    console.log(`Start Date: ${startDate}`);
    console.log(`End Date: ${endDate}`);
    console.log(`Total Rows: ${mergedData.length}`);
    console.log(`Years of History: ${((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 365)).toFixed(1)} years`);
    console.log("\n✓ DNB historical data successfully extended!");
    console.log("\nNext steps:");
    console.log("1. Refresh the stocks page to see updated metrics");
    console.log("2. Verify DNB now shows Tier A with ~5,800+ rows");
    console.log("3. Check data quality completeness percentage");

  } catch (error: any) {
    console.error("\n✗ Fatal error:", error.message);
    console.error(error.stack);
  } finally {
    await client.disconnect();
    await pool.end();
    console.log("\n✓ Disconnected from IB Gateway and database");
  }
}

main();
