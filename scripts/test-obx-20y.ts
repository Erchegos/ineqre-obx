#!/usr/bin/env tsx
/**
 * Test script to check if we can fetch 20 years of OBX data from IB Gateway
 */

import { IBKRClient } from "../packages/ibkr/src/client";

async function testOBX20Years() {
  console.log("Testing OBX 20-year data fetch from IB Gateway...\n");

  const client = new IBKRClient({
    baseUrl: "https://localhost:5000",
    timeout: 60000, // 60 second timeout for large requests
  });

  // Health check
  console.log("1. Checking IB Gateway connection...");
  const healthy = await client.healthCheck();
  if (!healthy) {
    console.error("❌ IB Gateway not responding at https://localhost:5000");
    console.error("   Make sure IB Gateway is running on port 5000");
    process.exit(1);
  }
  console.log("✓ IB Gateway is running\n");

  // Search for OBX contract
  console.log("2. Searching for OBX contract...");
  const contract = await client.searchContract("OBX", "OSE");
  if (!contract) {
    console.error("❌ Could not find OBX contract on OSE");
    process.exit(1);
  }
  console.log(`✓ Found OBX contract:`);
  console.log(`   Contract ID: ${contract.conid}`);
  console.log(`   Symbol: ${contract.symbol}`);
  console.log(`   Exchange: ${contract.exchange}\n`);

  // Test different periods
  const periods = ["20y", "15y", "10y", "5y"];

  for (const period of periods) {
    console.log(`3. Fetching ${period} of historical data...`);
    try {
      const data = await client.getHistoricalData(contract.conid, period, "1d");

      if (!data || !data.data || data.data.length === 0) {
        console.log(`   ⚠️  No data returned for ${period}`);
        continue;
      }

      const bars = data.data;
      const firstDate = new Date(bars[0].t);
      const lastDate = new Date(bars[bars.length - 1].t);
      const yearsDiff = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);

      console.log(`   ✓ Success! Retrieved ${bars.length} days of data`);
      console.log(`   Earliest: ${firstDate.toISOString().slice(0, 10)}`);
      console.log(`   Latest: ${lastDate.toISOString().slice(0, 10)}`);
      console.log(`   Span: ${yearsDiff.toFixed(2)} years`);
      console.log(`   First bar: O=${bars[0].o} H=${bars[0].h} L=${bars[0].l} C=${bars[0].c}`);
      console.log(`   Last bar: O=${bars[bars.length-1].o} H=${bars[bars.length-1].h} L=${bars[bars.length-1].l} C=${bars[bars.length-1].c}\n`);

      // If 20y worked, we're done
      if (period === "20y") {
        console.log("🎉 SUCCESS: 20 years of OBX data is available from IB Gateway!");
        console.log(`\nYou can import this data using:`);
        console.log(`   npm run import:obx -- --period=20y\n`);
        process.exit(0);
      }
    } catch (error) {
      console.error(`   ❌ Failed to fetch ${period}:`, error);
    }
  }

  console.log("\n⚠️  Could not fetch 20 years of data. Maximum available period shown above.");
  process.exit(1);
}

testOBX20Years().catch(console.error);
