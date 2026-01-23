#!/usr/bin/env tsx
/**
 * Search for available indexes on IB Gateway
 * Tests common Nordic and Norwegian indexes
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

interface IndexToTest {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
}

const INDEXES_TO_TEST: IndexToTest[] = [
  // Norwegian indexes
  { symbol: "OBX", name: "OBX Index", exchange: "OSE", currency: "NOK" },
  { symbol: "OSEBX", name: "Oslo Børs Benchmark Index", exchange: "OSE", currency: "NOK" },
  { symbol: "OSEAX", name: "Oslo Børs All-Share Index", exchange: "OSE", currency: "NOK" },
  { symbol: "OBX25", name: "OBX 25 Index", exchange: "OSE", currency: "NOK" },

  // Nordic indexes
  { symbol: "OMX", name: "OMX Nordic Index", exchange: "OMX", currency: "SEK" },
  { symbol: "OMXS30", name: "OMX Stockholm 30", exchange: "SFB", currency: "SEK" },
  { symbol: "OMXC25", name: "OMX Copenhagen 25", exchange: "OMXCOP", currency: "DKK" },
  { symbol: "OMXH25", name: "OMX Helsinki 25", exchange: "HEX", currency: "EUR" },

  // Alternative exchange codes
  { symbol: "OBX", name: "OBX (OSEBX)", exchange: "OSEBX", currency: "NOK" },
  { symbol: "OBX", name: "OBX (INDEX)", exchange: "INDEX", currency: "NOK" },
];

async function searchIndexes() {
  console.log("Searching for available indexes on IB Gateway...\n");

  const ib = new IBApi({
    clientId: 100,
    host: "127.0.0.1",
    port: 4002,
  });

  let connected = false;

  ib.on(EventName.connected, () => {
    console.log("✓ Connected to IB Gateway\n");
    connected = true;
  });

  ib.on(EventName.disconnected, () => {
    console.log("⚠️  Disconnected\n");
  });

  ib.on(EventName.error, (err, code, reqId) => {
    const codeNum = code as number;
    if (codeNum === ErrorCode.CONNECT_FAIL) {
      console.error("❌ Connection failed");
      return;
    }
    // Ignore info messages
    if (codeNum !== 2104 && codeNum !== 2106 && codeNum !== 2158 && codeNum !== 2119) {
      // Only log non-contract-not-found errors
      if (codeNum !== 200) {
        console.error(`   Error ${code}: ${err} (reqId: ${reqId})`);
      }
    }
  });

  console.log("Connecting to IB Gateway...");
  ib.connect();
  await sleep(3000);

  if (!connected) {
    console.error("❌ Failed to connect to IB Gateway");
    process.exit(1);
  }

  const foundIndexes: Array<{
    symbol: string;
    name: string;
    exchange: string;
    currency: string;
    bars: number;
    earliestDate: string;
    latestDate: string;
    yearsOfData: number;
  }> = [];

  for (const index of INDEXES_TO_TEST) {
    console.log(`Testing: ${index.symbol} (${index.name}) on ${index.exchange}...`);

    const contract: Contract = {
      symbol: index.symbol,
      exchange: index.exchange,
      currency: index.currency,
      secType: SecType.IND, // Index type
    };

    // Add debug logging
    console.log(`   Contract: ${JSON.stringify(contract)}`);

    let dataReceived = false;
    let bars: any[] = [];
    const reqId = 2000 + INDEXES_TO_TEST.indexOf(index);

    const dataHandler = (
      id: number,
      time: string,
      open: number,
      high: number,
      low: number,
      close: number,
      volume: number
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
      // Request 1 year of data to test
      ib.reqHistoricalData(
        reqId,
        contract,
        "",
        "1 Y",
        BarSizeSetting.DAYS_ONE,
        WhatToShow.TRADES,
        1,
        2,
        false,
        []
      );

      // Wait for data
      const maxWait = 30000; // Increased to 30 seconds
      const startTime = Date.now();
      while (!dataReceived && (Date.now() - startTime < maxWait)) {
        await sleep(200);
      }

      ib.off(EventName.historicalData, dataHandler);

      if (dataReceived && bars.length > 0) {
        // Parse dates
        const parseBarTime = (time: string): Date => {
          if (/^\d{8}$/.test(time)) {
            const year = parseInt(time.substring(0, 4));
            const month = parseInt(time.substring(4, 6)) - 1;
            const day = parseInt(time.substring(6, 8));
            return new Date(year, month, day);
          }
          return new Date(parseInt(time) * 1000);
        };

        const firstDate = parseBarTime(bars[0].time);
        const lastDate = parseBarTime(bars[bars.length - 1].time);
        const yearsDiff = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);

        console.log(`   ✅ FOUND! ${bars.length} days of data`);
        console.log(`      Range: ${firstDate.toISOString().slice(0, 10)} to ${lastDate.toISOString().slice(0, 10)}`);
        console.log(`      Latest close: ${bars[bars.length - 1].close}\n`);

        foundIndexes.push({
          symbol: index.symbol,
          name: index.name,
          exchange: index.exchange,
          currency: index.currency,
          bars: bars.length,
          earliestDate: firstDate.toISOString().slice(0, 10),
          latestDate: lastDate.toISOString().slice(0, 10),
          yearsOfData: parseFloat(yearsDiff.toFixed(2)),
        });
      } else {
        console.log(`   ❌ Not found or no data\n`);
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error}\n`);
      ib.off(EventName.historicalData, dataHandler);
    }

    await sleep(3000); // Wait between requests (increased for IB rate limits)
  }

  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY - Available Indexes:");
  console.log("=".repeat(80) + "\n");

  if (foundIndexes.length === 0) {
    console.log("❌ No indexes found\n");
  } else {
    foundIndexes.forEach((idx, i) => {
      console.log(`${i + 1}. ${idx.symbol} - ${idx.name}`);
      console.log(`   Exchange: ${idx.exchange} | Currency: ${idx.currency}`);
      console.log(`   Data: ${idx.bars} days (${idx.yearsOfData} years)`);
      console.log(`   Range: ${idx.earliestDate} to ${idx.latestDate}\n`);
    });
  }

  ib.disconnect();
  process.exit(0);
}

searchIndexes().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
