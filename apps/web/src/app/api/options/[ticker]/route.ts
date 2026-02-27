/**
 * Options Chain API
 * GET /api/options/[ticker]?expiry=YYYYMMDD
 *
 * Reads pre-loaded options chain data from PostgreSQL.
 * Data is refreshed daily by scripts/fetch-options-daily.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();
  const searchParams = request.nextUrl.searchParams;
  const requestedExpiry = searchParams.get("expiry");

  try {
    // Step 1: Get metadata
    const metaResult = await pool.query(
      `SELECT expirations, strikes, multiplier, underlying_price, currency, fetched_at
       FROM public.options_meta WHERE ticker = $1`,
      [symbol]
    );

    if (metaResult.rows.length === 0) {
      return NextResponse.json(
        { error: `No options data for ${symbol}. Run fetch-options-daily.ts first.` },
        { status: 404 }
      );
    }

    const meta = metaResult.rows[0];
    const expirations: string[] = meta.expirations;
    const allStrikes: number[] = meta.strikes;

    // Filter to future expirations only
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const futureExpirations = expirations.filter(e => e >= today);

    // Select expiry
    const expiry = requestedExpiry || futureExpirations[0];
    if (!futureExpirations.includes(expiry)) {
      return NextResponse.json({
        error: `Expiry ${expiry} not available`,
        availableExpirations: futureExpirations,
      }, { status: 400 });
    }

    // Step 2: Get chain data for selected expiry
    const chainResult = await pool.query(
      `SELECT strike, option_right, bid, ask, last_price, iv, delta, gamma, theta, vega,
              open_interest, volume, underlying_price
       FROM public.options_chain
       WHERE ticker = $1 AND expiry = $2
       ORDER BY strike, option_right`,
      [symbol, expiry]
    );

    // Build chain rows (grouped by strike)
    const strikeMap = new Map<number, { call: Record<string, unknown> | null; put: Record<string, unknown> | null }>();

    let underlyingPrice = 0;
    for (const row of chainResult.rows) {
      const strike = parseFloat(row.strike);
      if (!strikeMap.has(strike)) {
        strikeMap.set(strike, { call: null, put: null });
      }

      const optData = {
        strike,
        right: row.option_right,
        bid: parseFloat(row.bid) || 0,
        ask: parseFloat(row.ask) || 0,
        last: parseFloat(row.last_price) || 0,
        iv: parseFloat(row.iv) || 0,
        delta: parseFloat(row.delta) || 0,
        gamma: parseFloat(row.gamma) || 0,
        theta: Math.abs(parseFloat(row.theta)) < 10 ? parseFloat(row.theta) || 0 : 0,
        vega: parseFloat(row.vega) || 0,
        openInterest: row.open_interest || 0,
        volume: row.volume || 0,
        undPrice: parseFloat(row.underlying_price) || 0,
      };

      if (optData.undPrice > 0) underlyingPrice = optData.undPrice;

      const entry = strikeMap.get(strike)!;
      if (row.option_right === "call") {
        entry.call = optData;
      } else {
        entry.put = optData;
      }
    }

    // Use underlying price from metadata (consistent across all expirations)
    underlyingPrice = parseFloat(meta.underlying_price) || underlyingPrice;

    // Sort by strike
    const chainRows = Array.from(strikeMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([strike, { call, put }]) => ({ strike, call, put }));

    // Synthesize bid/ask for options with 0 bid/ask
    // Uses Black-Scholes theoretical price with a spread that widens for OTM options
    fillSyntheticBidAsk(chainRows, underlyingPrice, expiry);

    // Recalculate IV from mid(bid,ask) for more consistent skew curves
    // Stored IV is often from stale lastPrice; mid of current bid/ask is more reliable
    recalcIVFromMid(chainRows, underlyingPrice, expiry);

    // Build OI distribution
    const oiDistribution = chainRows.map(row => ({
      strike: row.strike,
      callOI: (row.call as Record<string, unknown>)?.openInterest as number || 0,
      putOI: (row.put as Record<string, unknown>)?.openInterest as number || 0,
      callVolume: (row.call as Record<string, unknown>)?.volume as number || 0,
      putVolume: (row.put as Record<string, unknown>)?.volume as number || 0,
    }));

    // Calculate totals
    let totalPutOI = 0, totalCallOI = 0, totalPutVolume = 0, totalCallVolume = 0;
    for (const row of oiDistribution) {
      totalPutOI += row.putOI;
      totalCallOI += row.callOI;
      totalPutVolume += row.putVolume;
      totalCallVolume += row.callVolume;
    }

    // Max Pain calculation
    const maxPain = calculateMaxPain(chainRows, allStrikes);

    // IV term structure - get ATM IV for each future expiry from DB
    const ivResult = await pool.query(
      `SELECT expiry, iv, underlying_price, strike
       FROM public.options_chain
       WHERE ticker = $1 AND option_right = 'call' AND iv > 0
       ORDER BY expiry, strike`,
      [symbol]
    );

    // Group by expiry and find ATM
    const ivByExpiry = new Map<string, { iv: number; undPrice: number }>();
    const expiryRows = new Map<string, Array<{ strike: number; iv: number; undPrice: number }>>();
    for (const row of ivResult.rows) {
      if (!expiryRows.has(row.expiry)) expiryRows.set(row.expiry, []);
      expiryRows.get(row.expiry)!.push({
        strike: parseFloat(row.strike),
        iv: parseFloat(row.iv),
        undPrice: parseFloat(row.underlying_price),
      });
    }

    for (const [exp, rows] of expiryRows.entries()) {
      const undP = rows.find(r => r.undPrice > 0)?.undPrice || underlyingPrice;
      // Find strike closest to underlying
      const atm = rows.reduce((closest, r) =>
        Math.abs(r.strike - undP) < Math.abs(closest.strike - undP) ? r : closest
      , rows[0]);
      if (atm) ivByExpiry.set(exp, { iv: atm.iv, undPrice: undP });
    }

    const ivTermStructure = futureExpirations.map(exp => ({
      expiry: exp,
      daysToExpiry: daysToExpiry(exp),
      atmIV: ivByExpiry.get(exp) ? (ivByExpiry.get(exp)!.iv * 100) : null,
      underlyingPrice: ivByExpiry.get(exp)?.undPrice || 0,
    }));

    return NextResponse.json({
      symbol,
      underlyingPrice,
      currency: meta.currency || "USD",
      selectedExpiry: expiry,
      expirations: futureExpirations,
      strikes: allStrikes,
      multiplier: meta.multiplier || 100,
      chain: chainRows,
      ivTermStructure,
      oiDistribution,
      putCallRatio: totalCallOI > 0 ? totalPutOI / totalCallOI : 0,
      putCallVolumeRatio: totalCallVolume > 0 ? totalPutVolume / totalCallVolume : 0,
      totalPutOI,
      totalCallOI,
      totalPutVolume,
      totalCallVolume,
      maxPain,
      lastUpdated: meta.fetched_at,
      dataType: "preloaded",
    });
  } catch (error: unknown) {
    console.error("[Options API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch options data" },
      { status: 500 }
    );
  }
}

function daysToExpiry(expiry: string): number {
  const year = parseInt(expiry.substring(0, 4));
  const month = parseInt(expiry.substring(4, 6)) - 1;
  const day = parseInt(expiry.substring(6, 8));
  const expiryDate = new Date(year, month, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function calculateMaxPain(
  chainRows: Array<{ strike: number; call: Record<string, unknown> | null; put: Record<string, unknown> | null }>,
  strikes: number[]
): { strike: number; value: number } {
  let minPain = Infinity;
  let maxPainStrike = 0;

  for (const testStrike of strikes) {
    let totalPain = 0;
    for (const row of chainRows) {
      const callOI = (row.call?.openInterest as number) || 0;
      const putOI = (row.put?.openInterest as number) || 0;
      if (testStrike > row.strike) totalPain += (testStrike - row.strike) * callOI * 100;
      if (testStrike < row.strike) totalPain += (row.strike - testStrike) * putOI * 100;
    }
    if (totalPain < minPain) {
      minPain = totalPain;
      maxPainStrike = testStrike;
    }
  }

  return { strike: maxPainStrike, value: minPain };
}

// ─── Synthetic Bid/Ask Fill ─────────────────────────────────────
// Standard normal CDF approximation (Abramowitz & Stegun)
function normCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1.0 / (1.0 + p * Math.abs(x));
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1.0 + sign * y);
}

// Simple Black-Scholes price (no Greeks needed here)
function bsPrice(type: "call" | "put", S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return Math.max(0, type === "call" ? S - K : K - S);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (type === "call") {
    return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
  } else {
    return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
  }
}

/**
 * Fill synthetic bid/ask for options where bid=0 and ask=0.
 * Uses the last price if available, otherwise Black-Scholes theoretical price.
 * Spread widens for more OTM options (5-25% of mid price).
 */
