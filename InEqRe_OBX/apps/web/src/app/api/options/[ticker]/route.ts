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
        theta: parseFloat(row.theta) || 0,
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
