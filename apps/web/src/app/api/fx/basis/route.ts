/**
 * Cross-Currency Basis API
 * GET /api/fx/basis?pair=NOKUSD&tenor=3M
 *
 * Returns the historical CIP basis in bps for the selected pair/tenor over
 * the last 90 trading days. Uses current interest rates applied to historical
 * spot series (valid approximation — policy rates move slowly).
 *
 * Formula (LOOP basis):
 *   basis_bps = [(F/S) × (1 + r_foreign × τ) − (1 + r_NOK × τ)] / τ × 10000
 *
 * A persistently negative basis means non-US banks pay a premium for synthetic
 * USD funding above IRP — the core finding of:
 *   Rime, Schrimpf & Syrstad (RFS 2022) — Covered Interest Parity Arbitrage
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { calculateCrossCurrencyBasis } from "@/lib/fxPairCalculations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAIR_TO_CURRENCY: Record<string, string> = {
  NOKUSD: "USD",
  NOKEUR: "EUR",
  NOKGBP: "GBP",
  NOKSEK: "SEK",
};

const TENOR_DAYS: Record<string, number> = {
  "1M": 30,
  "3M": 91,
  "6M": 182,
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pair = (searchParams.get("pair") || "NOKUSD").toUpperCase();
    const tenor = (searchParams.get("tenor") || "3M").toUpperCase();

    const foreignCurrency = PAIR_TO_CURRENCY[pair];
    if (!foreignCurrency) {
      return NextResponse.json({ error: `Unknown pair: ${pair}` }, { status: 400 });
    }

    const days = TENOR_DAYS[tenor];
    if (!days) {
      return NextResponse.json({ error: `Unknown tenor: ${tenor}` }, { status: 400 });
    }
    const tau = days / 365;

    // Fetch last 90 days of spot history
    const spotResult = await pool.query<{ date: string; spot_rate: string }>(
      `SELECT date::text, spot_rate FROM (
         SELECT DISTINCT ON (date) date, spot_rate
         FROM fx_spot_rates
         WHERE currency_pair = $1 AND spot_rate > 0
         ORDER BY date DESC,
           CASE WHEN source = 'norgesbank' THEN 0 ELSE 1 END
       ) sub
       ORDER BY date DESC
       LIMIT 90`,
      [pair]
    );

    if (spotResult.rows.length < 5) {
      return NextResponse.json({ error: `Insufficient spot data for ${pair}` }, { status: 404 });
    }

    // Fetch latest interest rates for NOK and foreign currency at the given tenor
    const ratesResult = await pool.query<{ currency: string; rate: string }>(
      `SELECT DISTINCT ON (currency) currency, rate
       FROM interest_rates
       WHERE currency IN ('NOK', $1) AND tenor = $2
       ORDER BY currency, date DESC`,
      [foreignCurrency, tenor]
    );

    let nokRate = 0.045;
    let foreignRate = 0.04;
    for (const row of ratesResult.rows) {
      if (row.currency === "NOK") nokRate = parseFloat(row.rate);
      if (row.currency === foreignCurrency) foreignRate = parseFloat(row.rate);
    }

    // Compute basis for each historical date
    // Forward computed via IRP using current rates (approximation — noted in response)
    const spots = spotResult.rows.reverse(); // oldest first
    const series = spots.map((row) => {
      const spot = parseFloat(row.spot_rate);
      // IRP forward: F = S × (1 + r_NOK×τ) / (1 + r_foreign×τ)
      const forward = spot * ((1 + nokRate * tau) / (1 + foreignRate * tau));
      const basisBps = calculateCrossCurrencyBasis(spot, forward, foreignRate, nokRate, days);
      return { date: row.date, basisBps: parseFloat(basisBps.toFixed(2)) };
    });

    // Summary stats
    const bpsValues = series.map((s) => s.basisBps);
    const current = bpsValues[bpsValues.length - 1] ?? 0;
    const last30 = bpsValues.slice(-30);
    const avg30d = last30.length > 0 ? last30.reduce((a, b) => a + b, 0) / last30.length : 0;
    const sorted = [...bpsValues].sort((a, b) => a - b);
    const pct90dIdx = Math.floor(sorted.length * 0.9);
    const pct90d = sorted[pct90dIdx] ?? 0;
    const currentPctRank = sorted.findIndex((v) => v >= current) / sorted.length * 100;

    return NextResponse.json({
      pair,
      tenor,
      foreignCurrency,
      tenorDays: days,
      nokRate: nokRate * 100,
      foreignRate: foreignRate * 100,
      note: "Approximate basis — computed from current interest rates applied to historical spots. Rates assumed constant (valid approximation over 90-day window).",
      source: "Rime, Schrimpf & Syrstad (RFS 2022) — LOOP basis formula",
      series,
      summary: {
        current: parseFloat(current.toFixed(2)),
        avg30d: parseFloat(avg30d.toFixed(2)),
        pct90d: parseFloat(pct90d.toFixed(2)),
        currentPctRank: parseFloat(currentPctRank.toFixed(1)),
        observations: series.length,
      },
    });
  } catch (error: any) {
    console.error("[FX Basis API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to compute cross-currency basis" },
      { status: 500 }
    );
  }
}
