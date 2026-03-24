/**
 * GET /api/fx/pairs-trade
 *
 * Runs Kalman filter pairs trading simulation on two NOK-denominated FX rates.
 *
 * Query params:
 *   pairY   — base pair (e.g. "NOKUSD")
 *   pairX   — quote pair (e.g. "NOKEUR")
 *   delta   — state drift variance (default 0.0001)
 *   ve      — observation noise (default 0.001)
 *   days    — history window (default 756, ~3 years)
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { runKalmanPairs, KalmanParams } from "@/lib/fxKalmanPairs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_PAIRS = ["NOKUSD", "NOKEUR", "NOKGBP", "NOKSEK", "NOKDKK"];

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const pairY = sp.get("pairY") || "NOKUSD";
    const pairX = sp.get("pairX") || "NOKEUR";
    const delta = Math.max(1e-7, Math.min(1e-1, parseFloat(sp.get("delta") || "0.00001")));
    const Ve    = Math.max(1e-6, Math.min(1e-0, parseFloat(sp.get("ve")    || "0.001")));
    const days  = Math.min(1260, Math.max(60, parseInt(sp.get("days") || "252")));
    const positionSizePct = Math.max(1, Math.min(50, parseFloat(sp.get("pos") || "15")));
    const totalCostBps    = Math.max(0, Math.min(50, parseFloat(sp.get("cost") || "5")));
    const entryZ = Math.max(0.5, Math.min(5.0, parseFloat(sp.get("entryz") || "1.8")));
    const exitZ  = Math.max(0.0, Math.min(2.0, parseFloat(sp.get("exitz")  || "0.6")));
    const stopZ  = Math.max(1.0, Math.min(6.0, parseFloat(sp.get("stopz")  || "2.8")));

    if (!VALID_PAIRS.includes(pairY) || !VALID_PAIRS.includes(pairX)) {
      return NextResponse.json({ error: "Invalid pair" }, { status: 400 });
    }
    if (pairY === pairX) {
      return NextResponse.json({ error: "Pairs must be different" }, { status: 400 });
    }

    // Fetch aligned daily spot rates for both pairs.
    // DISTINCT ON (date) prevents duplicate rows (e.g. multiple intraday or
    // re-imported records) from cartesian-multiplying in the JOIN — without it
    // a 5Y window with even a handful of duplicates produces 2-3× too many
    // bars, bypassing MIN_HOLD/COOLDOWN and inflating trade counts.
    const res = await pool.query(`
      WITH y_rates AS (
        SELECT DISTINCT ON (date) date, spot_rate::float AS rate
        FROM fx_spot_rates
        WHERE currency_pair = $1
          AND date >= CURRENT_DATE - INTERVAL '${days} days'
          AND spot_rate IS NOT NULL AND spot_rate::float > 0
        ORDER BY date, spot_rate DESC
      ),
      x_rates AS (
        SELECT DISTINCT ON (date) date, spot_rate::float AS rate
        FROM fx_spot_rates
        WHERE currency_pair = $2
          AND date >= CURRENT_DATE - INTERVAL '${days} days'
          AND spot_rate IS NOT NULL AND spot_rate::float > 0
        ORDER BY date, spot_rate DESC
      )
      SELECT y.date::text, y.rate AS rate_y, x.rate AS rate_x
      FROM y_rates y
      JOIN x_rates x ON x.date = y.date
      ORDER BY y.date ASC
    `, [pairY, pairX]);

    // JS-level dedup: safety net in case any duplicate dates slip through
    const seen = new Set<string>();
    const deduped = res.rows.filter((r: { date: string }) => {
      if (seen.has(r.date)) return false;
      seen.add(r.date);
      return true;
    });

    if (deduped.length < 60) {
      return NextResponse.json(
        { error: `Insufficient data: only ${deduped.length} aligned observations` },
        { status: 422 }
      );
    }

    const dates  = deduped.map((r: { date: string }) => r.date);
    const logY   = deduped.map((r: { rate_y: number }) => Math.log(r.rate_y));
    const logX   = deduped.map((r: { rate_x: number }) => Math.log(r.rate_x));

    const params: KalmanParams = { delta, Ve, positionSizePct, totalCostBps, entryZ, exitZ, stopZ };
    const result = runKalmanPairs(dates, logY, logX, pairY, pairX, params);

    // Thin the series for the response (keep every point for charts, cap at 1000)
    const thinFactor = Math.max(1, Math.ceil(result.series.length / 1000));
    const thinned = result.series.filter((_, i) => i % thinFactor === 0 || i === result.series.length - 1);

    return NextResponse.json({
      pairY,
      pairX,
      params: { delta, Ve, days, positionSizePct, totalCostBps, entryZ, exitZ, stopZ },
      observations: deduped.length,
      series: thinned.map(pt => ({
        date: pt.date,
        logY: Math.round(pt.logY * 10000) / 10000,
        logX: Math.round(pt.logX * 10000) / 10000,
        alpha: Math.round(pt.alpha * 10000) / 10000,
        beta: Math.round(pt.beta * 10000) / 10000,
        spread: Math.round(pt.spread * 10000) / 10000,
        zscore: Math.round(pt.zscore * 1000) / 1000,
        spreadVol: Math.round(pt.spreadVol * 10000) / 10000,
      })),
      trades: result.trades,
      equity: result.equity,
      stats: result.stats,
    });

  } catch (err) {
    console.error("[FX PAIRS TRADE]", err);
    return NextResponse.json({ error: "Pairs trade computation failed" }, { status: 500 });
  }
}
