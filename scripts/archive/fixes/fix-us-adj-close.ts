#!/usr/bin/env tsx
/**
 * Fix adj_close for US dual-listed stocks by fetching ADJUSTED_LAST data from IBKR
 */

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

// US dual-listed stocks that need adj_close fixed
const US_TICKERS = [
  { ticker: "EQNR.US", ibTicker: "EQNR", exchange: "SMART", currency: "USD" },
  { ticker: "FRO.US", ibTicker: "FRO", exchange: "SMART", currency: "USD" },
  { ticker: "FLNG.US", ibTicker: "FLNG", exchange: "SMART", currency: "USD" },
  { ticker: "BWLP.US", ibTicker: "BWLP", exchange: "SMART", currency: "USD" },
  { ticker: "HAFN.US", ibTicker: "HAFN", exchange: "SMART", currency: "USD" },
  { ticker: "BORR.US", ibTicker: "BORR", exchange: "SMART", currency: "USD" },
  { ticker: "ECO.US", ibTicker: "ECO", exchange: "SMART", currency: "USD" },
  { ticker: "HSHP.US", ibTicker: "HSHP", exchange: "SMART", currency: "USD" },
  { ticker: "CDLR", ibTicker: "CDLR", exchange: "SMART", currency: "USD" },
];

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
      clientId: 9, // Different clientId to avoid conflict
      host: "127.0.0.1",
      port: 4002, // IB Gateway port
    });

    this.ib.on(EventName.connected, () => console.log("Connected to IB Gateway"));
    this.ib.on(EventName.disconnected, () => console.log("Disconnected"));

    this.ib.on(EventName.error, (err, code, reqId) => {
      const codeNum = code as number;
      if (codeNum === ErrorCode.CONNECT_FAIL) {
        console.error("Connection failed. Is IB Gateway running?");
        return;
      }
      if (codeNum !== 2104 && codeNum !== 2106 && codeNum !== 2158) {
        console.error(`Error ${code}: ${err} (reqId: ${reqId})`);
      }
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Connection timeout")), 15000);
      this.ib.once(EventName.connected, () => {
        clearTimeout(timeout);
        resolve();
      });
      this.ib.connect();
    });
  }

  async disconnect(): Promise<void> {
    this.ib.disconnect();
    await sleep(500);
  }

  async fetchAdjustedData(
    symbol: string,
    exchange: string,
    currency: string,
    duration: string
  ): Promise<AdjustedBar[]> {
    const reqId = this.nextReqId++;
    const contract: Contract = {
      symbol,
      exchange,
      currency,
      secType: SecType.STK,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timeout for ${symbol}`)), 120000);
      const bars: AdjustedBar[] = [];

      const handleBars = (
        _reqId: number,
        time: string,
        open: number,
        high: number,
        low: number,
        close: number,
        volume: number,
        count: number | undefined,
        WAP: number
      ) => {
        if (_reqId !== reqId) return;
        const dateStr = normalizeIBDate(time);
        if (dateStr && close > 0) {
          bars.push({ time: dateStr, close });
        }
      };

      const handleEnd = (_reqId: number, _start: string, _end: string) => {
        if (_reqId !== reqId) return;
        this.ib.off(EventName.historicalData, handleBars);
        this.ib.off(EventName.historicalDataEnd, handleEnd);
        clearTimeout(timeout);
        resolve(bars);
      };

      this.ib.on(EventName.historicalData, handleBars);
      this.ib.on(EventName.historicalDataEnd, handleEnd);

      try {
        this.ib.reqHistoricalData(
          reqId,
          contract,
          "",
          duration,
          BarSizeSetting.DAYS_ONE,
          WhatToShow.ADJUSTED_LAST,
          1,
          1,
          false
        );
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
      }
    });
  }
}

async function updateAdjClose(ticker: string, adjBars: AdjustedBar[]): Promise<number> {
  let updated = 0;
  for (const bar of adjBars) {
    const result = await pool.query(
      `UPDATE prices_daily
       SET adj_close = $1
       WHERE ticker = $2 AND date = $3 AND source = 'ibkr'`,
      [bar.close, ticker, bar.time]
    );
    if (result.rowCount && result.rowCount > 0) {
      updated += result.rowCount;
    }
  }
  return updated;
}

async function main() {
  console.log("=".repeat(70));
  console.log("FIX ADJ_CLOSE FOR US DUAL-LISTED STOCKS");
  console.log("Fetching ADJUSTED_LAST data from IBKR");
  console.log("=".repeat(70));
  console.log(`\nTickers to fix: ${US_TICKERS.length}\n`);

  const fetcher = new IBDataFetcher();

  try {
    await fetcher.connect();
    console.log("✓ Connected to IB Gateway\n");

    for (const stock of US_TICKERS) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`Processing: ${stock.ticker} (${stock.ibTicker})`);
      console.log(`${"=".repeat(60)}\n`);

      try {
        console.log(`Fetching ADJUSTED_LAST data for ${stock.ibTicker}...`);
        const adjBars = await withRetry(
          () => fetcher.fetchAdjustedData(stock.ibTicker, stock.exchange, stock.currency, "10 Y"),
          `adj-${stock.ticker}`
        );

        console.log(`✓ Fetched ${adjBars.length} adjusted bars`);

        if (adjBars.length === 0) {
          console.log(`⚠ No adjusted data found for ${stock.ticker}`);
          continue;
        }

        console.log(`Updating adj_close in database...`);
        const updated = await updateAdjClose(stock.ticker, adjBars);
        console.log(`✓ Updated ${updated} rows for ${stock.ticker}`);

        await sleep(500); // Rate limiting
      } catch (error: any) {
        console.error(`✗ Error processing ${stock.ticker}:`, error.message);
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log("ADJ_CLOSE FIX COMPLETE");
    console.log("=".repeat(70));
  } catch (error) {
    console.error("Fatal error:", error);
  } finally {
    await fetcher.disconnect();
    await pool.end();
  }
}

main();
