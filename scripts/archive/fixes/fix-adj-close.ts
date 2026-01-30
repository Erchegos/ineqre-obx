#!/usr/bin/env tsx
/**
 * Fix adj_close for new stocks by fetching ADJUSTED_LAST data from IBKR
 * Uses low-level IBApi directly (not TWSClient which hardcodes WhatToShow.TRADES)
 */

// Disable SSL certificate validation BEFORE importing pg
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { Pool } from "pg";
import dotenv from "dotenv";
import {
  IBApi,
  EventName,
  ErrorCode,
  Contract,
  SecType,
  BarSizeSetting,
  WhatToShow,
} from "@stoqey/ib";

dotenv.config({ path: "apps/web/.env.local" });
dotenv.config({ path: ".env.local" });
dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL missing");

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const waitMs = 500 * attempt * attempt;
      console.warn(`${label} failed attempt ${attempt}, waiting ${waitMs}ms`);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

// New tickers that need adj_close fixed (32 stocks added after initial import)
const NEW_TICKERS = [
  "NONG", "PARB", "AKSO", "BWO", "SOFF", "BONHR", "ODF", "HUNT", "KCC", "KID",
  "AKVA", "MULTI", "PHO", "NEXT", "IDEX", "OTEC", "PEXIP", "PCIB", "MEDI", "GSF",
  "ENDUR", "KMCP", "BOUV", "ABG", "NORBT", "NEL", "NAPA", "KOA", "2020", "ABL",
  "ARCH", "AKAST"
];

interface StockContract {
  conId: number;
  symbol: string;
  exchange: string;
  currency: string;
  localSymbol: string;
}

interface AdjustedBar {
  time: string; // YYYYMMDD
  close: number;
}

const normalizeIBDate = (t: string): string | null => {
  if (/^\d{8}$/.test(t)) return t;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.replace(/-/g, "");
  return null;
};

class IBDataFetcher {
  private ib: IBApi;
  private nextReqId = 1;

  constructor() {
    this.ib = new IBApi({
      clientId: 8, // Different clientId to avoid conflict
      host: "127.0.0.1",
      port: 4002, // IB Gateway port (4001 for TWS)
    });

    this.ib.on(EventName.connected, () => console.log("Connected to TWS"));
    this.ib.on(EventName.disconnected, () => console.log("Disconnected from TWS"));

    this.ib.on(EventName.error, (err, code, reqId) => {
      const codeNum = code as number;
      if (codeNum === ErrorCode.CONNECT_FAIL) {
        console.error("Connection failed. Is TWS running and API enabled?");
        return;
      }
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

      this.ib.once(EventName.error, (_err, code) => {
        if (code === ErrorCode.CONNECT_FAIL) {
          clearTimeout(t);
          reject(new Error("Failed to connect to TWS"));
        }
      });
    });
  }

  async searchContract(symbol: string): Promise<StockContract | null> {
    return new Promise((resolve) => {
      const reqId = this.nextReqId++;

      const contract: Contract = {
        symbol,
        secType: SecType.STK,
        exchange: "OSE",
        currency: "NOK",
      };

      let resolved = false;
      const results: any[] = [];

      const cleanup = () => {
        this.ib.off(EventName.contractDetails, onDetails);
        this.ib.off(EventName.contractDetailsEnd, onEnd);
        clearTimeout(timer);
      };

      const onDetails = (_reqId: number, details: any) => {
        if (resolved || _reqId !== reqId) return;
        results.push(details);
      };

      const onEnd = (_reqId: number) => {
        if (resolved || _reqId !== reqId) return;
        resolved = true;
        cleanup();

        if (!results.length) return resolve(null);

        const d = results[0];
        const c = d.contract || d;

        resolve({
          conId: c.conId,
          symbol: c.symbol || symbol,
          exchange: c.exchange || "OSE",
          currency: c.currency || "NOK",
          localSymbol: c.localSymbol || c.symbol || symbol,
        });
      };

      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        if (!results.length) return resolve(null);
        const d = results[0];
        const c = d.contract || d;
        resolve({
          conId: c.conId,
          symbol: c.symbol || symbol,
          exchange: c.exchange || "OSE",
          currency: c.currency || "NOK",
          localSymbol: c.localSymbol || c.symbol || symbol,
        });
      }, 8000);

      this.ib.on(EventName.contractDetails, onDetails);
      this.ib.on(EventName.contractDetailsEnd, onEnd);

      this.ib.reqContractDetails(reqId, contract);
    });
  }

  async fetchAdjustedData(contract: StockContract, duration: string): Promise<AdjustedBar[]> {
    return new Promise((resolve, reject) => {
      const reqId = this.nextReqId++;

      const ibContract: Contract = {
        conId: contract.conId,
        symbol: contract.symbol,
        secType: SecType.STK,
        exchange: contract.exchange,
        currency: contract.currency,
      };

      let resolved = false;
      const bars: AdjustedBar[] = [];

      const HARD_TIMEOUT_MS = 90000;
      const IDLE_TIMEOUT_MS = 2000;
      let lastBarAt = Date.now();

      const HISTORICAL_DATA_END = 'historicalDataEnd' as any;

      const cleanup = () => {
        this.ib.off(EventName.historicalData, onBar);
        this.ib.off(HISTORICAL_DATA_END, onEnd);
        clearTimeout(hardTimer);
        clearInterval(idleTimer);
      };

      const finish = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(bars);
      };

      const hardTimer = setTimeout(() => {
        console.warn(`Hard timeout fetching adjusted data for ${contract.symbol}`);
        finish();
      }, HARD_TIMEOUT_MS);

      const idleTimer = setInterval(() => {
        if (resolved) return;
        if (bars.length > 0 && Date.now() - lastBarAt > IDLE_TIMEOUT_MS) finish();
      }, 200);

      const onBar = (
        _reqId: number,
        time: string,
        _open: number,
        _high: number,
        _low: number,
        close: number,
        _volume: number
      ) => {
        if (resolved || _reqId !== reqId) return;

        const d = normalizeIBDate(time);
        if (!d) return;

        lastBarAt = Date.now();

        if (close > 0) {
          bars.push({ time: d, close });
        }
      };

      const onEnd = (_reqId: number) => {
        if (resolved || _reqId !== reqId) return;
        finish();
      };

      this.ib.on(EventName.historicalData, onBar);
      this.ib.on(HISTORICAL_DATA_END, onEnd);

      try {
        // Use WhatToShow.ADJUSTED_LAST for dividend-adjusted prices
        this.ib.reqHistoricalData(
          reqId,
          ibContract,
          "",
          duration,
          BarSizeSetting.DAYS_ONE,
          WhatToShow.ADJUSTED_LAST,
          1,
          1,
          false
        );
      } catch (e) {
        cleanup();
        reject(e);
      }
    });
  }

  disconnect() {
    this.ib.disconnect();
  }
}

