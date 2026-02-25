import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Returns tickers that have COMPLETE factor data for ML predictions.
 * A ticker is "ML Ready" only if it has:
 *   1. 100+ rows in factor_technical
 *   2. Non-null beta and ivol in recent technical data
 *   3. Fundamentals data (bm, mktcap, nokvol) in factor_fundamentals
 */
export async function GET() {
  try {
    const result = await pool.query<{ ticker: string }>(`
      SELECT ft_agg.ticker
      FROM (
        SELECT ticker
        FROM factor_technical
        GROUP BY ticker
        HAVING COUNT(*) >= 100
      ) ft_agg
      -- Must have recent beta and ivol
      INNER JOIN LATERAL (
        SELECT 1
        FROM factor_technical ft2
        WHERE ft2.ticker = ft_agg.ticker
          AND ft2.beta IS NOT NULL
          AND ft2.ivol IS NOT NULL
        ORDER BY ft2.date DESC
        LIMIT 1
      ) beta_check ON true
      -- Must have fundamentals (bm, mktcap, nokvol)
      INNER JOIN LATERAL (
        SELECT 1
        FROM factor_fundamentals ff
        WHERE ff.ticker = ft_agg.ticker
          AND ff.bm IS NOT NULL
          AND ff.mktcap IS NOT NULL
          AND ff.nokvol IS NOT NULL
        ORDER BY ff.date DESC
        LIMIT 1
      ) fund_check ON true
      ORDER BY ft_agg.ticker
    `);

    const tickers = result.rows.map((row) => row.ticker);

    return NextResponse.json(
      {
        success: true,
        count: tickers.length,
        tickers,
      },
      {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
      }
    );
  } catch (error: any) {
    console.error("Error fetching factor tickers:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
