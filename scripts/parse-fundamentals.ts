#!/usr/bin/env tsx
/**
 * Parse and display fundamental data from IBKR
 * Fetches XML and parses into structured format
 */

import { FundamentalsClient, FundamentalsReportType } from "../packages/ibkr/src/fundamentals-client";
import { FundamentalsParser } from "../packages/ibkr/src/fundamentals-parser";
import { SecType } from "@stoqey/ib";
import { writeFileSync } from "fs";

async function main() {
  const symbol = process.argv[2] || "EQNR";
  const exchange = process.argv[3] || "OSE";

  console.log(`\nFetching and parsing fundamental data for ${symbol}...\n`);

  const client = new FundamentalsClient();
  const parser = new FundamentalsParser();

  try {
    await client.connect();
    console.log("[OK] Connected to IB Gateway\n");

    // Fetch XML data
    console.log("Fetching company overview...");
    const xml = await client.fetchFundamentalReport(
      symbol,
      exchange,
      FundamentalsReportType.COMPANY_OVERVIEW,
      SecType.STK,
      "NOK"
    );
    console.log(`[OK] Received ${xml.length} bytes\n`);

    // Parse the XML
    console.log("Parsing XML data...");
    const data = parser.parseCompanyOverview(xml);
    console.log("[OK] Parsed successfully\n");

    // Display formatted text
    console.log(parser.formatAsText(data));

    // Save as JSON
    const jsonFilename = `/tmp/${symbol}_fundamentals.json`;
    writeFileSync(jsonFilename, JSON.stringify(data, null, 2));
    console.log(`\n[OK] Saved JSON to: ${jsonFilename}`);

    // Display JSON preview
    console.log("\nJSON Structure:");
    console.log("=".repeat(70));
    console.log(JSON.stringify(data, null, 2).substring(0, 1000));
    console.log("...\n");

    // Display key metrics summary
    console.log("KEY METRICS SUMMARY");
    console.log("=".repeat(70));
    console.log(`Company: ${data.companyName}`);
    console.log(`Ticker: ${data.ticker}`);
    console.log(`Industry: ${data.industry || "N/A"}`);
    console.log(`Employees: ${data.employees?.toLocaleString() || "N/A"}`);
    console.log(`Shares Outstanding: ${data.sharesOutstanding?.toLocaleString() || "N/A"}`);
    console.log(`Float: ${data.totalFloat?.toLocaleString() || "N/A"}`);
    console.log(`Exchange: ${data.exchange}`);
    console.log(`Currency: ${data.reportingCurrency || "N/A"}`);
    console.log(`Latest Annual: ${data.latestAnnualDate || "N/A"}`);
    console.log(`Latest Interim: ${data.latestInterimDate || "N/A"}`);
    console.log("");

  } catch (error: any) {
    console.error("[ERROR]", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await client.disconnect();
  }
}

main();
