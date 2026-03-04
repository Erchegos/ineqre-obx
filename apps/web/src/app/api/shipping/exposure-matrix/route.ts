/**
 * Shipping Exposure Matrix API
 * GET /api/shipping/exposure-matrix
 *
 * Returns company x vessel_class rate vs spot heatmap data.
 * For each company, compares their latest TCE per vessel class against market spot rates.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vessel class to market index mapping with adjustment factors
const VESSEL_CLASS_INDEX_MAP: Record<string, { index: string; factor: number } | null> = {
  VLCC: { index: "VLCC_TD3C_TCE", factor: 1.0 },
  Suezmax: { index: "SUEZMAX_TD20_TCE", factor: 1.0 },
  Aframax: { index: "AFRAMAX_TCE", factor: 1.0 },
  Capesize: { index: "CAPESIZE_5TC", factor: 1.0 },
  Newcastlemax: { index: "CAPESIZE_5TC", factor: 1.05 },
  Panamax: { index: "PANAMAX_TCE", factor: 1.0 },
  Supramax: { index: "ULTRAMAX_TCE", factor: 0.95 },
  Ultramax: { index: "ULTRAMAX_TCE", factor: 1.0 },
  LR2: { index: "LR2_TCE", factor: 1.0 },
  MR: { index: "MR_TC2_TCE", factor: 1.0 },
  Container: { index: "SCFI", factor: 1.0 },
  Chemical: { index: "MR_TC2_TCE", factor: 0.8 },
  LNG: { index: "LNG_SPOT_TFDE", factor: 1.0 },
  VLGC: { index: "VLGC_ME_ASIA", factor: 1.0 },
  PCTC: null,
};

export async function GET() {
  try {
    // Latest company rates per vessel class (most recent quarter)
    const companyResult = await pool.query(`
      SELECT DISTINCT ON (cr.ticker, cr.vessel_class)
        cr.ticker,
        sc.company_name,
        cr.vessel_class,
        cr.rate_usd_per_day::float AS company_rate,
        cr.quarter
      FROM shipping_company_rates cr
      JOIN shipping_companies sc ON sc.ticker = cr.ticker
      ORDER BY cr.ticker, cr.vessel_class, cr.quarter DESC
    `);

    // Latest market rates for all indices
    const marketResult = await pool.query(`
      SELECT DISTINCT ON (index_name)
        index_name, rate_value::float AS value
      FROM shipping_market_rates
      ORDER BY index_name, rate_date DESC
    `);

    const marketRates: Record<string, number> = {};
    for (const row of marketResult.rows) {
      marketRates[row.index_name] = row.value;
    }

    // Build matrix
    const matrix = companyResult.rows
      .map(row => {
        const vesselClass = row.vessel_class || "";
        const mapping = VESSEL_CLASS_INDEX_MAP[vesselClass] || null;
        let spotRate: number | null = null;
        let deltaPct: number | null = null;

        if (mapping && marketRates[mapping.index] != null) {
          spotRate = marketRates[mapping.index] * mapping.factor;
          if (row.company_rate && spotRate > 0) {
            deltaPct = ((row.company_rate - spotRate) / spotRate) * 100;
          }
        }

        return {
          ticker: row.ticker,
          company_name: row.company_name,
          vessel_class: row.vessel_class,
          company_rate: row.company_rate,
          quarter: row.quarter,
          spot_rate: spotRate ? Math.round(spotRate) : null,
          delta_pct: deltaPct != null ? Math.round(deltaPct * 10) / 10 : null,
          index_name: mapping?.index || null,
        };
      })
      .filter(row => row.company_rate != null);

    return NextResponse.json({ matrix });
  } catch (err) {
    console.error("[shipping/exposure-matrix]", err);
    return NextResponse.json({ error: "Failed to fetch exposure matrix" }, { status: 500 });
  }
}
