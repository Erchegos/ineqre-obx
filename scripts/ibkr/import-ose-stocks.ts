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

const OSE_TICKERS = [
  "EQNR","DNB","KOG","TEL","AKRBP","NHY","GJF","MOWI","ORK","YAR",
  "VAR","SALM","SB1NO","STB","SUBC","AKER","FRO","VENDA","VENDB","WAWI",
  "AUTO","PROT","TOM","OLT","SBNOR","HAFNI","MING","LSG","BAKKA","WWI",
  "SPOL","NOD","DOFG","TIETO","WWIB","VEI","SWON","ODL","BWLPG","AFG",
  "ENTRA","BRG","HAUTO","TGS","ELK","CADLR","AUSS","SNI","SCATC","ATEA",
  "CMBTO",
];

interface StockContract {
  conId: number;
  symbol: string;
  exchange: string;
  currency: string;
  localSymbol: string;
  name: string;
}

interface HistoricalBar {
  time: string; // YYYYMMDD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number; // Added for analytics
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
      clientId: 7,
      host: "127.0.0.1",
      port: 4001,
    });

    this.ib.on(EventName.connected, () => console.log("✓ Connected to TWS"));
    this.ib.on(EventName.disconnected, () => console.log("⚠️  Disconnected from TWS"));

    this.ib.on(EventName.error, (err, code, reqId) => {
      // FIX 1: Cast code to number to avoid Enum mismatch errors
      const codeNum = code as number;
      
      if (codeNum === ErrorCode.CONNECT_FAIL) {
        console.error("❌ Connection failed. Is TWS running and API enabled?");
        return;
      }
      // FIX 2: Relaxed error checking and removed missing Enum property
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
        const name = d.longName || d.marketName || d.contract?.description || c.symbol || symbol;

        resolve({
          conId: c.conId,
          symbol: c.symbol || symbol,
          exchange: c.exchange || "OSE",
          currency: c.currency || "NOK",
          localSymbol: c.localSymbol || c.symbol || symbol,
          name: String(name),
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
          name: "Unknown",
        });
      }, 8000);

      this.ib.on(EventName.contractDetails, onDetails);
      this.ib.on(EventName.contractDetailsEnd, onEnd);

      this.ib.reqContractDetails(reqId, contract);
    });
  }

  async fetchHistoricalFast(
    contract: StockContract, 
    duration: string, 
    whatToShow: WhatToShow = WhatToShow.TRADES
  ): Promise<HistoricalBar[]> {
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
      const bars: HistoricalBar[] = [];

      const HARD_TIMEOUT_MS = 90000;
      const IDLE_TIMEOUT_MS = 2000;
      let lastBarAt = Date.now();

      // FIX 3: Manually cast the event name to 'any' to bypass missing type definition
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
        console.warn(`Hard timeout fetching data for ${contract.symbol} (${whatToShow})`);
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
        // FIX 4: Removed the extra argument [] at the end
        this.ib.reqHistoricalData(
          reqId,
          ibContract,
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

async function upsertStock(contract: StockContract): Promise<void> {
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
  await pool.query(q, [contract.symbol, contract.name, contract.currency, contract.exchange]);
}

async function insertPriceDataBulk(ticker: string, bars: HistoricalBar[]): Promise<number> {
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
      "ibkr"
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

async function importTicker(fetcher: IBDataFetcher, symbol: string): Promise<number> {
  console.log(`\n📊 Processing ${symbol}...`);

  const contract = await withRetry(() => fetcher.searchContract(symbol), `contract ${symbol}`);

  if (!contract) {
    console.log(`❌ ${symbol} - Not found`);
    return 0;
  }

  console.log(`✓ Found ${contract.symbol} (conId: ${contract.conId})`);
  await upsertStock(contract);

  // Fetch RAW
  const rawBars = await withRetry(
    () => fetcher.fetchHistoricalFast(contract, "20 Y", WhatToShow.TRADES), 
    `hist-raw ${symbol}`
  );

  if (!rawBars.length) {
    console.log("⚠️  No historical data available");
    return 0;
  }

  // Fetch ADJUSTED
  const adjBars = await withRetry(
    () => fetcher.fetchHistoricalFast(contract, "20 Y", WhatToShow.ADJUSTED_LAST), 
    `hist-adj ${symbol}`
  );

  // Merge
  const adjMap = new Map<string, number>();
  for (const b of adjBars) {
    adjMap.set(b.time, b.close);
  }

  for (const bar of rawBars) {
    const adjPrice = adjMap.get(bar.time);
    bar.adjClose = adjPrice !== undefined ? adjPrice : bar.close;
  }

  console.log(`✓ Merged ${rawBars.length} raw bars with ${adjBars.length} adjusted records`);

  const inserted = await insertPriceDataBulk(contract.symbol, rawBars);
  console.log(`✓ Inserted ${inserted} price records (20Y) with adjustments`);
  return inserted;
}

async function main() {
  console.log("🚀 Starting Oslo Børs data import from TWS (With Div Adjustments)\n");

  const fetcher = new IBDataFetcher();

  try {
    await fetcher.connect();
    console.log("✓ Connected to TWS on port 4001\n");

    const onlyTicker = process.argv[2];
    const tickers = onlyTicker ? [onlyTicker] : OSE_TICKERS;

    console.log(`📋 Importing ${tickers.length} tickers\n`);

    let ok = 0;
    let bad = 0;

    for (const t of tickers) {
      try {
        const inserted = await importTicker(fetcher, t);
        if (inserted > 0) ok++;
        else bad++;
        await sleep(500); 
      } catch (e) {
        console.error(`❌ Failed to import ${t}:`, e);
        bad++;
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ Import complete!");
    console.log(`   OK: ${ok}`);
    console.log(`   Failed or no data: ${bad}`);
    console.log("=".repeat(50) + "\n");
  } finally {
    fetcher.disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});