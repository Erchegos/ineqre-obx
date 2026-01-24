#!/usr/bin/env tsx
/**
 * Import fundamental data for all OBX stocks
 * Fetches company overview for each ticker and saves to database
 */

import { FundamentalsClient, FundamentalsReportType } from "../packages/ibkr/src/fundamentals-client";
import { FundamentalsParser, ParsedCompanyData } from "../packages/ibkr/src/fundamentals-parser";
import { OBX_TICKERS } from "../packages/ibkr/src/obx-tickers";
import { SecType } from "@stoqey/ib";
import { writeFileSync } from "fs";

async function main() {
  const client = new FundamentalsClient();
  const parser = new FundamentalsParser();

  // Skip OBX index itself, only process stocks
  // Also skip CMBTO, HAVI, HEX, KIT, RECSI, TECH - not in database or different exchange
  const skipTickers = ["OBX", "CMBTO", "HAVI", "HEX", "KIT", "RECSI", "TECH"];
  const tickers = OBX_TICKERS.filter(t => !skipTickers.includes(t));

  console.log(`Importing fundamental data for ${tickers.length} OBX stocks...\n`);

  const results: Array<{
    ticker: string;
    success: boolean;
    data?: ParsedCompanyData;
    error?: string;
  }> = [];

  try {
    await client.connect();
    console.log("[OK] Connected to IB Gateway\n");

    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i];
      console.log(`[${i + 1}/${tickers.length}] Processing ${ticker}...`);

      try {
        // Fetch XML
        const xml = await client.fetchFundamentalReport(
          ticker,
          "OSE",
          FundamentalsReportType.COMPANY_OVERVIEW,
          SecType.STK,
          "NOK"
        );

        // Parse
        const data = parser.parseCompanyOverview(xml);

        results.push({
          ticker,
          success: true,
          data,
        });

        console.log(`  [OK] ${data.companyName}`);
        console.log(`  Employees: ${data.employees?.toLocaleString() || "N/A"}`);
        console.log(`  Industry: ${data.industry || "N/A"}`);
        console.log("");

        // Rate limiting - wait 1 second between requests
        if (i < tickers.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error: any) {
        console.log(`  [FAILED] ${error.message}\n`);
        results.push({
          ticker,
          success: false,
          error: error.message,
        });
      }
    }

    // Save results
    const outputFile = "/tmp/obx_fundamentals_bulk.json";
    const successfulData = results
      .filter((r) => r.success)
      .map((r) => r.data);

    writeFileSync(outputFile, JSON.stringify(successfulData, null, 2));
    console.log(`[OK] Saved ${successfulData.length} companies to: ${outputFile}\n`);

    // Summary
    console.log("IMPORT SUMMARY");
    console.log("=".repeat(70));
    console.log(`Total tickers: ${tickers.length}`);
    console.log(`Successful: ${results.filter((r) => r.success).length}`);
    console.log(`Failed: ${results.filter((r) => !r.success).length}`);
    console.log("");

    // Display failed tickers
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      console.log("Failed tickers:");
      failed.forEach((f) => {
        console.log(`  - ${f.ticker}: ${f.error}`);
      });
      console.log("");
    }

    // Sample data display
    if (successfulData.length > 0) {
      console.log("SAMPLE DATA (First Company)");
      console.log("=".repeat(70));
      const first = successfulData[0]!;
      console.log(`Company: ${first.companyName}`);
      console.log(`Ticker: ${first.ticker}`);
      console.log(`Industry: ${first.industry || "N/A"}`);
      console.log(`Employees: ${first.employees?.toLocaleString() || "N/A"}`);
      console.log(`Shares: ${first.sharesOutstanding?.toLocaleString() || "N/A"}`);
      console.log(`Exchange: ${first.exchange}`);
      console.log(`Website: ${first.website || "N/A"}`);
      console.log("");
    }

    // Next steps
    console.log("NEXT STEPS");
    console.log("=".repeat(70));
    console.log("1. Review the data in: /tmp/obx_fundamentals_bulk.json");
    console.log("2. Create database schema for company_fundamentals table");
    console.log("3. Import data into PostgreSQL");
    console.log("4. Create API endpoint to serve fundamental data");
    console.log("5. Display in web interface");
    console.log("");

  } catch (error: any) {
    console.error("[ERROR]", error.message);
    process.exit(1);
  } finally {
    await client.disconnect();
  }
}

main();