function fillSyntheticBidAsk(
  chainRows: Array<{ strike: number; call: Record<string, unknown> | null; put: Record<string, unknown> | null }>,
  underlyingPrice: number,
  expiry: string
) {
  const T = Math.max(daysToExpiry(expiry), 1) / 365;
  const r = 0.04;

  // Find a reasonable fallback IV from strikes that have real IV data
  let fallbackIV = 0.30;
  const sorted = [...chainRows].sort((a, b) => Math.abs(a.strike - underlyingPrice) - Math.abs(b.strike - underlyingPrice));
  for (const row of sorted) {
    for (const side of [row.call, row.put]) {
      const iv = side ? (side.iv as number) || 0 : 0;
      if (iv >= 0.05 && iv < 2.0) { fallbackIV = iv; break; }
    }
    if (fallbackIV !== 0.30) break;
  }

  for (const row of chainRows) {
    const moneyness = Math.abs(row.strike - underlyingPrice) / underlyingPrice;
    // Spread: 5% near ATM, up to 25% for deep OTM
    const spreadPct = Math.min(0.05 + moneyness * 0.5, 0.25);

    for (const [side, type] of [[row.call, "call"], [row.put, "put"]] as const) {
      if (!side) continue;
      const bid = side.bid as number;
      const ask = side.ask as number;

      if (bid > 0 && ask > 0) continue; // Real quotes exist

      const last = side.last as number;
      const iv = ((side.iv as number) >= 0.05 && (side.iv as number) < 2.0)
        ? (side.iv as number)
        : fallbackIV;

      let mid: number;
      if (last > 0) {
        mid = last;
      } else {
        // No last price — calculate theoretical price via BS
        mid = bsPrice(type, underlyingPrice, row.strike, T, r, iv);
      }

      if (mid < 0.01) mid = 0.01; // Floor at 1 cent

      const halfSpread = mid * spreadPct / 2;
      side.bid = Math.max(0.01, parseFloat((mid - halfSpread).toFixed(2)));
      side.ask = parseFloat((mid + halfSpread).toFixed(2));
      // Also fill last if it was 0
      if ((side.last as number) === 0) {
        side.last = parseFloat(mid.toFixed(2));
      }
      // Mark as synthetic so frontend can style differently
      side.synthetic = true;
    }
  }
}

