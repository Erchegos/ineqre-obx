/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * fetch-options-nasdaq.ts
 *
 * Fetches options chain data from Nasdaq API (free, no auth required).
 * Nasdaq provides real bid/ask, OI, and volume data even outside market hours.
 * This supplements/overwrites Yahoo Finance data which often has 0 OI.
 *
 * Usage: npx tsx scripts/fetch-options-nasdaq.ts
 */

import { config } from "dotenv";
import { resolve } from "path";
import { Client } from "pg";

config({ path: resolve(__dirname, "../.env.local") });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL required");

const OPTIONS_TICKERS = ["EQNR", "BORR", "FLNG", "FRO"];

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Black-Scholes Greeks ────────────────────────────────────────
function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
    a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
}

function bsPrice(type: "call" | "put", S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return Math.max(0, type === "call" ? S - K : K - S);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (type === "call") return S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
  return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}

function impliedVolFromPrice(type: "call" | "put", price: number, S: number, K: number, T: number, r: number): number {
  if (price <= 0 || T <= 0) return 0;
  let sigma = 0.30;
  for (let i = 0; i < 50; i++) {
    const p = bsPrice(type, S, K, T, r, sigma);
    const diff = p - price;
    if (Math.abs(diff) < 0.001) return sigma;
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    const vega = S * Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI) * Math.sqrt(T);
    if (vega < 0.001) break;
    sigma = Math.max(0.01, Math.min(sigma - diff / vega, 5.0));
  }
  return sigma;
}

function blackScholesGreeks(type: "call" | "put", S: number, K: number, T: number, r: number, sigma: number) {
  if (T <= 0 || sigma <= 0) return { delta: 0, gamma: 0, theta: 0, vega: 0 };
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const nd1 = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const delta = type === "call" ? Nd1 : Nd1 - 1;
  const gamma = nd1 / (S * sigma * Math.sqrt(T));
  let theta = (-S * nd1 * sigma / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * (type === "call" ? Nd2 : normalCDF(-d2))) / 365;
  if (!isFinite(theta) || Math.abs(theta) > 10) theta = 0;
  const vega = (S * nd1 * Math.sqrt(T)) / 100;
  return { delta, gamma, theta, vega };
}

// ─── Nasdaq API ──────────────────────────────────────────────────

function parseNum(s: any): number {
  if (s === null || s === undefined || s === '--' || s === '') return 0;
  return parseInt(String(s).replace(/,/g, ''), 10) || 0;
}

function parseFloat2(s: any): number {
  if (s === null || s === undefined || s === '--' || s === '') return 0;
  return parseFloat(String(s).replace(/,/g, '')) || 0;
}

// Map Nasdaq date strings to YYYYMMDD expiry format
function parseExpiry(expiryGroup: string): string {
  // "March 20, 2026" → "20260320"
  const months: Record<string, string> = {
    January: '01', February: '02', March: '03', April: '04',
    May: '05', June: '06', July: '07', August: '08',
    September: '09', October: '10', November: '11', December: '12',
  };
  const match = expiryGroup.match(/(\w+)\s+(\d+),\s+(\d{4})/);
  if (!match) return '';
  const [, month, day, year] = match;
  return `${year}${months[month] || '00'}${day.padStart(2, '0')}`;
}

