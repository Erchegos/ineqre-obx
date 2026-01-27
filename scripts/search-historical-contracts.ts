#!/usr/bin/env tsx
/**
 * Try to find historical/delisted contracts for old DNB ASA
 */

import { IBApi, EventName, Contract, SecType } from "@stoqey/ib";

const GATEWAY_PORT = 4002;
const CLIENT_ID = 995;

async function searchContract(api: IBApi, symbol: string, includeExpired: boolean = false): Promise<any[]> {
  return new Promise((resolve) => {
    const reqId = Math.floor(Math.random() * 10000);
    const results: any[] = [];
    let timeout: NodeJS.Timeout;
    
    const finish = () => {
      clearTimeout(timeout);
      resolve(results);
    };
    
    api.on(EventName.contractDetails, (id, details) => {
      if (id === reqId) {
        results.push({
          conId: details.contract.conId,
          symbol: details.contract.symbol,
          localSymbol: details.contract.localSymbol,
          longName: details.longName,
          exchange: details.contract.exchange,
          currency: details.contract.currency,
        });
      }
    });
    
    api.on(EventName.contractDetailsEnd, (id) => {
      if (id === reqId) finish();
    });
    
    api.on(EventName.error, (id, code, msg) => {
      if (id === reqId && code !== 2104 && code !== 2106 && code !== 2158) {
        console.log(`  Error for ${symbol}: ${msg}`);
        finish();
      }
    });
    
    const contract: Contract = {
      symbol,
      secType: SecType.STK,
      exchange: "OSE",
      currency: "NOK",
      includeExpired: includeExpired,
    };
    
    api.reqContractDetails(reqId, contract);
    timeout = setTimeout(finish, 5000);
  });
}

async function main() {
  console.log("Connecting to IB Gateway...");
  const api = new IBApi({ port: GATEWAY_PORT, clientId: CLIENT_ID });
  
  await new Promise<void>((resolve, reject) => {
    api.on(EventName.connected, () => {
      console.log("Connected\n");
      resolve();
    });
    api.on(EventName.error, (id, code, msg) => {
      if (code === 502 || code === 504) reject(new Error(msg));
    });
    api.connect();
    setTimeout(() => reject(new Error("Timeout")), 10000);
  });
  
  // Try different variations with includeExpired
  const symbols = ["DNB", "DNBA", "DNBASA"];
  
  for (const symbol of symbols) {
    console.log(`\nSearching for ${symbol} (includeExpired=true)...`);
    const results = await searchContract(api, symbol, true);
    if (results.length > 0) {
      results.forEach(r => {
        console.log(`  conId: ${r.conId} | ${r.symbol} | ${r.longName}`);
      });
    } else {
      console.log(`  No results`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  
  api.disconnect();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
