#!/usr/bin/env tsx
/**
 * Example: Import multiple stocks at once
 *
 * Usage:
 *   npx tsx scripts/examples/import-multiple-stocks.ts
 */

import { TWSClient, SecType } from "../../packages/ibkr/src";

async function main() {
  console.log("Importing multiple stocks from Oslo Børs...\n");

  // Define assets to import
  const assets = [
    { symbol: "EQNR", exchange: "OSE", currency: "NOK" },
    { symbol: "DNB", exchange: "OSE", currency: "NOK" },
    { symbol: "MOWI", exchange: "OSE", currency: "NOK" },
    { symbol: "TEL", exchange: "OSE", currency: "NOK" },
    { symbol: "YAR", exchange: "OSE", currency: "NOK" },
  ];

  const client = new TWSClient();

  try {
    // Connect
    await client.connect();
    console.log("[OK] Connected to IB Gateway\n");

    // Import all assets
    const results = await client.importAssets(assets, {
      duration: "1 Y",
      delayMs: 200, // 200ms delay between requests
    });

    // Display results
    console.log("\nImport Results:");
    console.log("=".repeat(60));

    for (const [ticker, priceData] of results.entries()) {
      if (priceData.length > 0) {
        console.log(`[OK] ${ticker}: ${priceData.length} data points`);
      } else {
        console.log(`[FAILED] ${ticker}: No data`);
      }
    }

    // Example: Insert into database
    // for (const [ticker, priceData] of results.entries()) {
    //   if (priceData.length > 0) {
    //     await insertPriceData(priceData);
    //   }
    // }

  } catch (error) {
    console.error("[ERROR]", error);
    process.exit(1);
  } finally {
    await client.disconnect();
  }
}

main();
