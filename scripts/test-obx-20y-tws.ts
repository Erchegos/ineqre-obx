#!/usr/bin/env tsx
/**
 * Test script to check if we can fetch 20 years of OBX data from TWS/IB Gateway
 * Uses @stoqey/ib library (same as import script)
 */

import {
  IBApi,
  EventName,
  ErrorCode,
  Contract,
  SecType,
  BarSizeSetting,
  WhatToShow,
} from "@stoqey/ib";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface HistoricalBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function testOBX20Years() {
  console.log("Testing OBX 20-year data fetch from TWS/IB Gateway...\n");

  const ib = new IBApi({
    clientId: 99,
    host: "127.0.0.1",
    port: 4002, // IB Gateway port (4001 = TWS, 4002 = Gateway)
  });

  let connected = false;
  let errorOccurred = false;
  let contractResolved = false;
  let dataReceived = false;
  let bars: HistoricalBar[] = [];

  ib.on(EventName.connected, () => {
    console.log("✓ Connected to TWS\n");
    connected = true;
  });

  ib.on(EventName.disconnected, () => {
    console.log("⚠️  Disconnected from TWS");
  });

  ib.on(EventName.error, (err, code, reqId) => {
    const codeNum = code as number;
    if (codeNum === ErrorCode.CONNECT_FAIL) {
      console.error("❌ Connection failed. Is IB Gateway running with API enabled on port 4002?");
      errorOccurred = true;
      return;
    }
    // Ignore info messages
    if (codeNum !== 2104 && codeNum !== 2106 && codeNum !== 2158 && codeNum !== 2119) {
      console.error(`Error ${code}: ${err} (reqId: ${reqId})`);
    }
  });

  // Connect
  console.log("1. Connecting to IB Gateway on port 4002...");
  ib.connect();

  // Wait for connection
  await sleep(3000);

  if (!connected) {
    console.error("❌ Failed to connect to IB Gateway");
    console.error("   Make sure IB Gateway is running");
    console.error("   Enable API in settings (port 4002)");
    process.exit(1);
  }

  // Define OBX contract
  const obxContract: Contract = {
    symbol: "OBX",
    exchange: "OSE",
    currency: "NOK",
    secType: SecType.IND, // Index
  };

  console.log("2. Testing OBX contract...");
  console.log(`   Symbol: ${obxContract.symbol}`);
  console.log(`   Exchange: ${obxContract.exchange}`);
  console.log(`   Type: ${obxContract.secType}\n`);

  // Test different duration strings (IB format)
  const durations = [
    { label: "20 years", duration: "20 Y" },
    { label: "15 years", duration: "15 Y" },
    { label: "10 years", duration: "10 Y" },
    { label: "5 years", duration: "5 Y" },
  ];

  for (const test of durations) {
    console.log(`3. Fetching ${test.label} of historical data (${test.duration})...`);

    bars = [];
    dataReceived = false;
    errorOccurred = false;

    const reqId = 1000;

    // Listen for historical data
    const dataHandler = (
      id: number,
      time: string,
      open: number,
      high: number,
      low: number,
      close: number,
      volume: number,
      count: number,
      WAP: number
    ) => {
      if (id === reqId && time.startsWith("finished")) {
        dataReceived = true;
        return;
      }
      if (id === reqId) {
        bars.push({ time, open, high, low, close, volume });
      }
    };

    ib.on(EventName.historicalData, dataHandler);

    try {
      // Request historical data
      ib.reqHistoricalData(
        reqId,
        obxContract,
        "", // endDateTime (empty = most recent)
        test.duration,
        BarSizeSetting.DAYS_ONE,
        WhatToShow.TRADES,
        1, // Regular trading hours
        2, // Date format: 1 = yyyyMMdd, 2 = epoch seconds
        false,
        []
      );

      // Wait for data (max 30 seconds)
      const maxWait = 30000;
      const startTime = Date.now();
      while (!dataReceived && !errorOccurred && (Date.now() - startTime < maxWait)) {
        await sleep(100);
      }

      ib.off(EventName.historicalData, dataHandler);

      if (errorOccurred) {
        console.log(`   ❌ Error occurred while fetching ${test.label}\n`);
        continue;
      }

      if (!dataReceived || bars.length === 0) {
        console.log(`   ⚠️  No data returned for ${test.label}\n`);
        continue;
      }

      // Calculate date range
      // Time can be in format "YYYYMMDD" or epoch seconds
      const parseBarTime = (time: string): Date => {
        // Try YYYYMMDD format first
        if (/^\d{8}$/.test(time)) {
          const year = parseInt(time.substring(0, 4));
          const month = parseInt(time.substring(4, 6)) - 1;
          const day = parseInt(time.substring(6, 8));
          return new Date(year, month, day);
        }
        // Try epoch seconds
        return new Date(parseInt(time) * 1000);
      };

      const firstDate = parseBarTime(bars[0].time);
      const lastDate = parseBarTime(bars[bars.length - 1].time);
      const yearsDiff = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);

      console.log(`   ✓ Success! Retrieved ${bars.length} days of data`);
      console.log(`   Earliest: ${firstDate.toISOString().slice(0, 10)}`);
      console.log(`   Latest: ${lastDate.toISOString().slice(0, 10)}`);
      console.log(`   Span: ${yearsDiff.toFixed(2)} years`);
      console.log(`   First bar: O=${bars[0].open} H=${bars[0].high} L=${bars[0].low} C=${bars[0].close}`);
      console.log(`   Last bar: O=${bars[bars.length-1].open} H=${bars[bars.length-1].high} L=${bars[bars.length-1].low} C=${bars[bars.length-1].close}\n`);

      // If 20y worked, we're done
      if (test.label === "20 years") {
        console.log("🎉 SUCCESS: 20 years of OBX data is available from IB Gateway!");
        console.log(`\nThe OBX index has ${bars.length} trading days over ${yearsDiff.toFixed(2)} years.`);
        console.log(`\nYou can now import this data to the database.`);
        ib.disconnect();
        process.exit(0);
      }

    } catch (error) {
      console.error(`   ❌ Failed to fetch ${test.label}:`, error);
      ib.off(EventName.historicalData, dataHandler);
    }

    await sleep(2000); // Wait between requests
  }

  console.log("\n⚠️  Could not fetch 20 years of data. Maximum available period shown above.");
  ib.disconnect();
  process.exit(1);
}

testOBX20Years().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
