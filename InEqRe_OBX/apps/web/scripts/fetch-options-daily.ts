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
  // Clamp IV to a minimum of 5% to prevent gamma blow-up when Yahoo returns
  // unrealistically low IV for illiquid options (sigma is in the denominator).
  sigma = Math.max(sigma, 0.05);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const nd1 = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const delta = type === "call" ? Nd1 : Nd1 - 1;
  const gamma = nd1 / (S * sigma * Math.sqrt(T));
  let theta = (-S * nd1 * sigma / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * (type === "call" ? Nd2 : normalCDF(-d2))) / 365;
  // Sanity: theta should be small negative; clamp nonsensical values
  if (!isFinite(theta) || Math.abs(theta) > 10) theta = 0;
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

// ─── IBKR Options Bid/Ask ────────────────────────────────────────

/** Convert "20260320" → "MAR26" */
function formatIBKRMonth(expiry: string): string {
  const year = expiry.substring(2, 4);
  const month = parseInt(expiry.substring(4, 6)) - 1;
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return months[month] + year;
}

/** Look up the IBKR conid for a specific option contract. */
async function ibkrGetOptionConid(
  underlyingConid: number,
  monthStr: string,
  right: "C" | "P",
  strike: number,
  exchange: string = "SMART",
): Promise<number | null> {
  try {
    const info = await ibkrFetch(
      `/v1/api/iserver/secdef/info?conid=${underlyingConid}&secType=OPT&month=${monthStr}&right=${right}&strike=${strike}&exchange=${exchange}`
    );
    if (Array.isArray(info) && info.length > 0 && info[0].conid) {
      return info[0].conid;
    }
  } catch { /* ignore */ }
  return null;
}

/** Batch bid/ask snapshot for a list of option conids.
 *  Calls twice with a pause — first call primes the subscription. */
async function ibkrGetBidAsk(conids: number[]): Promise<Map<number, { bid: number; ask: number }>> {
  const result = new Map<number, { bid: number; ask: number }>();
  if (conids.length === 0) return result;
  const conidStr = conids.join(",");
  // First call — primes streaming subscription
  await ibkrFetch(`/v1/api/iserver/marketdata/snapshot?conids=${conidStr}&fields=84,86`).catch(() => {});
  await sleep(1500);
  // Second call — returns actual data
  const snapshots = await ibkrFetch(`/v1/api/iserver/marketdata/snapshot?conids=${conidStr}&fields=84,86`);
  if (Array.isArray(snapshots)) {
    for (const snap of snapshots) {
      const bid = parseFloat(snap["84"]) || 0;
      const ask = parseFloat(snap["86"]) || 0;
      if (bid > 0 || ask > 0) result.set(snap.conid, { bid, ask });
    }
  }
  return result;
}

/** Update near-ATM strikes with real-time IBKR bid/ask after Yahoo data is stored. */
async function ibkrUpdateOptionBidAsk(
  dbTicker: string,
  underlyingConid: number,
  exchange: string,
  expiry: string,
  underlyingPrice: number,
  db: Client,
): Promise<void> {
  const monthStr = formatIBKRMonth(expiry);

  // Fetch near-ATM strikes from DB (within ±20%, max 20 strikes)
  const res = await db.query(
    `SELECT DISTINCT strike FROM public.options_chain
     WHERE ticker = $1 AND expiry = $2 AND ABS(strike - $3) / NULLIF($3, 0) <= 0.20
     ORDER BY ABS(strike - $3) LIMIT 20`,
    [dbTicker, expiry, underlyingPrice]
  );
  const strikes: number[] = res.rows.map((r: any) => parseFloat(r.strike));
  if (strikes.length === 0) return;

  console.log(`    [IBKR] Looking up conids for ${strikes.length} strikes (${monthStr})`);

  // Collect conids for calls + puts
  const conidMap = new Map<number, { strike: number; right: "call" | "put" }>();
  for (const strike of strikes) {
    for (const right of ["C", "P"] as const) {
      const conid = await ibkrGetOptionConid(underlyingConid, monthStr, right, strike, exchange);
      if (conid) conidMap.set(conid, { strike, right: right === "C" ? "call" : "put" });
      await sleep(80);
    }
  }

  if (conidMap.size === 0) {
    console.log(`    [IBKR] No option conids found for ${monthStr}`);
    return;
  }

  // Batch bid/ask request
  const bidAsk = await ibkrGetBidAsk(Array.from(conidMap.keys()));

  // Update DB rows that have real data
  let updated = 0;
  for (const [conid, { strike, right }] of conidMap.entries()) {
    const prices = bidAsk.get(conid);
    if (prices) {
      await db.query(
        `UPDATE public.options_chain SET bid = $1, ask = $2
         WHERE ticker = $3 AND expiry = $4 AND strike = $5 AND option_right = $6`,
        [prices.bid, prices.ask, dbTicker, expiry, strike, right]
      );
      updated++;
    }
  }
  console.log(`    [IBKR] Updated ${updated}/${conidMap.size} bid/ask prices for ${monthStr}`);
}

