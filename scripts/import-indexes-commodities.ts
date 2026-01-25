#!/usr/bin/env tsx
/**
 * Import Indexes and Commodities from IBKR
 *
 * Fetches historical data for:
 * - Norwegian indexes (OBX, OSEBX, OSEAX)
 * - European indexes (DAX, ESTX50)
 * - US indexes (SPX, NDX, VIX)
 * - Commodity ETFs (USO, GLD, SLV, COPX, DBB, DBC, XLE, XOP)
 * - Index ETFs (SPY, QQQ, IWM, EFA, VGK, EWN, EWD, NORW)
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

// Assets to import
interface AssetConfig {
  symbol: string;
  conId: number;
  secType: SecType;
  exchange: string;
  currency: string;
  name: string;
  category: 'index' | 'commodity_etf' | 'index_etf';
}

const ASSETS: AssetConfig[] = [
  // Norwegian Indexes
  { symbol: "OBX", conId: 11055503, secType: SecType.IND, exchange: "OSE", currency: "NOK", name: "OBX Index", category: "index" },
  { symbol: "OSEBX", conId: 424450933, secType: SecType.IND, exchange: "OSE", currency: "NOK", name: "Oslo Børs Benchmark Index", category: "index" },
  { symbol: "OSEAX", conId: 424450944, secType: SecType.IND, exchange: "OSE", currency: "NOK", name: "Oslo Børs All Share Index", category: "index" },

  // European Indexes
  { symbol: "DAX", conId: 825711, secType: SecType.IND, exchange: "EUREX", currency: "EUR", name: "DAX Index", category: "index" },
  { symbol: "ESTX50", conId: 4356500, secType: SecType.IND, exchange: "EUREX", currency: "EUR", name: "Euro Stoxx 50", category: "index" },

  // US Indexes
  { symbol: "SPX", conId: 416904, secType: SecType.IND, exchange: "CBOE", currency: "USD", name: "S&P 500 Index", category: "index" },
  { symbol: "NDX", conId: 416843, secType: SecType.IND, exchange: "NASDAQ", currency: "USD", name: "Nasdaq 100 Index", category: "index" },
  { symbol: "VIX", conId: 13455763, secType: SecType.IND, exchange: "CBOE", currency: "USD", name: "CBOE Volatility Index", category: "index" },

  // Commodity ETFs
  { symbol: "USO", conId: 418893644, secType: SecType.STK, exchange: "ARCA", currency: "USD", name: "United States Oil Fund", category: "commodity_etf" },
  { symbol: "GLD", conId: 51529211, secType: SecType.STK, exchange: "ARCA", currency: "USD", name: "SPDR Gold Trust", category: "commodity_etf" },
  { symbol: "SLV", conId: 39039301, secType: SecType.STK, exchange: "ARCA", currency: "USD", name: "iShares Silver Trust", category: "commodity_etf" },
  { symbol: "COPX", conId: 211651700, secType: SecType.STK, exchange: "ARCA", currency: "USD", name: "Global X Copper Miners ETF", category: "commodity_etf" },
  { symbol: "DBB", conId: 319355727, secType: SecType.STK, exchange: "ARCA", currency: "USD", name: "Invesco DB Base Metals Fund", category: "commodity_etf" },
  { symbol: "DBC", conId: 319355208, secType: SecType.STK, exchange: "ARCA", currency: "USD", name: "Invesco DB Commodity Index", category: "commodity_etf" },
  { symbol: "XLE", conId: 4215217, secType: SecType.STK, exchange: "ARCA", currency: "USD", name: "Energy Select Sector SPDR", category: "commodity_etf" },
  { symbol: "XOP", conId: 413951498, secType: SecType.STK, exchange: "ARCA", currency: "USD", name: "SPDR S&P Oil & Gas E&P ETF", category: "commodity_etf" },

  // Index ETFs
  { symbol: "SPY", conId: 756733, secType: SecType.STK, exchange: "ARCA", currency: "USD", name: "SPDR S&P 500 ETF", category: "index_etf" },
  { symbol: "QQQ", conId: 320227571, secType: SecType.STK, exchange: "NASDAQ", currency: "USD", name: "Invesco QQQ Trust", category: "index_etf" },
  { symbol: "IWM", conId: 9579970, secType: SecType.STK, exchange: "ARCA", currency: "USD", name: "iShares Russell 2000 ETF", category: "index_etf" },
  { symbol: "EFA", conId: 13002510, secType: SecType.STK, exchange: "ARCA", currency: "USD", name: "iShares MSCI EAFE ETF", category: "index_etf" },
  { symbol: "VGK", conId: 27684070, secType: SecType.STK, exchange: "ARCA", currency: "USD", name: "Vanguard FTSE Europe ETF", category: "index_etf" },
  { symbol: "EWN", conId: 2586583, secType: SecType.STK, exchange: "ARCA", currency: "USD", name: "iShares MSCI Netherlands ETF", category: "index_etf" },
  { symbol: "EWD", conId: 2586593, secType: SecType.STK, exchange: "ARCA", currency: "USD", name: "iShares MSCI Sweden ETF", category: "index_etf" },
  { symbol: "NORW", conId: 67418865, secType: SecType.STK, exchange: "ARCA", currency: "USD", name: "Global X MSCI Norway ETF", category: "index_etf" },
];

interface HistoricalBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
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
      clientId: 10,
      host: "127.0.0.1",
      port: 4002,
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
      this.ib.connect();
      const t = setTimeout(() => reject(new Error("Connection timeout")), 12000);
      this.ib.once(EventName.connected, () => {
        clearTimeout(t);
        setTimeout(resolve, 500);
      });
      this.ib.once(EventName.error, (_err, code) => {
        if (code === ErrorCode.CONNECT_FAIL) {
          clearTimeout(t);
          reject(new Error("Failed to connect to IB Gateway"));
        }
      });
    });
  }

  async fetchHistoricalData(
    asset: AssetConfig,
    duration: string,
    whatToShow: WhatToShow = WhatToShow.TRADES
  ): Promise<HistoricalBar[]> {
    return new Promise((resolve, reject) => {
      const reqId = this.nextReqId++;

      const contract: Contract = {
        conId: asset.conId,
        symbol: asset.symbol,
        secType: asset.secType,
        exchange: asset.exchange,
        currency: asset.currency,
      };

      let resolved = false;
      const bars: HistoricalBar[] = [];

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
        console.warn(`Hard timeout for ${asset.symbol}`);
        finish();
      }, HARD_TIMEOUT_MS);

      const idleTimer = setInterval(() => {
        if (resolved) return;
        if (bars.length > 0 && Date.now() - lastBarAt > IDLE_TIMEOUT_MS) finish();
      }, 200);

      const onBar = (
        _reqId: number,
        time: string,
        open: number,
        high: number,
        low: number,
        close: number,
        volume: number
      ) => {
        if (resolved || _reqId !== reqId) return;
        const d = normalizeIBDate(time);
        if (!d) return;
        lastBarAt = Date.now();
        if (open > 0 && close > 0) {
          bars.push({ time: d, open, high, low, close, volume });
        }
      };

      const onEnd = (_reqId: number) => {
        if (resolved || _reqId !== reqId) return;
        finish();
      };

      this.ib.on(EventName.historicalData, onBar);
      this.ib.on(HISTORICAL_DATA_END, onEnd);

      try {
        this.ib.reqHistoricalData(
          reqId,
          contract,
          "",
          duration,
          BarSizeSetting.DAYS_ONE,
          whatToShow,
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

async function upsertAsset(asset: AssetConfig): Promise<void> {
  // Insert into stocks table (we'll use the same table structure for simplicity)
  const q = `
    INSERT INTO public.stocks (ticker, name, currency, exchange, is_active)
    VALUES ($1, $2, $3, $4, true)
    ON CONFLICT (ticker)
    DO UPDATE SET
      name = EXCLUDED.name,
      currency = EXCLUDED.currency,
      exchange = EXCLUDED.exchange,
      is_active = true
  `;
  await pool.query(q, [asset.symbol, asset.name, asset.currency, asset.exchange]);
}

async function insertPriceDataBulk(ticker: string, bars: HistoricalBar[], source: string = 'ibkr'): Promise<number> {
  if (!bars.length) return 0;

  const values: any[] = [];
  const rowsSql: string[] = [];

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const y = b.time.substring(0, 4);
    const m = b.time.substring(4, 6);
    const d = b.time.substring(6, 8);
    const date = `${y}-${m}-${d}`;

    const base = i * 9;
    rowsSql.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
    );

    const finalAdjClose = b.adjClose !== undefined ? b.adjClose : b.close;

    values.push(
      ticker,
      date,
      b.open,
      b.high,
      b.low,
      b.close,
      finalAdjClose,
      Math.floor(b.volume) || 0,
      source
    );
  }

  const q = `
    INSERT INTO prices_daily (ticker, date, open, high, low, close, adj_close, volume, source)
    VALUES ${rowsSql.join(",")}
    ON CONFLICT (ticker, date, source)
    DO UPDATE SET
      open = EXCLUDED.open,
      high = EXCLUDED.high,
      low = EXCLUDED.low,
      close = EXCLUDED.close,
      adj_close = EXCLUDED.adj_close,
      volume = EXCLUDED.volume
  `;

  await pool.query(q, values);
  return bars.length;
}

async function importAsset(fetcher: IBDataFetcher, asset: AssetConfig): Promise<number> {
  console.log(`\n[${asset.category.toUpperCase()}] ${asset.symbol} - ${asset.name}`);

  await upsertAsset(asset);

  // Determine what data type to fetch
  // Indexes don't have volume, so use different WhatToShow
  const whatToShow = asset.secType === SecType.IND ? WhatToShow.TRADES : WhatToShow.TRADES;

  // Fetch raw data
  const rawBars = await withRetry(
    () => fetcher.fetchHistoricalData(asset, "20 Y", whatToShow),
    `hist-raw ${asset.symbol}`
  );

  if (!rawBars.length) {
    console.log(`  No historical data available`);
    return 0;
  }

  // For stocks/ETFs, also fetch adjusted prices
  if (asset.secType === SecType.STK) {
    const adjBars = await withRetry(
      () => fetcher.fetchHistoricalData(asset, "20 Y", WhatToShow.ADJUSTED_LAST),
      `hist-adj ${asset.symbol}`
    );

    const adjMap = new Map<string, number>();
    for (const b of adjBars) {
      adjMap.set(b.time, b.close);
    }

    for (const bar of rawBars) {
      const adjPrice = adjMap.get(bar.time);
      bar.adjClose = adjPrice !== undefined ? adjPrice : bar.close;
    }
    console.log(`  Fetched ${rawBars.length} bars with adjustments`);
  } else {
    // For indexes, adj_close = close
    for (const bar of rawBars) {
      bar.adjClose = bar.close;
    }
    console.log(`  Fetched ${rawBars.length} index bars`);
  }

  const inserted = await insertPriceDataBulk(asset.symbol, rawBars);
  console.log(`  Inserted ${inserted} price records`);
  return inserted;
}

async function main() {
  console.log("=".repeat(70));
  console.log("IMPORTING INDEXES AND COMMODITIES FROM IBKR");
  console.log("=".repeat(70));
  console.log(`\nTotal assets to import: ${ASSETS.length}\n`);

  const fetcher = new IBDataFetcher();

  const results: { asset: string; success: boolean; rows?: number; error?: string }[] = [];

  try {
    await fetcher.connect();
    console.log("[OK] Connected to IB Gateway on port 4002\n");

    for (let i = 0; i < ASSETS.length; i++) {
      const asset = ASSETS[i];
      console.log(`[${i + 1}/${ASSETS.length}] Processing ${asset.symbol}...`);

      try {
        const rows = await importAsset(fetcher, asset);
        results.push({ asset: asset.symbol, success: rows > 0, rows });
      } catch (e: any) {
        results.push({ asset: asset.symbol, success: false, error: e.message });
        console.log(`  FAILED - ${e.message}`);
      }

      // Rate limiting
      await sleep(1000);
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("IMPORT SUMMARY");
    console.log("=".repeat(70));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`\nTotal: ${ASSETS.length}`);
    console.log(`Successful: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);

    if (successful.length > 0) {
      const totalRows = successful.reduce((sum, r) => sum + (r.rows || 0), 0);
      console.log(`Total rows imported: ${totalRows}`);
    }

    console.log("\n--- By Category ---");
    for (const category of ['index', 'commodity_etf', 'index_etf'] as const) {
      const categoryAssets = ASSETS.filter(a => a.category === category);
      const categoryResults = results.filter(r =>
        categoryAssets.some(a => a.symbol === r.asset) && r.success
      );
      console.log(`${category}: ${categoryResults.length}/${categoryAssets.length} successful`);
    }

    if (failed.length > 0) {
      console.log("\n--- Failed Assets ---");
      failed.forEach(r => console.log(`  - ${r.asset}: ${r.error}`));
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
