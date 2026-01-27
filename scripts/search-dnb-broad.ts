#!/usr/bin/env tsx
/**
 * Search IBKR broadly for DNB securities
 */

import { IBApi, EventName, Contract, SecType } from "@stoqey/ib";

const GATEWAY_PORT = 4002;
const CLIENT_ID = 997;

async function searchByPattern(api: IBApi, pattern: string): Promise<any[]> {
  return new Promise((resolve) => {
    const reqId = Math.floor(Math.random() * 10000);
    const results: any[] = [];
    
    api.on(EventName.symbolSamples, (id, contractDescriptions) => {
      if (id === reqId) {
        for (const desc of contractDescriptions) {
          results.push({
            conId: desc.contract.conId,
            symbol: desc.contract.symbol,
            secType: desc.contract.secType,
            primaryExch: desc.contract.primaryExch,
            currency: desc.contract.currency,
            derivativeSecTypes: desc.derivativeSecTypes,
          });
        }
        resolve(results);
      }
    });
    
    api.on(EventName.error, (id, code, msg) => {
      if (id === reqId && code !== 2104 && code !== 2106 && code !== 2158) {
        console.log(`Search error: ${msg}`);
        resolve(results);
      }
    });
    
    api.reqMatchingSymbols(reqId, pattern);
    
    setTimeout(() => resolve(results), 5000);
  });
}

async function main() {
  console.log("Connecting to IB Gateway...");
  const api = new IBApi({ port: GATEWAY_PORT, clientId: CLIENT_ID });
  
  await new Promise<void>((resolve, reject) => {
    api.on(EventName.connected, () => {
      console.log("Connected to IB Gateway\n");
      resolve();
    });
    api.on(EventName.error, (id, code, msg) => {
      if (code === 502 || code === 504) {
        reject(new Error(`Connection failed: ${msg}`));
      }
    });
    api.connect();
    setTimeout(() => reject(new Error("Connection timeout")), 10000);
  });
  
  // Search for DNB
  console.log("Searching for 'DNB'...");
  const dnbResults = await searchByPattern(api, "DNB");
  console.log(`Found ${dnbResults.length} results:`);
  dnbResults.forEach((r, i) => {
    console.log(`  [${i+1}] ${r.symbol} (${r.secType}) - conId: ${r.conId} - ${r.primaryExch} ${r.currency}`);
  });
  
  // Filter for Norwegian results
  const norwegianResults = dnbResults.filter(r => 
    r.currency === "NOK" || r.primaryExch === "OSE"
  );
  console.log(`\nNorwegian results: ${norwegianResults.length}`);
  norwegianResults.forEach(r => {
    console.log(`  ${r.symbol} - conId: ${r.conId} - ${r.primaryExch} ${r.currency}`);
  });
  
  api.disconnect();
  console.log("\nDone");
  process.exit(0);
}

main().catch(console.error);
