#!/usr/bin/env tsx
/**
 * Search for indexes and commodities on IBKR
 * This script explores what assets are available for correlation analysis
 */

import {
  IBApi,
  EventName,
  ErrorCode,
  Contract,
  SecType,
} from "@stoqey/ib";
import dotenv from "dotenv";

dotenv.config({ path: "apps/web/.env.local" });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class IBSearcher {
  private ib: IBApi;
  private nextReqId = 1;

  constructor() {
    this.ib = new IBApi({
      clientId: 9,
      host: "127.0.0.1",
      port: 4002,
    });

    this.ib.on(EventName.connected, () => console.log("Connected to IB Gateway"));
    this.ib.on(EventName.disconnected, () => console.log("Disconnected"));
    this.ib.on(EventName.error, (err, code, reqId) => {
      const codeNum = code as number;
      if (codeNum !== 2104 && codeNum !== 2106 && codeNum !== 2158) {
        console.error(`Error ${code}: ${err} (reqId: ${reqId})`);
      }
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ib.connect();
      const t = setTimeout(() => reject(new Error("Connection timeout")), 12000);
      this.ib.once(EventName.connected, () => {
        clearTimeout(t);
        setTimeout(resolve, 500);
      });
    });
  }

  async searchContract(contract: Contract): Promise<any[]> {
    return new Promise((resolve) => {
      const reqId = this.nextReqId++;
      const results: any[] = [];
      let resolved = false;

      const cleanup = () => {
        this.ib.off(EventName.contractDetails, onDetails);
        this.ib.off(EventName.contractDetailsEnd, onEnd);
        clearTimeout(timer);
      };

      const onDetails = (_reqId: number, details: any) => {
        if (_reqId !== reqId) return;
        results.push(details);
      };

      const onEnd = (_reqId: number) => {
        if (_reqId !== reqId || resolved) return;
        resolved = true;
        cleanup();
        resolve(results);
      };

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(results);
        }
      }, 10000);

      this.ib.on(EventName.contractDetails, onDetails);
      this.ib.on(EventName.contractDetailsEnd, onEnd);
      this.ib.reqContractDetails(reqId, contract);
    });
  }

  disconnect() {
    this.ib.disconnect();
  }
}

