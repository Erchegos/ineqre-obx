import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker: rawTicker } = await params;
    const ticker = rawTicker.toUpperCase().trim();

    // Get model_type from query params (default or optimized)
    const { searchParams } = new URL(req.url);
    const modelType = searchParams.get("model_type") || "default";

    // Get latest backtest run
    const runResult = await pool.query(
      `SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1`
    );
    if (runResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "No backtest runs found" },
        { status: 404 }
      );
    }
    const runId = runResult.rows[0].id;

    // Get all predictions for this ticker with specified model_type
    const predResult = await pool.query(
      `SELECT
        prediction_date, target_date,
        ensemble_prediction, gb_prediction, rf_prediction,
        actual_return, p05, p25, p50, p75, p95,
        confidence_score, size_regime, turnover_regime,
        quintile, direction_correct
      FROM backtest_predictions
      WHERE ticker = $1 AND backtest_run_id = $2 AND model_type = $3
      ORDER BY prediction_date ASC`,
      [ticker, runId, modelType]
    );

    if (predResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: `No backtest data for ${ticker}` },
        { status: 404 }
      );
    }

    const predictions = predResult.rows.map((r: any) => ({
      prediction_date: r.prediction_date,
      target_date: r.target_date,
      ensemble_prediction: parseFloat(r.ensemble_prediction),
      gb_prediction: parseFloat(r.gb_prediction),
      rf_prediction: parseFloat(r.rf_prediction),
      actual_return: r.actual_return != null ? parseFloat(r.actual_return) : null,
      p05: parseFloat(r.p05),
      p25: parseFloat(r.p25),
      p50: parseFloat(r.p50),
      p75: parseFloat(r.p75),
      p95: parseFloat(r.p95),
      confidence_score: parseFloat(r.confidence_score),
      size_regime: r.size_regime,
      turnover_regime: r.turnover_regime,
      quintile: parseInt(r.quintile),
      direction_correct: r.direction_correct,
    }));

    // Compute summary
    const withActual = predictions.filter(
      (p: any) => p.actual_return !== null
    );
    const dirChecks = withActual.filter(
      (p: any) => p.ensemble_prediction !== 0 && p.actual_return !== 0
    );

    const hitRate =
      dirChecks.length > 0
        ? dirChecks.filter((p: any) => p.direction_correct).length /
          dirChecks.length
        : 0;

    const mae =
      withActual.length > 0
        ? withActual.reduce(
            (sum: number, p: any) =>
              sum + Math.abs(p.ensemble_prediction - p.actual_return),
            0
          ) / withActual.length
        : 0;

    const avgQuintile =
      withActual.length > 0
        ? withActual.reduce((sum: number, p: any) => sum + p.quintile, 0) /
          withActual.length
        : 0;

    const avgConfidence =
      predictions.length > 0
        ? predictions.reduce(
            (sum: number, p: any) => sum + p.confidence_score,
            0
          ) / predictions.length
        : 0;

    return NextResponse.json({
      success: true,
      ticker,
      summary: {
        n_predictions: withActual.length,
        n_total: predictions.length,
        hit_rate: hitRate,
        mae,
        avg_quintile: avgQuintile,
        avg_confidence: avgConfidence,
        size_regime: predictions[predictions.length - 1]?.size_regime || "",
      },
      predictions,
    });
  } catch (error: any) {
    console.error("Per-ticker backtest error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
