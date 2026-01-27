#!/usr/bin/env tsx
import { FundamentalsClient, FundamentalsReportType } from "../packages/ibkr/src/fundamentals-client";
import { SecType } from "@stoqey/ib";
import { writeFileSync } from "fs";

async function main() {
  const client = new FundamentalsClient();
  await client.connect();
  console.log('Connected to IB Gateway');

  const xml = await client.fetchFundamentalReport('AKER', 'OSE', FundamentalsReportType.COMPANY_OVERVIEW, SecType.STK, 'NOK');
  writeFileSync('/tmp/aker_raw.xml', xml);
  console.log('Saved AKER XML to /tmp/aker_raw.xml');
  console.log('XML first 500 chars:');
  console.log(xml.substring(0, 500));

  await client.disconnect();
}

main().catch(console.error);
