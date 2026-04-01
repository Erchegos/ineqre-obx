import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const t = ticker.toUpperCase();

  try {
    const { rows } = await pool.query(
      `SELECT ts, vpin_50::float, vpin_percentile::float,
              kyle_lambda_60m::float, ofi_cumulative::float, ofi_5m::float,
              toxicity_score::float, iceberg_probability::float,
              block_alert, block_est_size, block_est_direction,
              regime, spread_regime,
              intraday_forecast::float, forecast_confidence::float
       FROM orderflow_signals
       WHERE ticker = $1
       ORDER BY ts DESC
       LIMIT 1`,
      [t]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No signals found", ticker: t },
        { status: 404 }
      );
    }

    const s = rows[0];
    return NextResponse.json({
      ticker: t,
      ts: s.ts,
      vpin: s.vpin_50,
      vpinPercentile: s.vpin_percentile,
      kyleLambda: s.kyle_lambda_60m,
      ofiCumulative: s.ofi_cumulative,
      ofi5m: s.ofi_5m,
      toxicity: s.toxicity_score,
      icebergProbability: s.iceberg_probability,
      blockAlert: s.block_alert,
      blockEstSize: s.block_est_size,
      blockEstDirection: s.block_est_direction,
      regime: s.regime,
      spreadRegime: s.spread_regime,
      forecast: s.intraday_forecast,
      forecastConfidence: s.forecast_confidence,
    });
  } catch (e: any) {
    console.error("[flow/signals] Error:", e);
    return NextResponse.json(
      { error: "Signals fetch failed", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
