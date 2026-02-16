/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * fetch-options-daily.ts
 *
 * Pre-loads options chain data into PostgreSQL.
 * Data sources (in priority order):
 *   1. IBKR Client Portal API (real-time prices, greeks)
 *   2. Yahoo Finance (OI, volume, IV, bid/ask — 15-min delayed)
 *
 * IBKR is used for underlying price when available.
 * Yahoo is used for options chain data (OI, volume, IV).
 * Greeks are calculated via Black-Scholes from Yahoo IV.
 *
 * Usage: npx tsx scripts/fetch-options-daily.ts
 */

import { config } from "dotenv";
import { resolve } from "path";
import { Client } from "pg";
import https from "https";

config({ path: resolve(__dirname, "../.env.local") });

const DATABASE_URL = process.env.DATABASE_URL;
const IBKR_BASE_URL = process.env.IBKR_BASE_URL || "https://localhost:5000";

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

// Map: DB ticker → { yahoo: Yahoo symbol, ibkr: { conid, exchange } }
const OPTIONS_TICKERS: Record<string, { yahoo: string; ibkr?: { conid: number; exchange: string } }> = {
  EQNR: {
    yahoo: "EQNR",          // Equinor ASA ADR (NYSE)
    ibkr: { conid: 38831, exchange: "NYSE" },
  },
  BORR: {
    yahoo: "BORR",           // Borr Drilling (NYSE)
  },
  FLNG: {
    yahoo: "FLNG",           // Flex LNG (NYSE)
  },
  FRO: {
    yahoo: "FRO",            // Frontline (NYSE)
  },
};

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Black-Scholes Greeks ────────────────────────────────────────
function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
    a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
}

function blackScholesGreeks(
  type: "call" | "put", S: number, K: number, T: number, r: number, sigma: number
): { delta: number; gamma: number; theta: number; vega: number } {
  if (T <= 0 || sigma <= 0) return { delta: 0, gamma: 0, theta: 0, vega: 0 };
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const nd1 = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const delta = type === "call" ? Nd1 : Nd1 - 1;
  const gamma = nd1 / (S * sigma * Math.sqrt(T));
  const theta = (-S * nd1 * sigma / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * (type === "call" ? Nd2 : normalCDF(-d2))) / 365;
  const vega = (S * nd1 * Math.sqrt(T)) / 100;
  return { delta, gamma, theta, vega };
}

// ─── IBKR Client Portal API ─────────────────────────────────────
async function ibkrFetch(path: string, method = "GET", body?: any): Promise<any> {
  const url = `${IBKR_BASE_URL}${path}`;
  const opts: any = {
    method,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
    agent: httpsAgent,
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`IBKR ${res.status}: ${res.statusText}`);
  return res.json();
}

async function ibkrHealthCheck(): Promise<boolean> {
  try {
    await ibkrFetch("/v1/api/tickle", "POST");
    return true;
  } catch {
    return false;
  }
}

