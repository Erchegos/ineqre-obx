#!/usr/bin/env tsx
/**
 * Test fetching fundamental data from IBKR
 * Example: Fetch financials, ratios, analyst ratings for EQNR
 */

import { FundamentalsClient, FundamentalsReportType } from "../packages/ibkr/src/fundamentals-client";
import { SecType } from "@stoqey/ib";

async function main() {
  const symbol = process.argv[2] || "EQNR";
  const exchange = process.argv[3] || "OSE";

  console.log(`\nFetching fundamental data for ${symbol} (${exchange})...\n`);

  const client = new FundamentalsClient();

  try {
    await client.connect();
    console.log("[OK] Connected to IB Gateway\n");

    // Fetch company overview
    console.log("1. Fetching company overview...");
    const overview = await client.fetchFundamentalReport(
      symbol,
      exchange,
      FundamentalsReportType.COMPANY_OVERVIEW,
      SecType.STK,
      "NOK"
    );
    console.log(`   Received ${overview.length} bytes of data`);
    console.log(`   Preview: ${overview.substring(0, 200)}...\n`);

    // Fetch financial statements
    console.log("2. Fetching financial statements...");
    try {
      const financials = await client.fetchFundamentalReport(
        symbol,
        exchange,
        FundamentalsReportType.FINANCIAL_STATEMENTS,
        SecType.STK,
        "NOK"
      );
      console.log(`   Received ${financials.length} bytes of data`);
      console.log(`   Preview: ${financials.substring(0, 200)}...\n`);
    } catch (error: any) {
      console.log(`   Not available: ${error.message}\n`);
    }

    // Fetch analyst forecasts
    console.log("3. Fetching analyst forecasts...");
    try {
      const forecasts = await client.fetchFundamentalReport(
        symbol,
        exchange,
        FundamentalsReportType.ANALYST_FORECASTS,
        SecType.STK,
        "NOK"
      );
      console.log(`   Received ${forecasts.length} bytes of data`);
      console.log(`   Preview: ${forecasts.substring(0, 200)}...\n`);
    } catch (error: any) {
      console.log(`   Not available: ${error.message}\n`);
    }

    // Fetch financial ratios
    console.log("4. Fetching financial ratios...");
    try {
      const ratios = await client.fetchFundamentalReport(
        symbol,
        exchange,
        FundamentalsReportType.FINANCIAL_SUMMARY,
        SecType.STK,
        "NOK"
      );
      console.log(`   Received ${ratios.length} bytes of data`);
      console.log(`   Preview: ${ratios.substring(0, 200)}...\n`);
    } catch (error: any) {
      console.log(`   Not available: ${error.message}\n`);
    }

    console.log("[SUCCESS] Fundamental data is available from IBKR");
    console.log("\nThe data is returned as XML. You can:");
    console.log("1. Parse the XML to extract specific fields");
    console.log("2. Store the raw XML in your database");
    console.log("3. Use a library like 'fast-xml-parser' to parse it");

  } catch (error: any) {
    console.error("[ERROR]", error.message);
    process.exit(1);
  } finally {
    await client.disconnect();
  }
}

main();
