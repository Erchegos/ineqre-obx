import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (ticker)
        ticker, ts, vpin_50::float, vpin_percentile::float,
        kyle_lambda_60m::float, ofi_cumulative::float, ofi_5m::float,
        toxicity_score::float, regime, spread_regime
      FROM orderflow_signals
      ORDER BY ticker, ts DESC
    `);

    return NextResponse.json(
      rows.map((s: any) => ({
        ticker: s.ticker,
        ts: s.ts,
        vpin: s.vpin_50,
        vpinPercentile: s.vpin_percentile,
        kyleLambda: s.kyle_lambda_60m,
        ofiCumulative: s.ofi_cumulative,
        ofi5m: s.ofi_5m,
        toxicity: s.toxicity_score,
        regime: s.regime,
        spreadRegime: s.spread_regime,
      }))
    );
  } catch (e: any) {
    console.error("[flow/signals/all] Error:", e);
    return NextResponse.json(
      { error: "Signals fetch failed", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