async function ibkrGetPrice(conid: number): Promise<number | null> {
  try {
    // Request snapshot
    const fields = "31,84,86"; // last, bid, ask
    const data = await ibkrFetch(`/v1/api/iserver/marketdata/snapshot?conids=${conid}&fields=${fields}`);
    if (Array.isArray(data) && data.length > 0) {
      const snap = data[0];
      const last = parseFloat(snap["31"]) || parseFloat(snap["84"]) || parseFloat(snap["86"]);
      if (last > 0) return last;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Yahoo Finance Fetcher ───────────────────────────────────────
async function fetchYahooOptions(
  dbTicker: string,
  yahooSymbol: string,
  ibkrPrice: number | null,
  db: Client
): Promise<number> {
  const YahooFinance = (await import("yahoo-finance2")).default;
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

  console.log(`  [YAHOO] Fetching options chain: ${yahooSymbol}`);

  const baseData = await yf.options(yahooSymbol);
  const expirationDates: Date[] = baseData.expirationDates || [];
  const yahooPrice = baseData.quote?.regularMarketPrice || 0;
  const currency = baseData.quote?.currency || "USD";

  // Use IBKR price if available (real-time), otherwise Yahoo (15-min delayed)
  const underlyingPrice = ibkrPrice || yahooPrice;
  const priceSource = ibkrPrice ? "IBKR" : "Yahoo";

  if (expirationDates.length === 0) {
    throw new Error(`No options expirations found for ${yahooSymbol}`);
  }

  console.log(`  Underlying: ${underlyingPrice.toFixed(2)} ${currency} (${priceSource})`);
  console.log(`  Expirations: ${expirationDates.length}`);

  const allStrikes = new Set<number>();
  const allExpirations: string[] = [];
  let totalRows = 0;
  const r = 0.04;

  for (const expDate of expirationDates) {
    const expStr = expDate.toISOString().slice(0, 10).replace(/-/g, "");
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    if (expStr < today) continue;

    allExpirations.push(expStr);
    const data = await yf.options(yahooSymbol, { date: expDate });
    const calls = data.options?.[0]?.calls || [];
    const puts = data.options?.[0]?.puts || [];

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const T = Math.max(1, Math.ceil((expDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24))) / 365;

    let expiryRows = 0;

    for (const opt of calls) {
      const strike = opt.strike;
      allStrikes.add(strike);
      const iv = opt.impliedVolatility || 0;
      const greeks = iv > 0 && underlyingPrice > 0
        ? blackScholesGreeks("call", underlyingPrice, strike, T, r, iv)
        : { delta: 0, gamma: 0, theta: 0, vega: 0 };

      await db.query(
        `INSERT INTO public.options_chain
          (ticker, expiry, strike, option_right, bid, ask, last_price, iv, delta, gamma, theta, vega, open_interest, volume, underlying_price, fetched_at)
        VALUES ($1, $2, $3, 'call', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
        ON CONFLICT (ticker, expiry, strike, option_right) DO UPDATE SET
          bid = EXCLUDED.bid, ask = EXCLUDED.ask, last_price = EXCLUDED.last_price,
          iv = EXCLUDED.iv, delta = EXCLUDED.delta, gamma = EXCLUDED.gamma,
          theta = EXCLUDED.theta, vega = EXCLUDED.vega,
          open_interest = EXCLUDED.open_interest, volume = EXCLUDED.volume,
          underlying_price = EXCLUDED.underlying_price, fetched_at = EXCLUDED.fetched_at`,
        [dbTicker, expStr, strike, opt.bid || 0, opt.ask || 0, opt.lastPrice || 0,
          iv, greeks.delta, greeks.gamma, greeks.theta, greeks.vega,
          opt.openInterest || 0, opt.volume || 0, underlyingPrice]
      );
      expiryRows++;
    }

    for (const opt of puts) {
      const strike = opt.strike;
      allStrikes.add(strike);
      const iv = opt.impliedVolatility || 0;
      const greeks = iv > 0 && underlyingPrice > 0
        ? blackScholesGreeks("put", underlyingPrice, strike, T, r, iv)
        : { delta: 0, gamma: 0, theta: 0, vega: 0 };

      await db.query(
        `INSERT INTO public.options_chain
          (ticker, expiry, strike, option_right, bid, ask, last_price, iv, delta, gamma, theta, vega, open_interest, volume, underlying_price, fetched_at)
        VALUES ($1, $2, $3, 'put', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
        ON CONFLICT (ticker, expiry, strike, option_right) DO UPDATE SET
          bid = EXCLUDED.bid, ask = EXCLUDED.ask, last_price = EXCLUDED.last_price,
          iv = EXCLUDED.iv, delta = EXCLUDED.delta, gamma = EXCLUDED.gamma,
          theta = EXCLUDED.theta, vega = EXCLUDED.vega,
          open_interest = EXCLUDED.open_interest, volume = EXCLUDED.volume,
          underlying_price = EXCLUDED.underlying_price, fetched_at = EXCLUDED.fetched_at`,
        [dbTicker, expStr, strike, opt.bid || 0, opt.ask || 0, opt.lastPrice || 0,
          iv, greeks.delta, greeks.gamma, greeks.theta, greeks.vega,
          opt.openInterest || 0, opt.volume || 0, underlyingPrice]
      );
      expiryRows++;
    }

    const callOI = calls.reduce((s: number, c: any) => s + (c.openInterest || 0), 0);
    const putOI = puts.reduce((s: number, p: any) => s + (p.openInterest || 0), 0);
    console.log(`    ${expStr}: ${expiryRows} rows (Call OI: ${callOI.toLocaleString()}, Put OI: ${putOI.toLocaleString()})`);
    totalRows += expiryRows;

    await sleep(300);
  }

  // Save metadata
  const sortedStrikes = Array.from(allStrikes).sort((a, b) => a - b);
  await db.query(
    `INSERT INTO public.options_meta
      (ticker, expirations, strikes, multiplier, underlying_price, currency, fetched_at)
    VALUES ($1, $2, $3, $4, $5, $6, now())
    ON CONFLICT (ticker) DO UPDATE SET
      expirations = EXCLUDED.expirations, strikes = EXCLUDED.strikes,
      multiplier = EXCLUDED.multiplier, underlying_price = EXCLUDED.underlying_price,
      currency = EXCLUDED.currency, fetched_at = EXCLUDED.fetched_at`,
    [dbTicker, JSON.stringify(allExpirations), JSON.stringify(sortedStrikes),
      100, underlyingPrice, currency]
  );

  return totalRows;
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log("=== Options Daily Fetch ===");
  console.log(`Tickers: ${Object.keys(OPTIONS_TICKERS).join(", ")}`);

  // Check IBKR availability
  const ibkrAvailable = await ibkrHealthCheck();
  console.log(`IBKR: ${ibkrAvailable ? "CONNECTED" : "OFFLINE (using Yahoo prices)"}\n`);

  const db = new Client({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  await db.connect();

  let totalRows = 0;
  for (const [dbTicker, config] of Object.entries(OPTIONS_TICKERS)) {
    console.log(`\n[${dbTicker}] Fetching options data...`);

    // Try IBKR for real-time underlying price
    let ibkrPrice: number | null = null;
    if (ibkrAvailable && config.ibkr) {
      ibkrPrice = await ibkrGetPrice(config.ibkr.conid);
      if (ibkrPrice) {
        console.log(`  [IBKR] Real-time price: ${ibkrPrice.toFixed(2)}`);
      } else {
        console.log(`  [IBKR] Price unavailable, falling back to Yahoo`);
      }
    }

    try {
      const rows = await fetchYahooOptions(dbTicker, config.yahoo, ibkrPrice, db);
      totalRows += rows;
      console.log(`[${dbTicker}] Done: ${rows} rows saved`);
    } catch (err: any) {
      console.error(`[${dbTicker}] FAILED: ${err.message}`);
    }
  }

  await db.end();
  console.log(`\n=== Complete: ${totalRows} total rows saved ===`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
