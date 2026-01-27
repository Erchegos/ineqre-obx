#!/usr/bin/env tsx
/**
 * Example: Import a single stock using TWS Client
 *
 * Usage:
 *   npx tsx scripts/examples/import-single-stock.ts AAPL SMART 1Y
 *   npx tsx scripts/examples/import-single-stock.ts EQNR OSE 5Y
 */

import { TWSClient, SecType } from "../../packages/ibkr/src";

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: npx tsx import-single-stock.ts <SYMBOL> <EXCHANGE> [DURATION]");
    console.error("Example: npx tsx import-single-stock.ts AAPL SMART 1Y");
    process.exit(1);
  }

  const [symbol, exchange, duration = "1 Y"] = args;

  console.log(`Importing ${symbol} from ${exchange}...`);
  console.log(`Duration: ${duration}\n`);

  const client = new TWSClient();

  try {
    // Connect to IB Gateway
    await client.connect();
    console.log("[OK] Connected to IB Gateway\n");

    // Fetch historical data
    const priceData = await client.importAsset(symbol, exchange, duration, {
      secType: SecType.STK,
      currency: "USD", // Change to NOK for Oslo stocks
    });

    console.log(`\nFetched ${priceData.length} data points`);
    console.log("\nFirst 5 rows:");
    console.table(priceData.slice(0, 5));
    console.log("\nLast 5 rows:");
    console.table(priceData.slice(-5));

    // Here you would insert into database
    // await insertPriceData(priceData);

  } catch (error) {
    console.error("[ERROR]", error);
    process.exit(1);
  } finally {
    await client.disconnect();
  }
}

main();