// ─── IV Solver (Newton-Raphson) ─────────────────────────────────
function impliedVolFromMid(
  type: "call" | "put", price: number, S: number, K: number, T: number, r: number
): number {
  if (price <= 0 || T <= 0 || S <= 0 || K <= 0) return 0;
  // Intrinsic value check
  const intrinsic = type === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
  if (price < intrinsic * 0.9) return 0; // Price below intrinsic — bad data

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
  // Only return if converged to a reasonable range
  return (sigma >= 0.05 && sigma <= 3.0) ? sigma : 0;
}

/**
 * Recalculate IV from mid(bid,ask) for all options in the chain.
 * Stored IV is often derived from stale lastPrice; mid of current bid/ask
 * reflects live market conditions and produces smoother, more reliable skew curves.
 */
function recalcIVFromMid(
  chainRows: Array<{ strike: number; call: Record<string, unknown> | null; put: Record<string, unknown> | null }>,
  underlyingPrice: number,
  expiry: string
) {
  if (underlyingPrice <= 0) return;
  const T = Math.max(daysToExpiry(expiry), 1) / 365;
  const r = 0.04;

  for (const row of chainRows) {
    for (const [side, type] of [[row.call, "call"], [row.put, "put"]] as const) {
      if (!side) continue;
      const bid = side.bid as number;
      const ask = side.ask as number;

      // Only recalculate if we have real (non-synthetic) bid and ask
      if (bid <= 0 || ask <= 0 || side.synthetic) continue;

      const mid = (bid + ask) / 2;
      if (mid <= 0) continue;

      const newIV = impliedVolFromMid(type, mid, underlyingPrice, row.strike, T, r);
      if (newIV >= 0.05 && newIV <= 2.0) {
        side.iv = newIV;
      }
    }
  }
}
