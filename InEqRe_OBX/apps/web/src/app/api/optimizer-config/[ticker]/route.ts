import { NextRequest, NextResponse } from "next/server";
import { loadOptimizerConfig } from "@/lib/optimizerConfig";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker: rawTicker } = await params;
    const ticker = rawTicker.toUpperCase().trim();

    const config = loadOptimizerConfig(ticker);

    if (!config) {
      return NextResponse.json({ success: true, hasOptimized: false });
    }

    return NextResponse.json({
      success: true,
      hasOptimized: true,
      ticker: config.ticker,
      config: {
        factors: config.config.factors,
        gb_weight: config.config.gb_weight,
        rf_weight: config.config.rf_weight,
        n_factors: config.factor_changes.n_factors,
        optimization_method: config.optimization_method,
        optimized_at: config.optimized_at,
      },
      performance: config.performance,
      factor_changes: config.factor_changes,
    });
  } catch (error: any) {
    console.error("Optimizer config error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