async function updateAdjClose(ticker: string, bars: AdjustedBar[]): Promise<number> {
  if (!bars.length) return 0;

  // Batch update in chunks of 500
  const CHUNK_SIZE = 500;
  let totalUpdated = 0;

  for (let i = 0; i < bars.length; i += CHUNK_SIZE) {
    const chunk = bars.slice(i, i + CHUNK_SIZE);

    // Build VALUES clause
    const values: any[] = [];
    const valueRows: string[] = [];

    for (let j = 0; j < chunk.length; j++) {
      const bar = chunk[j];
      const year = bar.time.substring(0, 4);
      const month = bar.time.substring(4, 6);
      const day = bar.time.substring(6, 8);
      const date = `${year}-${month}-${day}`;

      const base = j * 2;
      valueRows.push(`($${base + 1}::date, $${base + 2}::numeric)`);
      values.push(date, bar.close);
    }

    try {
      const result = await pool.query(`
        UPDATE prices_daily p
        SET adj_close = v.adj_close
        FROM (VALUES ${valueRows.join(', ')}) AS v(date, adj_close)
        WHERE p.ticker = '${ticker}' AND p.date = v.date AND p.source = 'ibkr'
      `, values);

      totalUpdated += result.rowCount || 0;
    } catch (e) {
      console.error(`  Batch update error: ${e}`);
    }
  }

  return totalUpdated;
}

async function fixTickerAdjClose(fetcher: IBDataFetcher, ticker: string): Promise<{ success: boolean; updated?: number; error?: string }> {
  console.log(`\nProcessing ${ticker}...`);

  const contract = await withRetry(() => fetcher.searchContract(ticker), `contract ${ticker}`);

  if (!contract) {
    console.log(`  ${ticker} - Not found`);
    return { success: false, error: "Not found" };
  }

  console.log(`  Found ${contract.symbol} (conId: ${contract.conId})`);

  // Fetch ADJUSTED_LAST data (20 years to match original import)
  const adjBars = await withRetry(
    () => fetcher.fetchAdjustedData(contract, "20 Y"),
    `hist-adj ${ticker}`
  );

  if (!adjBars.length) {
    console.log(`  No adjusted data available`);
    return { success: false, error: "No adjusted data" };
  }

  console.log(`  Fetched ${adjBars.length} adjusted bars`);

  // Update database
  const updated = await updateAdjClose(ticker, adjBars);
  console.log(`  Updated ${updated} rows with adjusted prices`);

  return { success: true, updated };
}

async function main() {
  console.log("=".repeat(70));
  console.log("FIX ADJ_CLOSE FOR NEW STOCKS");
  console.log("Fetching ADJUSTED_LAST data from IBKR");
  console.log("=".repeat(70));
  console.log(`\nTickers to fix: ${NEW_TICKERS.length}\n`);

  const fetcher = new IBDataFetcher();

  const results: { ticker: string; success: boolean; updated?: number; error?: string }[] = [];

  try {
    await fetcher.connect();
    console.log("[OK] Connected to TWS on port 4001\n");

    for (let i = 0; i < NEW_TICKERS.length; i++) {
      const ticker = NEW_TICKERS[i];
      console.log(`[${i + 1}/${NEW_TICKERS.length}] ${ticker}`);

      try {
        const result = await fixTickerAdjClose(fetcher, ticker);
        results.push({ ticker, ...result });
      } catch (e: any) {
        results.push({ ticker, success: false, error: e.message });
        console.log(`  FAILED - ${e.message}`);
      }

      // Rate limiting
      await sleep(500);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("ADJ_CLOSE FIX SUMMARY");
    console.log("=".repeat(70));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`Total: ${NEW_TICKERS.length}`);
    console.log(`Successful: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);

    if (successful.length > 0) {
      const totalUpdated = successful.reduce((sum, r) => sum + (r.updated || 0), 0);
      console.log(`Total rows updated: ${totalUpdated}`);
    }

    if (failed.length > 0) {
      console.log("\nFailed tickers:");
      failed.forEach(r => console.log(`  - ${r.ticker}: ${r.error}`));
    }

  } finally {
    fetcher.disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
