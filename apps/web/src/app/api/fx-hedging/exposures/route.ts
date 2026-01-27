/**
 * FX Hedging API - Stock Exposures Endpoint
 * GET /api/fx-hedging/exposures
 *
 * Returns currency revenue breakdown for all stocks
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get("ticker");

    let query: string;
    let params: any[];

    if (ticker) {
      // Get specific ticker exposure
      query = `
        SELECT
          ticker,
          usd_revenue_pct,
          eur_revenue_pct,
          gbp_revenue_pct,
          nok_revenue_pct,
          other_revenue_pct,
          last_updated,
          source,
          notes
        FROM stock_fx_exposure
        WHERE UPPER(ticker) = UPPER($1)
      `;
      params = [ticker];
    } else {
      // Get all exposures
      query = `
        SELECT
          sfe.ticker,
          s.name,
          s.sector,
          sfe.usd_revenue_pct,
          sfe.eur_revenue_pct,
          sfe.gbp_revenue_pct,
          sfe.nok_revenue_pct,
          sfe.other_revenue_pct,
          sfe.last_updated,
          sfe.source
        FROM stock_fx_exposure sfe
        LEFT JOIN stocks s ON s.ticker = sfe.ticker
        WHERE s.is_active = true
        ORDER BY
          -- Sort by USD exposure (highest first)
          sfe.usd_revenue_pct DESC NULLS LAST
      `;
      params = [];
    }

    const result = await pool.query(query, params);

    if (ticker && result.rows.length === 0) {
      return NextResponse.json(
        { error: "Ticker not found or no FX exposure data available" },
        { status: 404 }
      );
    }

    // Transform to percentages for display
    const exposures = result.rows.map((row) => ({
      ticker: row.ticker,
      name: row.name,
      sector: row.sector,
      exposure: {
        USD: row.usd_revenue_pct ? Number(row.usd_revenue_pct) * 100 : 0,
        EUR: row.eur_revenue_pct ? Number(row.eur_revenue_pct) * 100 : 0,
        GBP: row.gbp_revenue_pct ? Number(row.gbp_revenue_pct) * 100 : 0,
        NOK: row.nok_revenue_pct ? Number(row.nok_revenue_pct) * 100 : 0,
        OTHER: row.other_revenue_pct ? Number(row.other_revenue_pct) * 100 : 0,
      },
      lastUpdated: row.last_updated,
      source: row.source,
      notes: row.notes,
    }));

    return NextResponse.json({
      count: exposures.length,
      data: ticker ? exposures[0] : exposures,
    });
  } catch (error: any) {
    console.error("[FX Exposures API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch FX exposures" },
      { status: 500 }
    );
  }
}
