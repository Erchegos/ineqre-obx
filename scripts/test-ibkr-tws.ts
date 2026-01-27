#!/usr/bin/env tsx
/**
 * Test IBKR connection using TWS API (@stoqey/ib)
 * This is the correct way to connect to IB Gateway
 */

import { IBApi, EventName, ErrorCode } from "@stoqey/ib";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function testConnection() {
  console.log("Testing IBKR TWS API connection...\n");

  const ib = new IBApi({
    clientId: 100, // Use unique client ID
    host: "127.0.0.1",
    port: 4002, // IB Gateway port
  });

  let connected = false;
  let connectionError: string | null = null;

  // Connection handlers
  ib.on(EventName.connected, () => {
    console.log("[OK] Connected to IB Gateway");
    connected = true;
  });

  ib.on(EventName.disconnected, () => {
    console.log("[INFO] Disconnected from IB Gateway");
  });

  ib.on(EventName.error, (err, code, reqId) => {
    const codeNum = code as number;

    if (codeNum === ErrorCode.CONNECT_FAIL) {
      console.error("[ERROR] Connection failed");
      console.error("  - Is IB Gateway running?");
      console.error("  - Is API enabled in settings?");
      console.error("  - Is port 4002 configured?");
      connectionError = "Connection failed";
      return;
    }

    // Info messages (can be ignored)
    if (codeNum === 2104 || codeNum === 2106 || codeNum === 2158 || codeNum === 2119) {
      console.log(`[INFO] ${err}`);
      return;
    }

    // Other errors
    console.error(`[ERROR] ${code}: ${err} (reqId: ${reqId})`);
  });

  // Server version info
  ib.on(EventName.server, (version, connectionTime) => {
    console.log(`[INFO] Server version: ${version}`);
    console.log(`[INFO] Connection time: ${connectionTime}`);
  });

  // Managed accounts
  ib.on(EventName.managedAccounts, (accounts) => {
    console.log(`[INFO] Managed accounts: ${accounts}`);
  });

  // Attempt connection
  console.log("Connecting to IB Gateway on port 4002...");
  ib.connect();

  // Wait for connection
  await sleep(3000);

  if (connectionError) {
    console.error("\n[FAILED] Could not connect to IB Gateway");
    process.exit(1);
  }

  if (!connected) {
    console.error("\n[FAILED] Connection timeout");
    console.error("Make sure:");
    console.error("  1. IB Gateway is running");
    console.error("  2. API is enabled in Global Configuration");
    console.error("  3. Port 4002 is configured");
    console.error("  4. Socket port is set to 4002");
    process.exit(1);
  }

  console.log("\n[SUCCESS] IBKR Gateway is properly configured and accessible");
  console.log("You can now use the TWS API to fetch market data");

  // Disconnect
  ib.disconnect();
  await sleep(500);

  process.exit(0);
}

testConnection().catch((error) => {
  console.error("[ERROR] Test failed:", error);
  process.exit(1);
});
