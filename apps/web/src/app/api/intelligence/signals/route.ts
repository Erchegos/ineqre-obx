/**
 * Intelligence Signals API
 * GET /api/intelligence/signals
 *
 * Aggregates ML predictions + factor data into ranked signal list.
 * Returns BUY/SELL/HOLD signals with confidence, momentum, and valuation.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function classifySignal(prediction: number): string {
  if (prediction > 0.04) return "STRONG BUY";
  if (prediction > 0.015) return "BUY";
  if (prediction > -0.015) return "HOLD";
  if (prediction > -0.04) return "SELL";
  return "STRONG SELL";
}

function signalImportance(prediction: number): number {
  const abs = Math.abs(prediction);
  if (abs > 0.05) return 5;
  if (abs > 0.03) return 4;
  if (abs > 0.02) return 3;
  if (abs > 0.01) return 2;
  return 1;
}

export async function GET(req: NextRequest) {
  try {
    const result = await pool.query(`
      WITH latest_predictions AS (
        SELECT DISTINCT ON (mp.ticker)
          mp.ticker,
          mp.ensemble_prediction,
          mp.gb_prediction,
          mp.rf_prediction,
          mp.p05, mp.p25, mp.p50, mp.p75, mp.p95,
          mp.confidence_score,
          mp.prediction_date
        FROM ml_predictions mp
        ORDER BY mp.ticker, mp.prediction_date DESC
      ),
      latest_prices AS (
        SELECT DISTINCT ON (pd.ticker)
          pd.ticker,
          pd.close AS last_close,
          pd.volume,
          pd.date AS price_date
        FROM prices_daily pd
        JOIN stocks s ON s.ticker = pd.ticker AND s.asset_type = 'equity'
        ORDER BY pd.ticker, pd.date DESC
      ),
      prev_prices AS (
        SELECT DISTINCT ON (pd.ticker)
          pd.ticker,
          pd.close AS prev_close
        FROM prices_daily pd
        JOIN stocks s ON s.ticker = pd.ticker AND s.asset_type = 'equity'
        WHERE pd.date < (SELECT max(date) FROM prices_daily pd2 WHERE pd2.ticker = pd.ticker)
        ORDER BY pd.ticker, pd.date DESC
      ),
      latest_tech AS (
        SELECT DISTINCT ON (ft.ticker)
          ft.ticker, ft.mom1m, ft.mom6m, ft.vol1m, ft.beta
        FROM factor_technical ft
        ORDER BY ft.ticker, ft.date DESC
      ),
      latest_fund AS (
        SELECT DISTINCT ON (ff.ticker)
          ff.ticker, ff.ep, ff.bm, ff.dy, ff.mktcap
        FROM factor_fundamentals ff
        ORDER BY ff.ticker, ff.date DESC
      )
      SELECT
        lp.ticker,
        s.name,
        s.sector,
        lp.ensemble_prediction,
        lp.confidence_score,
        lp.p05, lp.p25, lp.p50, lp.p75, lp.p95,
        lp.prediction_date,
        pr.last_close,
        pr.volume,
        pp.prev_close,
        lt.mom1m, lt.mom6m, lt.vol1m, lt.beta,
        lf.ep, lf.bm, lf.dy, lf.mktcap
      FROM latest_predictions lp
      JOIN stocks s ON s.ticker = lp.ticker
      LEFT JOIN latest_prices pr ON pr.ticker = lp.ticker
      LEFT JOIN prev_prices pp ON pp.ticker = lp.ticker
      LEFT JOIN latest_tech lt ON lt.ticker = lp.ticker
      LEFT JOIN latest_fund lf ON lf.ticker = lp.ticker
      ORDER BY abs(lp.ensemble_prediction) DESC
    `);

    const signals = result.rows.map(r => {
      const prediction = parseFloat(r.ensemble_prediction);
      const dayReturn = r.prev_close && r.last_close
        ? (r.last_close - r.prev_close) / r.prev_close
        : null;

      return {
        ticker: r.ticker,
        name: r.name,
        sector: r.sector,
        signal: classifySignal(prediction),
        importance: signalImportance(prediction),
        prediction,
        confidence: r.confidence_score ? parseFloat(r.confidence_score) : null,
        percentiles: {
          p05: r.p05 ? parseFloat(r.p05) : null,
          p25: r.p25 ? parseFloat(r.p25) : null,
          p50: r.p50 ? parseFloat(r.p50) : null,
          p75: r.p75 ? parseFloat(r.p75) : null,
          p95: r.p95 ? parseFloat(r.p95) : null,
        },
        predictionDate: r.prediction_date,
        lastClose: r.last_close ? parseFloat(r.last_close) : null,
        dayReturn,
        volume: r.volume ? parseInt(r.volume) : null,
        momentum: {
          mom1m: r.mom1m ? parseFloat(r.mom1m) : null,
          mom6m: r.mom6m ? parseFloat(r.mom6m) : null,
        },
        volatility: r.vol1m ? parseFloat(r.vol1m) : null,
        beta: r.beta ? parseFloat(r.beta) : null,
        valuation: {
          ep: r.ep ? parseFloat(r.ep) : null,
          bm: r.bm ? parseFloat(r.bm) : null,
          dy: r.dy ? parseFloat(r.dy) : null,
        },
        mktcap: r.mktcap ? parseFloat(r.mktcap) : null,
      };
    });

    const buyCount = signals.filter(s => s.signal === "BUY" || s.signal === "STRONG BUY").length;
    const sellCount = signals.filter(s => s.signal === "SELL" || s.signal === "STRONG SELL").length;
    const holdCount = signals.filter(s => s.signal === "HOLD").length;

    return NextResponse.json({
      signals,
      summary: { buyCount, sellCount, holdCount, total: signals.length },
    });
  } catch (err) {
    console.error("[INTELLIGENCE SIGNALS]", err);
    return NextResponse.json({ error: "Failed to fetch signals" }, { status: 500 });
  }
}