async function fetchNasdaqOptions(ticker: string, db: Client): Promise<number> {
  const url = `https://api.nasdaq.com/api/quote/${ticker}/option-chain?assetclass=stocks&limit=500&fromdate=2026-02-27&todate=2028-12-31&excode=oprac&callput=callput&money=all&type=all`;

  console.log(`  Fetching from Nasdaq API...`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Nasdaq API ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  const rows = json?.data?.table?.rows || [];
  const lastTrade = json?.data?.lastTrade || '';

  // Extract underlying price from "LAST TRADE: $28.95 (AS OF FEB 27, 2026)"
  const priceMatch = lastTrade.match(/\$(\d+\.?\d*)/);
  const underlyingPrice = priceMatch ? parseFloat(priceMatch[1]) : 0;

  console.log(`  Underlying: $${underlyingPrice.toFixed(2)}`);
  console.log(`  Raw rows: ${rows.length}`);

  const r = 0.04;
  let currentExpiry = '';
  let totalUpdated = 0;
  let totalOI = 0;
  const allStrikes = new Set<number>();
  const allExpirations: string[] = [];

  for (const row of rows) {
    // Header row for new expiry group
    if (row.expirygroup && row.strike === null) {
      currentExpiry = parseExpiry(row.expirygroup);
      if (currentExpiry) allExpirations.push(currentExpiry);
      continue;
    }

    if (!currentExpiry || !row.strike) continue;

    const strike = parseFloat2(row.strike);
    if (strike <= 0) continue;
    allStrikes.add(strike);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expDate = new Date(
      parseInt(currentExpiry.slice(0, 4)),
      parseInt(currentExpiry.slice(4, 6)) - 1,
      parseInt(currentExpiry.slice(6, 8))
    );
    const T = Math.max(1, Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))) / 365;

    // Process calls
    const cBid = parseFloat2(row.c_Bid);
    const cAsk = parseFloat2(row.c_Ask);
    const cLast = parseFloat2(row.c_Last);
    const cVol = parseNum(row.c_Volume);
    const cOI = parseNum(row.c_Openinterest);

    if (cBid > 0 || cAsk > 0 || cLast > 0 || cOI > 0) {
      const mid = cLast > 0 ? cLast : (cBid + cAsk) / 2;
      let iv = mid > 0 && underlyingPrice > 0 ? impliedVolFromPrice("call", mid, underlyingPrice, strike, T, r) : 0.30;
      if (iv < 0.05) iv = 0.30;
      const greeks = blackScholesGreeks("call", underlyingPrice, strike, T, r, iv);

      await db.query(
        `INSERT INTO public.options_chain
          (ticker, expiry, strike, option_right, bid, ask, last_price, iv, delta, gamma, theta, vega, open_interest, volume, underlying_price, fetched_at)
        VALUES ($1, $2, $3, 'call', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
        ON CONFLICT (ticker, expiry, strike, option_right) DO UPDATE SET
          bid = CASE WHEN EXCLUDED.bid > 0 THEN EXCLUDED.bid ELSE options_chain.bid END,
          ask = CASE WHEN EXCLUDED.ask > 0 THEN EXCLUDED.ask ELSE options_chain.ask END,
          last_price = CASE WHEN EXCLUDED.last_price > 0 THEN EXCLUDED.last_price ELSE options_chain.last_price END,
          iv = CASE WHEN EXCLUDED.iv > 0.01 THEN EXCLUDED.iv ELSE options_chain.iv END,
          delta = CASE WHEN EXCLUDED.iv > 0.01 THEN EXCLUDED.delta ELSE options_chain.delta END,
          gamma = CASE WHEN EXCLUDED.iv > 0.01 THEN EXCLUDED.gamma ELSE options_chain.gamma END,
          theta = CASE WHEN EXCLUDED.iv > 0.01 THEN EXCLUDED.theta ELSE options_chain.theta END,
          vega = CASE WHEN EXCLUDED.iv > 0.01 THEN EXCLUDED.vega ELSE options_chain.vega END,
          open_interest = CASE WHEN EXCLUDED.open_interest > 0 THEN EXCLUDED.open_interest ELSE options_chain.open_interest END,
          volume = CASE WHEN EXCLUDED.volume > 0 THEN EXCLUDED.volume ELSE options_chain.volume END,
          underlying_price = EXCLUDED.underlying_price,
          fetched_at = EXCLUDED.fetched_at`,
        [ticker, currentExpiry, strike, cBid, cAsk, cLast,
          iv, greeks.delta, greeks.gamma, greeks.theta, greeks.vega,
          cOI, cVol, underlyingPrice]
      );
      totalUpdated++;
      totalOI += cOI;
    }

    // Process puts
    const pBid = parseFloat2(row.p_Bid);
    const pAsk = parseFloat2(row.p_Ask);
    const pLast = parseFloat2(row.p_Last);
    const pVol = parseNum(row.p_Volume);
    const pOI = parseNum(row.p_Openinterest);

    if (pBid > 0 || pAsk > 0 || pLast > 0 || pOI > 0) {
      const mid = pLast > 0 ? pLast : (pBid + pAsk) / 2;
      let iv = mid > 0 && underlyingPrice > 0 ? impliedVolFromPrice("put", mid, underlyingPrice, strike, T, r) : 0.30;
      if (iv < 0.05) iv = 0.30;
      const greeks = blackScholesGreeks("put", underlyingPrice, strike, T, r, iv);

      await db.query(
        `INSERT INTO public.options_chain
          (ticker, expiry, strike, option_right, bid, ask, last_price, iv, delta, gamma, theta, vega, open_interest, volume, underlying_price, fetched_at)
        VALUES ($1, $2, $3, 'put', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
        ON CONFLICT (ticker, expiry, strike, option_right) DO UPDATE SET
          bid = CASE WHEN EXCLUDED.bid > 0 THEN EXCLUDED.bid ELSE options_chain.bid END,
          ask = CASE WHEN EXCLUDED.ask > 0 THEN EXCLUDED.ask ELSE options_chain.ask END,
          last_price = CASE WHEN EXCLUDED.last_price > 0 THEN EXCLUDED.last_price ELSE options_chain.last_price END,
          iv = CASE WHEN EXCLUDED.iv > 0.01 THEN EXCLUDED.iv ELSE options_chain.iv END,
          delta = CASE WHEN EXCLUDED.iv > 0.01 THEN EXCLUDED.delta ELSE options_chain.delta END,
          gamma = CASE WHEN EXCLUDED.iv > 0.01 THEN EXCLUDED.gamma ELSE options_chain.gamma END,
          theta = CASE WHEN EXCLUDED.iv > 0.01 THEN EXCLUDED.theta ELSE options_chain.theta END,
          vega = CASE WHEN EXCLUDED.iv > 0.01 THEN EXCLUDED.vega ELSE options_chain.vega END,
          open_interest = CASE WHEN EXCLUDED.open_interest > 0 THEN EXCLUDED.open_interest ELSE options_chain.open_interest END,
          volume = CASE WHEN EXCLUDED.volume > 0 THEN EXCLUDED.volume ELSE options_chain.volume END,
          underlying_price = EXCLUDED.underlying_price,
          fetched_at = EXCLUDED.fetched_at`,
        [ticker, currentExpiry, strike, pBid, pAsk, pLast,
          iv, greeks.delta, greeks.gamma, greeks.theta, greeks.vega,
          pOI, pVol, underlyingPrice]
      );
      totalUpdated++;
      totalOI += pOI;
    }
  }

  // Update metadata
  const sortedStrikes = Array.from(allStrikes).sort((a, b) => a - b);
  if (allExpirations.length > 0) {
    await db.query(
      `INSERT INTO public.options_meta
        (ticker, expirations, strikes, multiplier, underlying_price, currency, fetched_at)
      VALUES ($1, $2, $3, $4, $5, 'USD', now())
      ON CONFLICT (ticker) DO UPDATE SET
        expirations = EXCLUDED.expirations, strikes = EXCLUDED.strikes,
        underlying_price = EXCLUDED.underlying_price, fetched_at = EXCLUDED.fetched_at`,
      [ticker, JSON.stringify(allExpirations), JSON.stringify(sortedStrikes), 100, underlyingPrice]
    );
  }

  console.log(`  Updated: ${totalUpdated} rows, Total OI: ${totalOI.toLocaleString()}`);
  return totalUpdated;
}

async function main() {
  console.log("=== Options Fetch (Nasdaq API) ===");
  console.log(`Tickers: ${OPTIONS_TICKERS.join(", ")}\n`);

  const db = new Client({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  await db.connect();

  let total = 0;
  for (const ticker of OPTIONS_TICKERS) {
    console.log(`[${ticker}]`);
    try {
      const count = await fetchNasdaqOptions(ticker, db);
      total += count;
      console.log(`[${ticker}] Done\n`);
    } catch (err: any) {
      console.error(`[${ticker}] FAILED: ${err.message}\n`);
    }
    await sleep(1000); // Rate limit
  }

  await db.end();
  console.log(`=== Complete: ${total} total rows updated ===`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
