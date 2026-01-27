#!/usr/bin/env tsx
/**
 * Test fetching DNB historical data with different WhatToShow values
 */

import { IBApi, EventName, Contract, SecType, BarSizeSetting, WhatToShow } from "@stoqey/ib";

const GATEWAY_PORT = 4002;
const CLIENT_ID = 996;

async function fetchHistory(api: IBApi, whatToShow: WhatToShow): Promise<void> {
  return new Promise((resolve) => {
    const reqId = Math.floor(Math.random() * 10000);
    const bars: any[] = [];
    let resolved = false;
    
    const finish = () => {
      if (!resolved) {
        resolved = true;
        console.log(`\nWhatToShow: ${whatToShow}`);
        console.log(`  Total bars: ${bars.length}`);
        if (bars.length > 0) {
          console.log(`  Date range: ${bars[0].date} to ${bars[bars.length - 1].date}`);
          console.log(`  First: ${bars[0].date} C=${bars[0].close}`);
        }
        resolve();
      }
    };
    
    api.on(EventName.historicalData, (id, date, open, high, low, close, volume) => {
      if (id === reqId && date !== "finished") {
        bars.push({ date, open, high, low, close, volume });
      }
    });
    
    api.on(EventName.historicalDataEnd, (id) => {
      if (id === reqId) finish();
    });
    
    api.on(EventName.error, (id, code, msg) => {
      if (id === reqId) {
        if (code === 162) {
          console.log(`  No data: ${msg}`);
        } else if (code !== 2104 && code !== 2106 && code !== 2158) {
          console.log(`  Error ${code}: ${msg}`);
        }
        finish();
      }
    });
    
    const contract: Contract = {
      conId: 500567119,
      symbol: "DNB",
      secType: SecType.STK,
      exchange: "OSE",
      currency: "NOK",
    };
    
    api.reqHistoricalData(
      reqId,
      contract,
      "",  // Current time
      "10 Y",  // 10 years
      BarSizeSetting.DAYS_ONE,
      whatToShow,
      1,
      1,
      false
    );
    
    setTimeout(finish, 8000);
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
  
  // Try TRADES (most reliable for daily data)
  await fetchHistory(api, WhatToShow.TRADES);
  await new Promise(r => setTimeout(r, 1000));
  
  // Try ADJUSTED_LAST
  await fetchHistory(api, WhatToShow.ADJUSTED_LAST);
  
  api.disconnect();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
