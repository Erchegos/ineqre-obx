import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/portfolio/backtest
 *
 * Walk-forward ML backtest for a portfolio of tickers with user-defined weights.
 * Uses existing backtest_predictions data (monthly prediction/actual pairs).
 *
 * Strategies compared:
 * 1. Static — hold user weights throughout
 * 2. ML-Tilted — overweight tickers with positive ML predictions, underweight negative
 * 3. ML Long-Only — exclude tickers with negative predictions, redistribute
 * 4. OBX Benchmark — index return for comparison
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tickers, weights } = body as {
      tickers: string[];
      weights: number[];
    };

    if (!tickers || !weights || tickers.length < 2 || tickers.length !== weights.length) {
      return NextResponse.json(
        { error: "Provide tickers[] and weights[] of equal length (min 2)" },
        { status: 400 }
      );
    }

    // Normalize weights
    const wSum = weights.reduce((s: number, w: number) => s + w, 0);
    const normWeights = weights.map((w: number) => w / wSum);

    // Get latest backtest run
    const runResult = await pool.query(
      `SELECT id, model_version, n_months, backtest_start, backtest_end, created_at
       FROM backtest_runs ORDER BY created_at DESC LIMIT 1`
    );
    if (runResult.rows.length === 0) {
      return NextResponse.json({ error: "No backtest runs found" }, { status: 404 });
    }
    const run = runResult.rows[0];

    // Get all predictions for these tickers from the latest run
    const predResult = await pool.query(
      `SELECT
        ticker, prediction_date, target_date,
        ensemble_prediction, actual_return,
        p05, p25, p50, p75, p95,
        confidence_score, direction_correct, quintile
      FROM backtest_predictions
      WHERE backtest_run_id = $1
        AND ticker = ANY($2)
        AND actual_return IS NOT NULL
      ORDER BY prediction_date ASC, ticker ASC`,
      [run.id, tickers]
    );

    if (predResult.rows.length === 0) {
      return NextResponse.json({ error: "No backtest data for these tickers" }, { status: 404 });
    }

    // Group predictions by month (prediction_date)
    const monthMap = new Map<string, Map<string, {
      prediction: number;
      actual: number;
      directionCorrect: boolean;
      confidence: number;
      quintile: number;
    }>>();

    for (const row of predResult.rows) {
      const month = row.prediction_date.toISOString().slice(0, 10);
      if (!monthMap.has(month)) monthMap.set(month, new Map());
      monthMap.get(month)!.set(row.ticker, {
        prediction: parseFloat(row.ensemble_prediction),
        actual: parseFloat(row.actual_return),
        directionCorrect: row.direction_correct === true,
        confidence: parseFloat(row.confidence_score),
        quintile: parseInt(row.quintile),
      });
    }

    const months = Array.from(monthMap.keys()).sort();

    // Also fetch OBX benchmark returns for the same periods
    // Use prices_daily for OBX index
    const obxReturns = new Map<string, number>();
    for (const month of months) {
      const monthData = monthMap.get(month)!;
      // Use the first ticker's prediction_date as the start, target would be ~21 trading days later
      // We'll just use the average actual return across all tickers weighted by market as a proxy
      // Better: fetch OBX actual price returns for same periods
      const predDate = month;
      // Find target date from any prediction row for this month
      const targetRow = predResult.rows.find(
        (r: { prediction_date: Date }) => r.prediction_date.toISOString().slice(0, 10) === month
      );
      if (targetRow) {
        const targetDate = targetRow.target_date.toISOString().slice(0, 10);
        const obxResult = await pool.query(
          `WITH dates AS (
            SELECT
              (SELECT adj_close FROM prices_daily WHERE ticker = 'OBX' AND date <= $1 ORDER BY date DESC LIMIT 1) as start_price,
              (SELECT adj_close FROM prices_daily WHERE ticker = 'OBX' AND date <= $2 ORDER BY date DESC LIMIT 1) as end_price
          )
          SELECT start_price, end_price FROM dates`,
          [predDate, targetDate]
        );
        if (obxResult.rows.length > 0 && obxResult.rows[0].start_price && obxResult.rows[0].end_price) {
          const startP = parseFloat(obxResult.rows[0].start_price);
          const endP = parseFloat(obxResult.rows[0].end_price);
          obxReturns.set(month, (endP - startP) / startP);
        }
      }
    }

    // Build weight map for quick lookup
    const weightMap: Record<string, number> = {};
    for (let i = 0; i < tickers.length; i++) {
      weightMap[tickers[i]] = normWeights[i];
    }

    // Compute strategy returns for each month
    interface MonthResult {
      month: string;
      staticReturn: number;
      mlTiltedReturn: number;
      mlLongOnlyReturn: number;
      obxReturn: number;
      tickersCovered: number;
      tickersTotal: number;
      avgPrediction: number;
      avgActual: number;
      hitRate: number;
    }

    const monthlyResults: MonthResult[] = [];
    let cumStatic = 1;
    let cumMlTilted = 1;
    let cumMlLongOnly = 1;
    let cumObx = 1;

    const cumulativeSeries: {
      month: string;
      static: number;
      mlTilted: number;
      mlLongOnly: number;
      obx: number;
    }[] = [];

    for (const month of months) {
      const monthData = monthMap.get(month)!;

      // Which portfolio tickers have data this month?
      const covered: { ticker: string; weight: number; prediction: number; actual: number; dirCorrect: boolean }[] = [];
      for (const t of tickers) {
        const d = monthData.get(t);
        if (d) {
          covered.push({
            ticker: t,
            weight: weightMap[t],
            prediction: d.prediction,
            actual: d.actual,
            dirCorrect: d.directionCorrect,
          });
        }
      }

      if (covered.length === 0) continue;

      // Strategy 1: Static weights (re-normalize for covered tickers)
      const coveredWeightSum = covered.reduce((s, c) => s + c.weight, 0);
      const staticReturn = covered.reduce((s, c) => s + (c.weight / coveredWeightSum) * c.actual, 0);

      // Strategy 2: ML-Tilted (adjust weights by prediction signal)
      // Tilt = weight * (1 + k * prediction), then normalize
      const k = 5; // tilt strength (5x the prediction percentage)
      const tiltedRaw = covered.map(c => ({
        ...c,
        tiltedWeight: Math.max(0.01, c.weight * (1 + k * c.prediction)),
      }));
      const tiltedSum = tiltedRaw.reduce((s, c) => s + c.tiltedWeight, 0);
      const mlTiltedReturn = tiltedRaw.reduce((s, c) => s + (c.tiltedWeight / tiltedSum) * c.actual, 0);

      // Strategy 3: ML Long-Only (exclude negative predictions)
      const longOnly = covered.filter(c => c.prediction >= 0);
      let mlLongOnlyReturn = 0;
      if (longOnly.length > 0) {
        const loSum = longOnly.reduce((s, c) => s + c.weight, 0);
        mlLongOnlyReturn = longOnly.reduce((s, c) => s + (c.weight / loSum) * c.actual, 0);
      } else {
        // All negative — stay in cash (0% return)
        mlLongOnlyReturn = 0;
      }

      // OBX return
      const obxRet = obxReturns.get(month) ?? 0;

      // Accumulate
      cumStatic *= (1 + staticReturn);
      cumMlTilted *= (1 + mlTiltedReturn);
      cumMlLongOnly *= (1 + mlLongOnlyReturn);
      cumObx *= (1 + obxRet);

      const avgPred = covered.reduce((s, c) => s + c.prediction, 0) / covered.length;
      const avgAct = covered.reduce((s, c) => s + c.actual, 0) / covered.length;
      const hitRate = covered.filter(c => c.dirCorrect).length / covered.length;

      monthlyResults.push({
        month,
        staticReturn,
        mlTiltedReturn,
        mlLongOnlyReturn,
        obxReturn: obxRet,
        tickersCovered: covered.length,
        tickersTotal: tickers.length,
        avgPrediction: avgPred,
        avgActual: avgAct,
        hitRate,
      });

      cumulativeSeries.push({
        month,
        static: (cumStatic - 1) * 100,
        mlTilted: (cumMlTilted - 1) * 100,
        mlLongOnly: (cumMlLongOnly - 1) * 100,
        obx: (cumObx - 1) * 100,
      });
    }

    // Per-ticker accuracy
    const tickerAccuracy: {
      ticker: string;
      weight: number;
      nPredictions: number;
      hitRate: number;
      mae: number;
      avgPrediction: number;
      avgActual: number;
      bestMonth: number;
      worstMonth: number;
    }[] = [];

    for (let i = 0; i < tickers.length; i++) {
      const t = tickers[i];
      const preds: { prediction: number; actual: number; dirCorrect: boolean }[] = [];
      for (const [, monthData] of monthMap) {
        const d = monthData.get(t);
        if (d) preds.push({ prediction: d.prediction, actual: d.actual, dirCorrect: d.directionCorrect });
      }
      if (preds.length === 0) continue;

      const hr = preds.filter(p => p.dirCorrect).length / preds.length;
      const mae = preds.reduce((s, p) => s + Math.abs(p.prediction - p.actual), 0) / preds.length;
      const avgP = preds.reduce((s, p) => s + p.prediction, 0) / preds.length;
      const avgA = preds.reduce((s, p) => s + p.actual, 0) / preds.length;
      const actuals = preds.map(p => p.actual);

      tickerAccuracy.push({
        ticker: t,
        weight: normWeights[i],
        nPredictions: preds.length,
        hitRate: hr,
        mae,
        avgPrediction: avgP,
        avgActual: avgA,
        bestMonth: Math.max(...actuals),
        worstMonth: Math.min(...actuals),
      });
    }

    // Aggregate strategy stats
    const nMonths = monthlyResults.length;
    const computeStats = (returns: number[]) => {
      const total = returns.reduce((p, r) => p * (1 + r), 1) - 1;
      const annualized = nMonths > 0 ? Math.pow(1 + total, 12 / nMonths) - 1 : 0;
      const mean = returns.reduce((s, r) => s + r, 0) / (returns.length || 1);
      const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length || 1);
      const vol = Math.sqrt(variance) * Math.sqrt(12); // annualized
      const sharpe = vol > 0 ? (annualized - 0.045) / vol : 0;
      // Max drawdown
      let peak = 1;
      let maxDD = 0;
      let cum = 1;
      for (const r of returns) {
        cum *= (1 + r);
        if (cum > peak) peak = cum;
        const dd = (peak - cum) / peak;
        if (dd > maxDD) maxDD = dd;
      }
      // Win rate
      const winRate = returns.filter(r => r > 0).length / (returns.length || 1);
      return { totalReturn: total, annualizedReturn: annualized, volatility: vol, sharpe, maxDrawdown: maxDD, winRate };
    };

    const strategyStats = {
      static: computeStats(monthlyResults.map(m => m.staticReturn)),
      mlTilted: computeStats(monthlyResults.map(m => m.mlTiltedReturn)),
      mlLongOnly: computeStats(monthlyResults.map(m => m.mlLongOnlyReturn)),
      obx: computeStats(monthlyResults.map(m => m.obxReturn)),
    };

    // Overall portfolio prediction accuracy
    const allHitRates = monthlyResults.map(m => m.hitRate);
    const overallHitRate = allHitRates.reduce((s, h) => s + h, 0) / (allHitRates.length || 1);

    return NextResponse.json({
      run: {
        id: run.id,
        modelVersion: run.model_version,
        nMonths: parseInt(run.n_months),
        backtestStart: run.backtest_start,
        backtestEnd: run.backtest_end,
        createdAt: run.created_at,
      },
      nMonths,
      nTickers: tickers.length,
      tickersCovered: tickerAccuracy.length,
      overallHitRate,
      strategyStats,
      cumulativeSeries,
      monthlyResults,
      tickerAccuracy: tickerAccuracy.sort((a, b) => b.weight - a.weight),
    });
  } catch (error: unknown) {
    console.error("Portfolio backtest error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backtest failed" },
      { status: 500 }
    );
  }
}
