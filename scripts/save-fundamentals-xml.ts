#!/usr/bin/env tsx
/**
 * Save fundamental data XML to file for inspection
 */

import { FundamentalsClient, FundamentalsReportType } from "../packages/ibkr/src/fundamentals-client";
import { SecType } from "@stoqey/ib";
import { writeFileSync } from "fs";

async function main() {
  const symbol = process.argv[2] || "EQNR";
  const exchange = process.argv[3] || "OSE";

  console.log(`Fetching and saving fundamental data for ${symbol}...\n`);

  const client = new FundamentalsClient();

  try {
    await client.connect();

    // Fetch company overview
    const overview = await client.fetchFundamentalReport(
      symbol,
      exchange,
      FundamentalsReportType.COMPANY_OVERVIEW,
      SecType.STK,
      "NOK"
    );

    const filename = `/tmp/${symbol}_fundamentals.xml`;
    writeFileSync(filename, overview);

    console.log(`[OK] Saved to: ${filename}`);
    console.log(`File size: ${overview.length} bytes\n`);

    // Parse and show some key data
    const nameMatch = overview.match(/<CoID Type="CompanyName">([^<]+)<\/CoID>/);
    const tickerMatch = overview.match(/<CoID Type="IssueID">([^<]+)<\/CoID>/);
    const sectorMatch = overview.match(/<CoID Type="Sector">([^<]+)<\/CoID>/);
    const industryMatch = overview.match(/<CoID Type="Industry">([^<]+)<\/CoID>/);

    console.log("Extracted Data:");
    console.log("=".repeat(60));
    if (nameMatch) console.log(`Company: ${nameMatch[1]}`);
    if (tickerMatch) console.log(`Ticker: ${tickerMatch[1]}`);
    if (sectorMatch) console.log(`Sector: ${sectorMatch[1]}`);
    if (industryMatch) console.log(`Industry: ${industryMatch[1]}`);

  } catch (error: any) {
    console.error("[ERROR]", error.message);
    process.exit(1);
  } finally {
    await client.disconnect();
  }
}

main();
