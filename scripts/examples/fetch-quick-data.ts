#!/usr/bin/env tsx
/**
 * Example: Quick data fetch (with automatic connection management)
 *
 * Usage:
 *   npx tsx scripts/examples/fetch-quick-data.ts AAPL SMART
 */

import { fetchHistoricalData, SecType } from "../../packages/ibkr/src";

async function main() {
  const [symbol, exchange] = process.argv.slice(2);

  if (!symbol || !exchange) {
    console.error("Usage: npx tsx fetch-quick-data.ts <SYMBOL> <EXCHANGE>");
    console.error("Example: npx tsx fetch-quick-data.ts AAPL SMART");
    process.exit(1);
  }

  console.log(`Fetching ${symbol} from ${exchange}...\n`);

  try {
    // Fetch data with automatic connection management
    const priceData = await fetchHistoricalData(symbol, exchange, "1 Y", {
      secType: SecType.STK,
      currency: "USD",
    });

    console.log(`Fetched ${priceData.length} data points`);
    console.log("\nRecent data:");
    console.table(priceData.slice(-10));

  } catch (error) {
    console.error("[ERROR]", error);
    process.exit(1);
  }
}

main();
