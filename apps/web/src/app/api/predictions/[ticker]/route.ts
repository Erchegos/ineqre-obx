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

    const query = `
      SELECT
        ticker,
        prediction_date,
        target_date,
        ensemble_prediction,
        gb_prediction,
        rf_prediction,
        p05, p25, p50, p75, p95,
        feature_importance,
        confidence_score,
        model_version,
        created_at
      FROM ml_predictions
      WHERE ticker = $1
        AND model_version = 'v2.0_19factor_enhanced'
      ORDER BY prediction_date DESC
      LIMIT 10
    `;

    const result = await pool.query(query, [ticker]);

    // Transform to match component expectations
    const predictions = result.rows.map((row) => ({
      ticker: row.ticker,
      prediction_date: row.prediction_date,
      target_date: row.target_date,
      ensemble_prediction: parseFloat(row.ensemble_prediction),
      gb_prediction: parseFloat(row.gb_prediction),
      rf_prediction: parseFloat(row.rf_prediction),
      percentiles: {
        p05: parseFloat(row.p05),
        p25: parseFloat(row.p25),
        p50: parseFloat(row.p50),
        p75: parseFloat(row.p75),
        p95: parseFloat(row.p95),
      },
      feature_importance: row.feature_importance || {},
      confidence_score: parseFloat(row.confidence_score || "0"),
      created_at: row.created_at,
    }));

    return NextResponse.json({
      success: true,
      ticker,
      count: predictions.length,
      predictions,
    });
  } catch (error: any) {
    console.error("Predictions fetch error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
