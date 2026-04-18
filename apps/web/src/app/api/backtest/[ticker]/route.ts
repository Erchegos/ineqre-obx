import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { runMLSimulation, SIM_DEFAULTS } from "@/lib/mlTradingEngine";
import type { SimParams, SimInputBar } from "@/lib/mlTradingEngine";

export const dynamic = "force-dynamic";

/**
 * GET /api/backtest/[ticker]?days=1260&signal=daily&entry=1.0&exit=0.25&stop=5&tp=15&maxHold=21&minHold=3
 *
 * Daily rolling ML backtest using the same engine as the Alpha simulator.
 * Signal modes:
 *   - "daily" (default): 21-day forward return (fwd_ret_21d) — computed from prices
 *   - "monthly": ML ensemble predictions from backtest_predictions table (step-held daily)
 * Returns: stats, trades, equity curve series, and the params used.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker: rawTicker } = await params;
    const ticker = rawTicker.toUpperCase().trim();
    const url = new URL(req.url);

    // Signal mode: "daily" (fwd_ret_21d) or "monthly" (ml_predictions)
    const signalMode = url.searchParams.get("signal") === "monthly" ? "monthly" : "daily";
    const days = parseInt(url.searchParams.get("days") || "1260");
    const simParams: SimParams = {
      ...SIM_DEFAULTS,
      entryThreshold: parseFloat(url.searchParams.get("entry") || "1.0"),
      exitThreshold: parseFloat(url.searchParams.get("exit") || "0.25"),
      stopLossPct: parseFloat(url.searchParams.get("stop") || "5.0"),
      takeProfitPct: parseFloat(url.searchParams.get("tp") || "15.0"),
      maxHoldDays: parseInt(url.searchParams.get("maxHold") || "21"),
      minHoldDays: parseInt(url.searchParams.get("minHold") || "3"),
      cooldownBars: parseInt(url.searchParams.get("cooldown") || "2"),
      costBps: parseInt(url.searchParams.get("cost") || "10"),
    };

    // 1. Prices with SMA200/SMA50 + 21-day forward return signal
    const priceRes = await pool.query(
      `
      WITH raw AS (
        SELECT date, open::float, high::float, low::float, close::float, volume::float
        FROM prices_daily
        WHERE ticker = $1
          AND date >= CURRENT_DATE - ($2 + 250 + 30) * INTERVAL '1 day'
        ORDER BY date
      ),
      with_fwd AS (
        SELECT *,
          AVG(close) OVER (ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS sma200,
          AVG(close) OVER (ORDER BY date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS sma50,
          (LEAD(close, 21) OVER (ORDER BY date) - close) / NULLIF(close, 0) AS fwd_ret_21d,
          ROW_NUMBER() OVER (ORDER BY date) AS rn
        FROM raw
      )
      SELECT date, open, high, low, close, volume,
             sma200::float, sma50::float,
             fwd_ret_21d::float
      FROM with_fwd
      WHERE rn > 200 AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
      ORDER BY date ASC
    `,
      [ticker, days]
    );

    if (priceRes.rows.length === 0) {
      // Return available tickers
      const availRes = await pool.query(
        `SELECT DISTINCT ticker FROM prices_daily
         WHERE date >= CURRENT_DATE - 30 * INTERVAL '1 day'
         ORDER BY ticker`
      );
      return NextResponse.json(
        {
          success: false,
          error: `No price data for ${ticker}`,
          availableTickers: availRes.rows.map((r: { ticker: string }) => r.ticker).slice(0, 100),
        },
        { status: 404 }
      );
    }

    // 2. Momentum factors
    const momRes = await pool.query(
      `SELECT date, mom1m::float, mom6m::float, mom11m::float, vol1m::float
       FROM factor_technical
       WHERE ticker = $1 AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
       ORDER BY date ASC`,
      [ticker, days]
    );

    // 3. Fundamental factors
    const fundRes = await pool.query(
      `SELECT date, ep::float, bm::float
       FROM factor_fundamentals
       WHERE ticker = $1 AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
       ORDER BY date ASC`,
      [ticker, days]
    );

    // 4. Sector z-scores
    const stockInfo = await pool.query(
      `SELECT sector FROM stocks WHERE ticker = $1 LIMIT 1`,
      [ticker]
    );
    const sector = stockInfo.rows[0]?.sector || "";

    let sectorEpAvg = 0,
      sectorEpStd = 1,
      sectorBmAvg = 0,
      sectorBmStd = 1;
    if (sector) {
      const sectorRes = await pool.query(
        `SELECT AVG(f.ep)::float AS avg_ep, COALESCE(STDDEV(f.ep), 1)::float AS std_ep,
                AVG(f.bm)::float AS avg_bm, COALESCE(STDDEV(f.bm), 1)::float AS std_bm
         FROM (
           SELECT DISTINCT ON (ticker) ticker, ep, bm
           FROM factor_fundamentals
           WHERE ticker IN (SELECT ticker FROM stocks WHERE sector = $1)
           ORDER BY ticker, date DESC
         ) f`,
        [sector]
      );
      if (sectorRes.rows[0]) {
        sectorEpAvg = sectorRes.rows[0].avg_ep || 0;
        sectorEpStd = sectorRes.rows[0].std_ep || 1;
        sectorBmAvg = sectorRes.rows[0].avg_bm || 0;
        sectorBmStd = sectorRes.rows[0].std_bm || 1;
      }
    }

    // 5. OBX benchmark
    const obxRes = await pool.query(
      `SELECT date, close::float AS obx_close
       FROM prices_daily
       WHERE ticker = 'OBX' AND date >= CURRENT_DATE - $1 * INTERVAL '1 day'
       ORDER BY date ASC`,
      [days]
    );

    // Build lookup maps
    const momMap = new Map<string, { mom1m: number; mom6m: number; mom11m: number; vol1m: number }>();
    for (const r of momRes.rows) momMap.set(r.date.toISOString().slice(0, 10), r);

    const fundMap = new Map<string, { ep: number; bm: number }>();
    for (const r of fundRes.rows) fundMap.set(r.date.toISOString().slice(0, 10), r);

    const obxMap = new Map<string, number>();
    for (const r of obxRes.rows) obxMap.set(r.date.toISOString().slice(0, 10), r.obx_close);

    // Assemble SimInputBar[]
    const input: SimInputBar[] = priceRes.rows.map((px: any) => {
      const d = px.date.toISOString().slice(0, 10);
      const mom = momMap.get(d);
      const fund = fundMap.get(d);
      const obx = obxMap.get(d) ?? null;
      const ep = fund?.ep ?? null;
      const bm = fund?.bm ?? null;

      return {
        date: d,
        open: px.open,
        close: px.close,
        high: px.high,
        low: px.low,
        volume: px.volume,
        sma200: px.sma200,
        sma50: px.sma50,
        mlPrediction: px.fwd_ret_21d ?? null,
        mlConfidence: px.fwd_ret_21d != null ? 0.8 : null,
        mom1m: mom?.mom1m ?? null,
        mom6m: mom?.mom6m ?? null,
        mom11m: mom?.mom11m ?? null,
        vol1m: mom?.vol1m ?? null,
        volRegime: null as "low" | "high" | null,
        ep,
        bm,
        epSectorZ: ep != null && sectorEpStd > 0 ? (ep - sectorEpAvg) / sectorEpStd : null,
        bmSectorZ: bm != null && sectorBmStd > 0 ? (bm - sectorBmAvg) / sectorBmStd : null,
        benchmarkClose: obx,
      };
    });

    // For monthly signal mode: replace fwd_ret_21d with ML ensemble predictions
    // Uses backtest_predictions (monthly end-of-month, back to 2014) step-held onto daily bars
    if (signalMode === "monthly") {
      const predRes = await pool.query(
        `SELECT DISTINCT ON (prediction_date)
                prediction_date, ensemble_prediction::float
         FROM backtest_predictions
         WHERE ticker = $1
           AND prediction_date >= CURRENT_DATE - $2 * INTERVAL '1 day'
         ORDER BY prediction_date ASC, model_type ASC`,
        [ticker, days]
      );

      // Build date->prediction map and step-hold onto daily bars
      const predMap = new Map<string, number>();
      for (const r of predRes.rows) {
        predMap.set(r.prediction_date.toISOString().slice(0, 10), r.ensemble_prediction);
      }

      // Clear daily fwd_ret_21d and overlay monthly predictions (step-held)
      let heldPred: number | null = null;
      for (const bar of input) {
        const pred = predMap.get(bar.date);
        if (pred !== undefined) heldPred = pred;
        bar.mlPrediction = heldPred;
        bar.mlConfidence = heldPred != null ? 0.8 : null;
      }
    }

    // Compute vol regime
    const vol1mVals = input
      .map((b) => b.vol1m)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    const p66 = vol1mVals.length > 0 ? vol1mVals[Math.floor(vol1mVals.length * 0.67)] : 0;
    for (const bar of input) {
      if (bar.vol1m != null) bar.volRegime = bar.vol1m > p66 ? "high" : "low";
    }

    // Run simulation
    const result = runMLSimulation(input, simParams);

    // Thin the series for transfer — only keep points needed for equity curve
    // (every bar is too much data for 1260 bars)
    const thinSeries = result.series.map((s) => ({
      date: s.date,
      price: s.price,
      equity: +s.equityValue.toFixed(2),
      benchmark: +s.benchmarkValue.toFixed(2),
      inPosition: s.inPosition,
      entryMarker: s.entryMarker,
      exitMarker: s.exitMarker,
      exitWin: s.exitWin,
      mlPrediction: s.mlPrediction != null ? +s.mlPrediction.toFixed(2) : null,
    }));

    return NextResponse.json({
      success: true,
      ticker,
      sector,
      signal: signalMode,
      days: input.length,
      params: simParams,
      stats: result.stats,
      trades: result.trades,
      series: thinSeries,
    });
  } catch (error: any) {
    console.error("Backtest error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
