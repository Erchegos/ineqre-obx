import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Latest signals for all tickers
    const { rows: signals } = await pool.query(`
      SELECT DISTINCT ON (ticker)
        ticker, ts, vpin_50::float, vpin_percentile::float,
        kyle_lambda_60m::float, ofi_cumulative::float, ofi_5m::float,
        toxicity_score::float, regime, spread_regime
      FROM orderflow_signals
      ORDER BY ticker, ts DESC
    `);

    // Today's iceberg count per ticker
    const { rows: icebergCounts } = await pool.query(`
      SELECT ticker, COUNT(*)::int AS count
      FROM orderflow_iceberg_detections
      WHERE detected_at > NOW() - INTERVAL '24 hours'
      GROUP BY ticker
    `);
    const icebergMap: Record<string, number> = {};
    for (const r of icebergCounts) icebergMap[r.ticker] = r.count;

    // Latest price + change per ticker (from bars)
    const { rows: latestBars } = await pool.query(`
      SELECT DISTINCT ON (ticker)
        ticker, close::float AS price, open::float,
        CASE WHEN open > 0 THEN ((close - open) / open * 100) ELSE 0 END AS change_pct
      FROM orderflow_bars
      WHERE bar_type = 'time_5m'
      ORDER BY ticker, bar_close_ts DESC
    `);
    const priceMap: Record<string, { price: number; changePct: number }> = {};
    for (const r of latestBars)
      priceMap[r.ticker] = { price: r.price, changePct: Number(r.change_pct) };

    // Recent regime transitions
    const { rows: transitions } = await pool.query(`
      WITH ranked AS (
        SELECT ticker, ts, regime,
          LAG(regime) OVER (PARTITION BY ticker ORDER BY ts) AS prev_regime
        FROM orderflow_signals
        WHERE ts > NOW() - INTERVAL '24 hours'
      )
      SELECT ticker, ts, prev_regime, regime
      FROM ranked
      WHERE regime != prev_regime AND prev_regime IS NOT NULL
      ORDER BY ts DESC
      LIMIT 10
    `);

    // Recent iceberg alerts
    const { rows: recentIcebergs } = await pool.query(`
      SELECT ticker, detected_at, direction, total_volume, confidence::float,
             est_block_pct::float, vwap::float
      FROM orderflow_iceberg_detections
      WHERE detected_at > NOW() - INTERVAL '24 hours'
      ORDER BY detected_at DESC
      LIMIT 10
    `);

    // Aggregate KPIs
    const tickers = signals.map((s: any) => ({
      ticker: s.ticker,
      vpin: s.vpin_50,
      vpinPercentile: s.vpin_percentile,
      kyleLambda: s.kyle_lambda_60m,
      ofiCumulative: s.ofi_cumulative,
      ofi5m: s.ofi_5m,
      toxicity: s.toxicity_score,
      regime: s.regime,
      spreadRegime: s.spread_regime,
      icebergsToday: icebergMap[s.ticker] || 0,
      price: priceMap[s.ticker]?.price || 0,
      changePct: priceMap[s.ticker]?.changePct || 0,
      ts: s.ts,
    }));

    const avgVpin =
      tickers.length > 0
        ? tickers.reduce((s: number, t: any) => s + (t.vpin || 0), 0) / tickers.length
        : 0;
    const informedCount = tickers.filter(
      (t: any) => t.regime === "informed_buying" || t.regime === "informed_selling"
    ).length;
    const totalIcebergs = tickers.reduce(
      (s: number, t: any) => s + t.icebergsToday,
      0
    );

    return NextResponse.json({
      kpi: {
        marketVpin: Math.round(avgVpin * 1000) / 1000,
        informedTickers: informedCount,
        totalTickers: tickers.length,
        icebergsToday: totalIcebergs,
      },
      tickers,
      recentIcebergs,
      transitions,
    });
  } catch (e: any) {
    console.error("[flow/dashboard] Error:", e);
    return NextResponse.json(
      { error: "Dashboard fetch failed", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
