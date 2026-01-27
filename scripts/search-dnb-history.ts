#!/usr/bin/env tsx
/**
 * Search IBKR for historical DNB data
 * DNB Bank ASA was created from a merger on July 2, 2021
 * The old DNB ASA (holding company) had a different conId
 */

import { IBApi, EventName, Contract, SecType } from "@stoqey/ib";

const GATEWAY_PORT = 4002;
const CLIENT_ID = 999;

async function searchContracts(api: IBApi, symbol: string, exchange: string = "OSE"): Promise<void> {
  return new Promise((resolve, reject) => {
    const reqId = Math.floor(Math.random() * 10000);
    const results: any[] = [];
    
    api.on(EventName.contractDetails, (id, details) => {
      if (id === reqId) {
        results.push({
          conId: details.contract.conId,
          symbol: details.contract.symbol,
          localSymbol: details.contract.localSymbol,
          secType: details.contract.secType,
          exchange: details.contract.exchange,
          primaryExch: details.contract.primaryExch,
          currency: details.contract.currency,
          longName: details.longName,
          tradingClass: details.contract.tradingClass,
        });
      }
    });
    
    api.on(EventName.contractDetailsEnd, (id) => {
      if (id === reqId) {
        console.log(`\n=== Search results for "${symbol}" on ${exchange} ===`);
        if (results.length === 0) {
          console.log("No results found");
        } else {
          results.forEach((r, i) => {
            console.log(`\n[${i + 1}] conId: ${r.conId}`);
            console.log(`    Symbol: ${r.symbol} | Local: ${r.localSymbol}`);
            console.log(`    Name: ${r.longName}`);
            console.log(`    Exchange: ${r.exchange} | Primary: ${r.primaryExch}`);
            console.log(`    Currency: ${r.currency} | Class: ${r.tradingClass}`);
          });
        }
        resolve();
      }
    });
    
    api.on(EventName.error, (id, code, msg) => {
      if (id === reqId && code !== 2104 && code !== 2106 && code !== 2158) {
        console.error(`Error ${code}: ${msg}`);
      }
    });
    
    const contract: Contract = {
      symbol,
      secType: SecType.STK,
      exchange,
      currency: "NOK",
    };
    
    api.reqContractDetails(reqId, contract);
  });
}

async function main() {
  console.log("Connecting to IB Gateway...");
  const api = new IBApi({ port: GATEWAY_PORT, clientId: CLIENT_ID });
  
  await new Promise<void>((resolve, reject) => {
    api.on(EventName.connected, () => {
      console.log("Connected to IB Gateway");
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
  
  // Search for DNB variations
  const searches = [
    { symbol: "DNB", exchange: "OSE" },
    { symbol: "DNBA", exchange: "OSE" },
    { symbol: "DNBH", exchange: "OSE" },
    { symbol: "DNB ASA", exchange: "OSE" },
  ];
  
  for (const search of searches) {
    try {
      await searchContracts(api, search.symbol, search.exchange);
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.error(`Search failed for ${search.symbol}:`, e);
    }
  }
  
  api.disconnect();
  console.log("\nDone");
  process.exit(0);
}

main().catch(console.error);
