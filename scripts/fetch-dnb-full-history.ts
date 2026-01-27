#!/usr/bin/env tsx
/**
 * Try to fetch full DNB history from IBKR
 * Request maximum duration to see how far back data goes
 */

import { IBApi, EventName, Contract, SecType, BarSizeSetting, WhatToShow } from "@stoqey/ib";

const GATEWAY_PORT = 4002;
const CLIENT_ID = 998;

async function fetchHistory(api: IBApi, conId: number, symbol: string, duration: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const reqId = Math.floor(Math.random() * 10000);
    const bars: any[] = [];
    
    api.on(EventName.historicalData, (id, date, open, high, low, close, volume) => {
      if (id === reqId && date !== "finished") {
        bars.push({ date, open, high, low, close, volume });
      }
    });
    
    api.on(EventName.historicalDataEnd, (id) => {
      if (id === reqId) {
        console.log(`\n=== ${symbol} (conId: ${conId}) - Duration: ${duration} ===`);
        console.log(`Total bars: ${bars.length}`);
        if (bars.length > 0) {
          console.log(`First date: ${bars[0].date}`);
          console.log(`Last date: ${bars[bars.length - 1].date}`);
          console.log(`\nFirst 5 bars:`);
          bars.slice(0, 5).forEach(b => console.log(`  ${b.date}: O=${b.open} H=${b.high} L=${b.low} C=${b.close} V=${b.volume}`));
        }
        resolve();
      }
    });
    
    api.on(EventName.error, (id, code, msg) => {
      if (id === reqId) {
        if (code === 162) {
          console.log(`No data for duration ${duration}: ${msg}`);
          resolve();
        } else if (code !== 2104 && code !== 2106 && code !== 2158) {
          console.error(`Error ${code}: ${msg}`);
          resolve();
        }
      }
    });
    
    const contract: Contract = {
      conId,
      symbol,
      secType: SecType.STK,
      exchange: "OSE",
      currency: "NOK",
    };
    
    const endDateTime = "";  // Current time
    api.reqHistoricalData(
      reqId,
      contract,
      endDateTime,
      duration,
      BarSizeSetting.DAYS_ONE,
      WhatToShow.TRADES,
      1,  // Use RTH
      1,  // Format date as string
      false
    );
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
  
  // DNB Bank ASA - current conId
  const dnbConId = 500567119;
  
  // Try different durations to see how far back we can go
  const durations = ["25 Y", "20 Y", "15 Y", "10 Y"];
  
  for (const duration of durations) {
    try {
      await fetchHistory(api, dnbConId, "DNB", duration);
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.error(`Failed for ${duration}:`, e);
    }
  }
  
  api.disconnect();
  console.log("\nDone");
  process.exit(0);
}

main().catch(console.error);