async function main() {
  const searcher = new IBSearcher();

  try {
    await searcher.connect();
    console.log("\n" + "=".repeat(70));
    console.log("SEARCHING FOR INDEXES AND COMMODITIES ON IBKR");
    console.log("=".repeat(70));

    // 1. Search for Oslo Børs / Norwegian indexes
    console.log("\n--- NORWEGIAN INDEXES ---");
    const norwegianIndexes = [
      { symbol: "OBX", exchange: "OSE", secType: SecType.IND },
      { symbol: "OSEBX", exchange: "OSE", secType: SecType.IND },
      { symbol: "OSEAX", exchange: "OSE", secType: SecType.IND },
      { symbol: "OBX", exchange: "SMART", secType: SecType.IND },
    ];

    for (const idx of norwegianIndexes) {
      const contract: Contract = {
        symbol: idx.symbol,
        secType: idx.secType,
        exchange: idx.exchange,
        currency: "NOK",
      };
      console.log(`\nSearching: ${idx.symbol} on ${idx.exchange}...`);
      const results = await searcher.searchContract(contract);
      if (results.length > 0) {
        for (const r of results) {
          const c = r.contract || r;
          console.log(`  FOUND: ${c.symbol} | ${c.localSymbol} | ${c.exchange} | ${c.secType} | conId: ${c.conId}`);
        }
      } else {
        console.log(`  Not found`);
      }
      await sleep(500);
    }

    // 2. Search for European indexes
    console.log("\n--- EUROPEAN INDEXES ---");
    const euroIndexes = [
      { symbol: "DAX", exchange: "EUREX", secType: SecType.IND },
      { symbol: "ESTX50", exchange: "EUREX", secType: SecType.IND },
      { symbol: "FTSE", exchange: "LSE", secType: SecType.IND },
      { symbol: "CAC40", exchange: "SBF", secType: SecType.IND },
      { symbol: "SMI", exchange: "SWX", secType: SecType.IND },
    ];

    for (const idx of euroIndexes) {
      const contract: Contract = {
        symbol: idx.symbol,
        secType: idx.secType,
        exchange: idx.exchange,
      };
      console.log(`\nSearching: ${idx.symbol} on ${idx.exchange}...`);
      const results = await searcher.searchContract(contract);
      if (results.length > 0) {
        for (const r of results.slice(0, 3)) {
          const c = r.contract || r;
          console.log(`  FOUND: ${c.symbol} | ${c.localSymbol} | ${c.exchange} | ${c.currency} | conId: ${c.conId}`);
        }
      } else {
        console.log(`  Not found`);
      }
      await sleep(500);
    }

    // 3. Search for US indexes
    console.log("\n--- US INDEXES ---");
    const usIndexes = [
      { symbol: "SPX", exchange: "CBOE", secType: SecType.IND },
      { symbol: "NDX", exchange: "NASDAQ", secType: SecType.IND },
      { symbol: "INDU", exchange: "NYSE", secType: SecType.IND },
      { symbol: "VIX", exchange: "CBOE", secType: SecType.IND },
    ];

    for (const idx of usIndexes) {
      const contract: Contract = {
        symbol: idx.symbol,
        secType: idx.secType,
        exchange: idx.exchange,
        currency: "USD",
      };
      console.log(`\nSearching: ${idx.symbol} on ${idx.exchange}...`);
      const results = await searcher.searchContract(contract);
      if (results.length > 0) {
        for (const r of results.slice(0, 2)) {
          const c = r.contract || r;
          console.log(`  FOUND: ${c.symbol} | ${c.localSymbol} | ${c.exchange} | conId: ${c.conId}`);
        }
      } else {
        console.log(`  Not found`);
      }
      await sleep(500);
    }

    // 4. Search for Commodities (Futures)
    console.log("\n--- COMMODITIES (FUTURES) ---");
    const commodityFutures = [
      { symbol: "CL", exchange: "NYMEX", name: "Crude Oil" },
      { symbol: "GC", exchange: "COMEX", name: "Gold" },
      { symbol: "SI", exchange: "COMEX", name: "Silver" },
      { symbol: "HG", exchange: "COMEX", name: "Copper" },
      { symbol: "ALI", exchange: "COMEX", name: "Aluminum" },
      { symbol: "BZ", exchange: "NYMEX", name: "Brent Crude" },
      { symbol: "NG", exchange: "NYMEX", name: "Natural Gas" },
    ];

    for (const comm of commodityFutures) {
      const contract: Contract = {
        symbol: comm.symbol,
        secType: SecType.FUT,
        exchange: comm.exchange,
        currency: "USD",
      };
      console.log(`\nSearching: ${comm.name} (${comm.symbol}) on ${comm.exchange}...`);
      const results = await searcher.searchContract(contract);
      if (results.length > 0) {
        // Show first 3 contracts (nearest expiries)
        for (const r of results.slice(0, 3)) {
          const c = r.contract || r;
          console.log(`  FOUND: ${c.symbol} | ${c.localSymbol} | Exp: ${c.lastTradeDateOrContractMonth} | conId: ${c.conId}`);
        }
      } else {
        console.log(`  Not found`);
      }
      await sleep(500);
    }

    // 5. Search for Commodity ETFs (easier for historical data)
    console.log("\n--- COMMODITY ETFs (STOCKS) ---");
    const commodityEtfs = [
      { symbol: "USO", exchange: "ARCA", name: "US Oil Fund" },
      { symbol: "GLD", exchange: "ARCA", name: "Gold ETF" },
      { symbol: "SLV", exchange: "ARCA", name: "Silver ETF" },
      { symbol: "COPX", exchange: "ARCA", name: "Copper Miners ETF" },
      { symbol: "JJC", exchange: "ARCA", name: "Copper ETN" },
      { symbol: "DBB", exchange: "ARCA", name: "Base Metals ETF" },
      { symbol: "DBC", exchange: "ARCA", name: "Commodity Index" },
      { symbol: "XLE", exchange: "ARCA", name: "Energy Select" },
      { symbol: "XOP", exchange: "ARCA", name: "Oil & Gas E&P" },
    ];

    for (const etf of commodityEtfs) {
      const contract: Contract = {
        symbol: etf.symbol,
        secType: SecType.STK,
        exchange: etf.exchange,
        currency: "USD",
      };
      console.log(`\nSearching: ${etf.name} (${etf.symbol})...`);
      const results = await searcher.searchContract(contract);
      if (results.length > 0) {
        const r = results[0];
        const c = r.contract || r;
        console.log(`  FOUND: ${c.symbol} | ${c.exchange} | conId: ${c.conId}`);
      } else {
        console.log(`  Not found`);
      }
      await sleep(500);
    }

    // 6. Search for Index ETFs
    console.log("\n--- INDEX ETFs ---");
    const indexEtfs = [
      { symbol: "SPY", exchange: "ARCA", name: "S&P 500 ETF" },
      { symbol: "QQQ", exchange: "NASDAQ", name: "Nasdaq 100 ETF" },
      { symbol: "IWM", exchange: "ARCA", name: "Russell 2000 ETF" },
      { symbol: "EFA", exchange: "ARCA", name: "EAFE (Europe/Asia) ETF" },
      { symbol: "VGK", exchange: "ARCA", name: "Europe ETF" },
      { symbol: "EWN", exchange: "ARCA", name: "Netherlands ETF" },
      { symbol: "EWD", exchange: "ARCA", name: "Sweden ETF" },
      { symbol: "NORW", exchange: "ARCA", name: "Norway ETF" },
    ];

    for (const etf of indexEtfs) {
      const contract: Contract = {
        symbol: etf.symbol,
        secType: SecType.STK,
        exchange: etf.exchange,
        currency: "USD",
      };
      console.log(`\nSearching: ${etf.name} (${etf.symbol})...`);
      const results = await searcher.searchContract(contract);
      if (results.length > 0) {
        const r = results[0];
        const c = r.contract || r;
        console.log(`  FOUND: ${c.symbol} | ${c.exchange} | conId: ${c.conId}`);
      } else {
        console.log(`  Not found`);
      }
      await sleep(500);
    }

    console.log("\n" + "=".repeat(70));
    console.log("SEARCH COMPLETE");
    console.log("=".repeat(70));

  } finally {
    searcher.disconnect();
  }
}

main().catch(console.error);
