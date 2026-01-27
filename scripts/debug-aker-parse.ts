#!/usr/bin/env tsx
import { readFileSync } from "fs";
import { FundamentalsParser } from "../packages/ibkr/src/fundamentals-parser";

const xml = readFileSync('/tmp/aker_raw.xml', 'utf-8');
const parser = new FundamentalsParser();

console.log('Parsing AKER XML...\n');
const data = parser.parseCompanyOverview(xml);

console.log('Parsed data:');
console.log('Ticker:', data.ticker);
console.log('Company Name:', data.companyName);
console.log('ISIN:', data.isin);
console.log('RIC:', data.ric);
console.log('Exchange:', data.exchange);
console.log('Industry:', data.industry);
console.log('Employees:', data.employees);
