#!/usr/bin/env tsx
/**
 * DNB Historical Data - Try Alternative Contract Specifications
 *
 * Attempts to fetch pre-merger DNB data using different approaches:
 * 1. "DNB ASA" (old company name)
 * 2. "DNBH" (temporary ticker Jun 30 - Jul 1, 2021)
 * 3. Contract with conId if we can find it
 */
import { TWSClient } from "../packages/ibkr/src/tws-client";
import { SecType } from "@stoqey/ib";
import dotenv from "dotenv";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function tryContract(client: TWSClient, symbol: string, label: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Trying: ${label}`);
  console.log(`Symbol: ${symbol}`);
  console.log(`${"=".repeat(70)}\n`);

  try {
    console.log("Fetching 25 years of RAW data...");
    const data = await client.getHistoricalData(
      symbol,
      "OSE",
      "25 Y",
      "1 day",
      SecType.STK,
      "NOK",
      false
    );

    console.log(`✓ Fetched ${data.length} bars`);
    if (data.length > 0) {
      console.log(`  Date range: ${data[0].time} to ${data[data.length - 1].time}`);

      const startYear = parseInt(data[0].time.slice(0, 4));
      const hasPre2021Data = startYear < 2021;
      const hasPre2010Data = startYear < 2010;

      console.log(`  Starts in: ${startYear}`);
      console.log(`  Pre-2021 data: ${hasPre2021Data ? '✓ YES' : '✗ NO'}`);
      console.log(`  Pre-2010 data: ${hasPre2010Data ? '✓ YES' : '✗ NO'}`);

      if (hasPre2010Data) {
        console.log(`\n🎉 SUCCESS! Found ${data.length} bars of historical data!`);
        return { success: true, data, symbol };
      } else if (hasPre2021Data) {
        console.log(`\n✓ Found some pre-merger data (${startYear})`);
        return { success: true, data, symbol };
      } else {
        console.log(`\n✗ No pre-merger data (only from ${startYear})`);
        return { success: false, data, symbol };
      }
    } else {
      console.log(`✗ No data returned`);
      return { success: false, data: [], symbol };
    }
  } catch (error: any) {
    console.log(`✗ Error: ${error.message}`);
    return { success: false, data: [], symbol, error: error.message };
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("DNB HISTORICAL DATA - ALTERNATIVE CONTRACT SEARCH");
  console.log("=".repeat(70));
  console.log("\nTrying different contract specifications to find pre-merger data...\n");

  const client = new TWSClient({ requestTimeout: 120000 });

  try {
    await client.connect();
    console.log("✓ Connected to IB Gateway\n");

    // Try different contract specifications
    const attempts = [
      { symbol: "DNB", label: "Current DNB (DNB Bank ASA)" },
      { symbol: "DNB ASA", label: "Old company name with space" },
      { symbol: "DNBASA", label: "Old company name without space" },
      { symbol: "DNBH", label: "Temporary ticker (Jun 30 - Jul 1, 2021)" },
    ];

    const results = [];

    for (const attempt of attempts) {
      const result = await tryContract(client, attempt.symbol, attempt.label);
      results.push(result);

      // If we found good data, we can stop
      if (result.success && result.data.length > 4000) {
        console.log(`\n🎉 Found ${result.data.length} bars with ${attempt.symbol}!`);
        console.log(`We can use this to fetch the full historical dataset.`);
        break;
      }

      await sleep(2000); // Rate limit between attempts
    }

    console.log("\n" + "=".repeat(70));
    console.log("SUMMARY");
    console.log("=".repeat(70));

    results.forEach(r => {
      const startYear = r.data.length > 0 ? parseInt(r.data[0].time.slice(0, 4)) : 0;
      console.log(`\n${r.symbol}:`);
      console.log(`  Rows: ${r.data.length}`);
      if (r.data.length > 0) {
        console.log(`  Range: ${r.data[0].time} to ${r.data[r.data.length - 1].time}`);
        console.log(`  Starts: ${startYear}`);
        console.log(`  Pre-merger: ${startYear < 2021 ? '✓' : '✗'}`);
      }
      if (r.error) {
        console.log(`  Error: ${r.error}`);
      }
    });

    const bestResult = results.find(r => r.success && r.data.length > 4000) ||
                       results.find(r => r.success && r.data.length > 0);

    if (bestResult) {
      console.log(`\n${"=".repeat(70)}`);
      console.log(`RECOMMENDATION`);
      console.log(`${"=".repeat(70)}`);
      console.log(`\nBest result: ${bestResult.symbol}`);
      console.log(`Rows: ${bestResult.data.length}`);
      console.log(`\nTo fetch this data, update the fix-dnb-historical-data.ts script to use:`);
      console.log(`  Ticker: "${bestResult.symbol}"`);
    } else {
      console.log(`\n${"=".repeat(70)}`);
      console.log(`⚠️  NO SUITABLE DATA FOUND`);
      console.log(`${"=".repeat(70)}`);
      console.log(`\nNone of the attempted contracts returned pre-merger data.`);
      console.log(`\nPossible reasons:`);
      console.log(`1. IBKR doesn't have historical data before 2021 for DNB`);
      console.log(`2. Data might be available under a different exchange or currency`);
      console.log(`3. May need to contact IBKR support or use alternative data source`);
      console.log(`\nAlternative options:`);
      console.log(`- Yahoo Finance (free but may have gaps)`);
      console.log(`- Oslo Børs market data (paid)`);
      console.log(`- Bloomberg/Refinitiv (paid)`);
    }

  } catch (error: any) {
    console.error("\n✗ Fatal error:", error.message);
  } finally {
    await client.disconnect();
    console.log("\n✓ Disconnected from IB Gateway");
  }
}

main();
