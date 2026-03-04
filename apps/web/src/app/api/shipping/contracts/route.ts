/**
 * Shipping Vessel Contracts API
 * GET /api/shipping/contracts?ticker=FRO
 *
 * Returns current vessel contracts with rate vs spot comparison.
 */

import { NextRequest, NextResponse } from "next/server";
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

export async function GET(request: NextRequest) {
  try {
    const ticker = request.nextUrl.searchParams.get("ticker");

    const params: string[] = [];
    let tickerFilter = "";
    if (ticker) {
      params.push(ticker.toUpperCase());
      tickerFilter = `AND v.company_ticker = $${params.length}`;
    }

    // Current contracts with vessel and company info
    const contractsResult = await pool.query(`
      SELECT
        vc.imo,
        vc.contract_type,
        vc.rate_usd_per_day::float,
        vc.rate_worldscale::float,
        vc.charterer,
        vc.contract_start,
        vc.contract_end,
        (vc.contract_end - CURRENT_DATE)::int AS days_remaining,
        v.vessel_name,
        v.vessel_type,
        v.vessel_class,
        v.dwt,
        v.company_ticker,
        sc.company_name,
        sc.sector,
        sc.color_hex
      FROM shipping_vessel_contracts vc
      JOIN shipping_vessels v ON v.imo = vc.imo
      JOIN shipping_companies sc ON sc.ticker = v.company_ticker
      WHERE vc.is_current = true
        ${tickerFilter}
      ORDER BY sc.company_name ASC, v.vessel_name ASC
    `, params);

    // Get latest market rates for all relevant indices
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

    // Enrich contracts with rate vs spot
    const contracts = contractsResult.rows.map(row => {
      const vesselClass = row.vessel_class || "";
      const mapping = VESSEL_CLASS_INDEX_MAP[vesselClass] || null;
      let spotRate: number | null = null;
      let rateVsSpot: number | null = null;

      if (mapping && marketRates[mapping.index] != null) {
        spotRate = marketRates[mapping.index] * mapping.factor;
        if (row.rate_usd_per_day && spotRate > 0) {
          rateVsSpot = ((row.rate_usd_per_day - spotRate) / spotRate) * 100;
        }
      }

      return {
        imo: row.imo,
        vessel_name: row.vessel_name,
        vessel_type: row.vessel_type,
        vessel_class: row.vessel_class,
        dwt: row.dwt,
        company_ticker: row.company_ticker,
        company_name: row.company_name,
        sector: row.sector,
        color_hex: row.color_hex,
        contract_type: row.contract_type,
        rate_usd_per_day: row.rate_usd_per_day,
        rate_worldscale: row.rate_worldscale,
        charterer: row.charterer,
        contract_start: row.contract_start,
        contract_end: row.contract_end,
        days_remaining: row.days_remaining,
        spot_rate: spotRate ? Math.round(spotRate) : null,
        rate_vs_spot_pct: rateVsSpot != null ? Math.round(rateVsSpot * 10) / 10 : null,
      };
    });

    return NextResponse.json({ contracts });
  } catch (err) {
    console.error("[shipping/contracts]", err);
    return NextResponse.json({ error: "Failed to fetch contracts" }, { status: 500 });
  }
}
