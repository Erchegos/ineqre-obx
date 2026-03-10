/**
 * Fish Pool SISALMON Spot Prices API
 * GET /api/seafood/spot-prices?weeks=52&currency=NOK
 *
 * Returns weekly SISALMON index spot prices by weight class from Fish Pool/Euronext.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const weeks = parseInt(sp.get("weeks") || "52");
    const currency = (sp.get("currency") || "NOK").toUpperCase();

    // Time series
    const tsResult = await pool.query(
      `SELECT year, week, report_date, currency,
              sisalmon_avg::float, sisalmon_3_6kg::float,
              sisalmon_avg_1w_change::float, sisalmon_avg_4w_change::float, sisalmon_avg_12w_change::float,
              sisalmon_3_6kg_1w_change::float, sisalmon_3_6kg_4w_change::float, sisalmon_3_6kg_12w_change::float,
              price_1_2kg::float, price_2_3kg::float, price_3_4kg::float,
              price_4_5kg::float, price_5_6kg::float, price_6_7kg::float,
              price_7_8kg::float, price_8_9kg::float, price_9plus_kg::float,
              vol_1_2kg::float, vol_2_3kg::float, vol_3_4kg::float,
              vol_4_5kg::float, vol_5_6kg::float, vol_6_7kg::float,
              vol_7_8kg::float, vol_8_9kg::float, vol_9plus_kg::float,
              total_volume::float, avg_weight_kg::float
       FROM salmon_spot_weekly
       WHERE currency = $1
       ORDER BY year DESC, week DESC
       LIMIT $2`,
      [currency, weeks]
    );

    const rows = tsResult.rows.reverse(); // oldest first for charts

    // Latest row for summary
    const latest = tsResult.rows[0] || null;

    return NextResponse.json({
      spotPrices: rows,
      latest,
      currency,
      count: rows.length,
    });
  } catch (err) {
    console.error("[SPOT PRICES]", err);
    return NextResponse.json(
      { error: "Failed to fetch spot prices" },
      { status: 500 }
    );
  }
}
