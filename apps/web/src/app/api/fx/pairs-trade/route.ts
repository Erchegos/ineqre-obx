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
    const delta = Math.max(1e-6, Math.min(1e-1, parseFloat(sp.get("delta") || "0.0001")));
    const Ve    = Math.max(1e-5, Math.min(1e-0, parseFloat(sp.get("ve")    || "0.001")));
    const days  = Math.min(1260, Math.max(60, parseInt(sp.get("days") || "252")));
    const positionSizePct = Math.max(1, Math.min(50, parseFloat(sp.get("pos") || "15")));
    const totalCostBps    = Math.max(0, Math.min(50, parseFloat(sp.get("cost") || "5")));

    if (!VALID_PAIRS.includes(pairY) || !VALID_PAIRS.includes(pairX)) {
      return NextResponse.json({ error: "Invalid pair" }, { status: 400 });
    }
    if (pairY === pairX) {
      return NextResponse.json({ error: "Pairs must be different" }, { status: 400 });
    }

    // Fetch aligned daily spot rates for both pairs
    const res = await pool.query(`
      WITH y_rates AS (
        SELECT date, spot_rate::float AS rate
        FROM fx_spot_rates
        WHERE currency_pair = $1
          AND date >= CURRENT_DATE - INTERVAL '${days} days'
          AND spot_rate IS NOT NULL AND spot_rate::float > 0
      ),
      x_rates AS (
        SELECT date, spot_rate::float AS rate
        FROM fx_spot_rates
        WHERE currency_pair = $2
          AND date >= CURRENT_DATE - INTERVAL '${days} days'
          AND spot_rate IS NOT NULL AND spot_rate::float > 0
      )
      SELECT y.date::text, y.rate AS rate_y, x.rate AS rate_x
      FROM y_rates y
      JOIN x_rates x ON x.date = y.date
      ORDER BY y.date ASC
    `, [pairY, pairX]);

    if (res.rows.length < 60) {
      return NextResponse.json(
        { error: `Insufficient data: only ${res.rows.length} aligned observations` },
        { status: 422 }
      );
    }

    const dates  = res.rows.map((r: { date: string }) => r.date);
    const logY   = res.rows.map((r: { rate_y: number }) => Math.log(r.rate_y));
    const logX   = res.rows.map((r: { rate_x: number }) => Math.log(r.rate_x));

    const params: KalmanParams = { delta, Ve, positionSizePct, totalCostBps };
    const result = runKalmanPairs(dates, logY, logX, pairY, pairX, params);

    // Thin the series for the response (keep every point for charts, cap at 1000)
    const thinFactor = Math.max(1, Math.ceil(result.series.length / 1000));
    const thinned = result.series.filter((_, i) => i % thinFactor === 0 || i === result.series.length - 1);

    return NextResponse.json({
      pairY,
      pairX,
      params: { delta, Ve, days, positionSizePct, totalCostBps },
      observations: res.rows.length,
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
