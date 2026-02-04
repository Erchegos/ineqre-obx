import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runResult = await pool.query(`
      SELECT
        id, model_version, n_months, n_total_predictions,
        overall_hit_rate, overall_mae,
        overall_ic_mean, overall_ic_ir,
        long_short_total_return, long_short_annualized,
        long_short_sharpe, long_short_max_drawdown,
        p90_calibration,
        metrics_by_size_regime,
        config,
        created_at
      FROM backtest_runs
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (runResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "No backtest runs found" },
        { status: 404 }
      );
    }

    const run = runResult.rows[0];

    const monthlyResult = await pool.query(
      `SELECT
        month, n_tickers, hit_rate, mae, ic,
        long_return, short_return, long_short_return,
        p90_calibration
      FROM backtest_monthly
      WHERE backtest_run_id = $1
      ORDER BY month ASC`,
      [run.id]
    );

    const transformedRun = {
      id: run.id,
      model_version: run.model_version,
      n_months: parseInt(run.n_months),
      n_total_predictions: parseInt(run.n_total_predictions),
      overall_hit_rate: parseFloat(run.overall_hit_rate),
      overall_mae: parseFloat(run.overall_mae),
      overall_ic_mean: parseFloat(run.overall_ic_mean),
      overall_ic_ir: parseFloat(run.overall_ic_ir),
      long_short_total_return: parseFloat(run.long_short_total_return),
      long_short_annualized: parseFloat(run.long_short_annualized),
      long_short_sharpe: parseFloat(run.long_short_sharpe),
      long_short_max_drawdown: parseFloat(run.long_short_max_drawdown),
      p90_calibration: parseFloat(run.p90_calibration),
      metrics_by_size_regime: run.metrics_by_size_regime,
      config: run.config,
      created_at: run.created_at,
    };

    const transformedMonthly = monthlyResult.rows.map((row: any) => ({
      month: row.month,
      n_tickers: parseInt(row.n_tickers),
      hit_rate: parseFloat(row.hit_rate),
      mae: parseFloat(row.mae),
      ic: parseFloat(row.ic),
      long_return: parseFloat(row.long_return),
      short_return: parseFloat(row.short_return),
      long_short_return: parseFloat(row.long_short_return),
      p90_calibration: parseFloat(row.p90_calibration),
    }));

    return NextResponse.json({
      success: true,
      run: transformedRun,
      monthly: transformedMonthly,
    });
  } catch (error: any) {
    console.error("Backtest fetch error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
