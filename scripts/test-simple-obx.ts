#!/usr/bin/env tsx
/**
 * Simple test - just OBX to confirm it works
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

async function testOBX() {
  console.log("Testing OBX...\n");

  const ib = new IBApi({
    clientId: 101,
    host: "127.0.0.1",
    port: 4002,
  });

  let connected = false;

  ib.on(EventName.connected, () => {
    console.log("✓ Connected\n");
    connected = true;
  });

  ib.on(EventName.error, (err, code, reqId) => {
    const codeNum = code as number;
    if (codeNum !== 2104 && codeNum !== 2106 && codeNum !== 2158 && codeNum !== 2119) {
      console.error(`Error ${code}: ${err} (reqId: ${reqId})`);
    }
  });

  ib.connect();
  await sleep(3000);

  if (!connected) {
    console.error("Failed to connect");
    process.exit(1);
  }

  const obxContract: Contract = {
    symbol: "OBX",
    exchange: "OSE",
    currency: "NOK",
    secType: SecType.IND,
  };

  console.log("Requesting OBX data...");
  console.log("Contract:", JSON.stringify(obxContract, null, 2));

  let dataReceived = false;
  let bars: any[] = [];

  ib.on(EventName.historicalData, (reqId, time, open, high, low, close, volume) => {
    if (time.startsWith("finished")) {
      dataReceived = true;
      console.log(`✓ Received ${bars.length} bars\n`);
      return;
    }
    bars.push({ time, open, high, low, close, volume });
  });

  ib.reqHistoricalData(
    1,
    obxContract,
    "",
    "5 Y",
    BarSizeSetting.DAYS_ONE,
    WhatToShow.TRADES,
    1,
    2,
    false,
    []
  );

  // Wait
  for (let i = 0; i < 300; i++) {
    if (dataReceived) break;
    await sleep(100);
  }

  if (bars.length > 0) {
    console.log(`First bar: ${bars[0].time} - Close: ${bars[0].close}`);
    console.log(`Last bar: ${bars[bars.length - 1].time} - Close: ${bars[bars.length - 1].close}`);
  } else {
    console.log("No data received");
  }

  ib.disconnect();
}

testOBX();