// ─── Yahoo Finance Fetcher ───────────────────────────────────────
async function fetchYahooOptions(
  dbTicker: string,
  yahooSymbol: string,
  ibkrPrice: number | null,
  db: Client,
  ibkr?: { conid: number; exchange: string; available: boolean },
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

      // When Yahoo returns IV=0 (market closed / holiday), preserve existing
      // good pricing data.  OI, volume, and underlying always update.
      await db.query(
        `INSERT INTO public.options_chain
          (ticker, expiry, strike, option_right, bid, ask, last_price, iv, delta, gamma, theta, vega, open_interest, volume, underlying_price, fetched_at)
        VALUES ($1, $2, $3, 'call', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
        ON CONFLICT (ticker, expiry, strike, option_right) DO UPDATE SET
          bid       = CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.bid       ELSE options_chain.bid END,
          ask       = CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.ask       ELSE options_chain.ask END,
          last_price= CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.last_price ELSE options_chain.last_price END,
          iv        = CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.iv        ELSE options_chain.iv END,
          delta     = CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.delta     ELSE options_chain.delta END,
          gamma     = CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.gamma     ELSE options_chain.gamma END,
          theta     = CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.theta     ELSE options_chain.theta END,
          vega      = CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.vega      ELSE options_chain.vega END,
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
          bid       = CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.bid       ELSE options_chain.bid END,
          ask       = CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.ask       ELSE options_chain.ask END,
          last_price= CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.last_price ELSE options_chain.last_price END,
          iv        = CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.iv        ELSE options_chain.iv END,
          delta     = CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.delta     ELSE options_chain.delta END,
          gamma     = CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.gamma     ELSE options_chain.gamma END,
          theta     = CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.theta     ELSE options_chain.theta END,
          vega      = CASE WHEN EXCLUDED.iv > 0 THEN EXCLUDED.vega      ELSE options_chain.vega END,
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

  // Override Yahoo bid/ask with real-time IBKR prices for near-ATM strikes
  if (ibkr?.available && underlyingPrice > 0) {
    console.log(`  [IBKR] Fetching real-time bid/ask for near-ATM options...`);
    // Update first 3 expirations only (most liquid, most important)
    for (const expiry of allExpirations.slice(0, 3)) {
      try {
        await ibkrUpdateOptionBidAsk(dbTicker, ibkr.conid, ibkr.exchange, expiry, underlyingPrice, db);
      } catch (err: any) {
        console.log(`    [IBKR] bid/ask update failed for ${expiry}: ${err.message}`);
      }
    }
  }

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
      const ibkrParams = config.ibkr
        ? { conid: config.ibkr.conid, exchange: config.ibkr.exchange, available: ibkrAvailable }
        : undefined;
      const rows = await fetchYahooOptions(dbTicker, config.yahoo, ibkrPrice, db, ibkrParams);
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
