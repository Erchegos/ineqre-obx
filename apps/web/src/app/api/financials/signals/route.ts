/**
 * Financials Signals API
 * GET /api/financials/signals
 *
 * Returns ML predictions, short interest with history + holders,
 * insider transactions, and auto-generated risk alerts.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKERS = [
  // Major banks
  "DNB", "MING", "NONG", "MORG", "SPOL", "SB1NO",
  // Regional banks
  "HELG", "PARB", "RING", "SOAG", "SPOG", "AURG", "JAREN", "GRONG",
  "SNOR", "MELG", "SKUE", "VVL", "BIEN", "HGSB", "ROGS", "TRSB",
  "SBNOR", "TINDE", "SB68", "KRAB", "INSTA",
  // Insurance
  "GJF", "STB", "PROT",
  // Financial services
  "ABG", "ACR", "B2I", "BNOR",
  // Investment companies
  "AKER", "BONHR", "AFK", "MGN", "SAGA", "ENDUR",
];

function signalLabel(pred: number): string {
  if (pred > 0.04) return "STRONG BUY";
  if (pred > 0.015) return "BUY";
  if (pred > -0.015) return "HOLD";
  if (pred > -0.04) return "SELL";
  return "STRONG SELL";
}

export async function GET() {
  try {
    const validResult = await pool.query(
      `SELECT ticker FROM stocks WHERE ticker = ANY($1) AND asset_type = 'equity'`,
      [TICKERS]
    );
    const validTickers = validResult.rows.map((r: any) => r.ticker);
    if (validTickers.length === 0) {
      return NextResponse.json({ predictions: [], shorts: [], insiders: [], alerts: [] });
    }

    // 1. ML Predictions (full distribution)
    const mlResult = await pool.query(
      `SELECT DISTINCT ON (mp.ticker)
        mp.ticker, mp.prediction_date::text,
        mp.ensemble_prediction::float,
        mp.confidence_score::float,
        mp.p05::float, mp.p25::float, mp.p50::float, mp.p75::float, mp.p95::float
      FROM ml_predictions mp
      WHERE mp.ticker = ANY($1)
      ORDER BY mp.ticker, mp.prediction_date DESC`,
      [validTickers]
    );

    const predictions = mlResult.rows.map((r: any) => ({
      ticker: r.ticker,
      predictionDate: r.prediction_date,
      prediction: r.ensemble_prediction,
      confidence: r.confidence_score,
      p05: r.p05, p25: r.p25, p50: r.p50, p75: r.p75, p95: r.p95,
      signal: signalLabel(r.ensemble_prediction ?? 0),
    }));

    // 2. Short positions with 90d history and holders
    const shortsResult = await pool.query(
      `WITH latest AS (
        SELECT DISTINCT ON (sp.ticker)
          sp.ticker, sp.date, sp.short_pct::float,
          sp.change_pct::float, sp.active_positions
        FROM short_positions sp
        WHERE sp.ticker = ANY($1)
        ORDER BY sp.ticker, sp.date DESC
      )
      SELECT l.*,
        (SELECT json_agg(json_build_object(
            'date', h.date::text, 'shortPct', h.short_pct::float
          ) ORDER BY h.date)
         FROM short_positions h
         WHERE h.ticker = l.ticker AND h.date >= l.date - INTERVAL '90 days'
        ) AS history,
        (SELECT json_agg(json_build_object(
            'holder', sh.position_holder, 'pct', sh.short_pct::float
          ) ORDER BY sh.short_pct DESC)
         FROM (
           SELECT DISTINCT ON (position_holder)
             position_holder, short_pct
           FROM short_position_holders
           WHERE ticker = l.ticker
           ORDER BY position_holder, date DESC
         ) sh
        ) AS holders
      FROM latest l`,
      [validTickers]
    );

    const shorts = shortsResult.rows.map((r: any) => ({
      ticker: r.ticker,
      shortPct: r.short_pct ?? 0,
      changePct: r.change_pct ?? 0,
      activePositions: r.active_positions ?? 0,
      history: r.history || [],
      holders: r.holders || [],
    }));

    // 3. Insider transactions (last 90 days)
    const insiderResult = await pool.query(
      `SELECT it.ticker, it.transaction_date::text,
        it.person_name, it.person_role,
        it.transaction_type, it.shares::float,
        it.price_per_share::float, it.total_value_nok::float,
        it.holdings_after::float
      FROM insider_transactions it
      WHERE it.ticker = ANY($1)
        AND it.transaction_date >= NOW() - INTERVAL '90 days'
      ORDER BY it.transaction_date DESC
      LIMIT 50`,
      [validTickers]
    );

    const insiders = insiderResult.rows.map((r: any) => ({
      ticker: r.ticker,
      transactionDate: r.transaction_date,
      personName: r.person_name,
      personRole: r.person_role,
      transactionType: r.transaction_type,
      shares: r.shares,
      pricePerShare: r.price_per_share,
      totalValue: r.total_value_nok,
      holdingsAfter: r.holdings_after,
    }));

    // 4. Generate risk alerts
    type Alert = { type: "critical" | "warning" | "info"; message: string; ticker: string | null };
    const alerts: Alert[] = [];

    // Short interest spikes
    for (const s of shorts) {
      if (s.shortPct > 5) {
        alerts.push({ type: "critical", message: `${s.ticker} short interest at ${s.shortPct.toFixed(1)}%`, ticker: s.ticker });
      } else if (s.changePct > 1) {
        alerts.push({ type: "warning", message: `${s.ticker} short interest spiked +${s.changePct.toFixed(1)}pp`, ticker: s.ticker });
      }
    }

    // ML consensus
    const negCount = predictions.filter((p: any) => p.prediction < 0).length;
    const posCount = predictions.filter((p: any) => p.prediction > 0).length;
    if (predictions.length > 0) {
      if (negCount > posCount) {
        alerts.push({ type: "warning", message: `Sector ML consensus: ${negCount}/${predictions.length} negative predictions`, ticker: null });
      } else {
        alerts.push({ type: "info", message: `Sector ML consensus: ${posCount}/${predictions.length} positive predictions`, ticker: null });
      }
    }

    // Heavy insider selling
    const sellCounts: Record<string, number> = {};
    const buyCounts: Record<string, number> = {};
    for (const ins of insiders) {
      const d = new Date(ins.transactionDate);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 14);
      if (d >= cutoff) {
        if (ins.transactionType === "SELL") sellCounts[ins.ticker] = (sellCounts[ins.ticker] || 0) + 1;
        if (ins.transactionType === "BUY") buyCounts[ins.ticker] = (buyCounts[ins.ticker] || 0) + 1;
      }
    }
    for (const [ticker, count] of Object.entries(sellCounts)) {
      if (count > 2) {
        alerts.push({ type: "warning", message: `${ticker} insider selling: ${count} transactions in 14 days`, ticker });
      }
    }
    for (const [ticker, count] of Object.entries(buyCounts)) {
      if (count >= 2) {
        alerts.push({ type: "info", message: `${ticker} insider buying: ${count} transactions in 14 days`, ticker });
      }
    }

    return NextResponse.json({ predictions, shorts, insiders, alerts });
  } catch (err) {
    console.error("[financials/signals]", err);
    return NextResponse.json({ error: "Failed to fetch financials signals" }, { status: 500 });
  }
}
