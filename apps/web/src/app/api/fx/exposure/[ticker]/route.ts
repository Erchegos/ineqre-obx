/**
 * FX Exposure API
 * GET /api/fx/exposure/EQNR
 *
 * Revenue/cost breakdown from fx_fundamental_exposure + simple revenue from stock_fx_exposure.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const t = ticker.toUpperCase();

    if (!/^[A-Z0-9]{1,10}$/.test(t)) {
      return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
    }

    // Detailed exposure from fx_fundamental_exposure
    const detailResult = await pool.query(
      `SELECT ticker, fiscal_year,
              revenue_usd_pct, revenue_eur_pct, revenue_gbp_pct, revenue_nok_pct, revenue_sek_pct, revenue_other_pct,
              cost_usd_pct, cost_eur_pct, cost_gbp_pct, cost_nok_pct, cost_sek_pct, cost_other_pct,
              net_usd_pct, net_eur_pct, net_gbp_pct, net_sek_pct,
              ebitda_sensitivity_usd, ebitda_sensitivity_eur, ebitda_sensitivity_gbp,
              eps_sensitivity_usd, eps_sensitivity_eur, eps_sensitivity_gbp,
              source, notes
       FROM fx_fundamental_exposure
       WHERE ticker = $1
       ORDER BY fiscal_year DESC
       LIMIT 3`,
      [t]
    );

    // Simple exposure from stock_fx_exposure
    const simpleResult = await pool.query(
      `SELECT ticker, usd_revenue_pct, eur_revenue_pct, gbp_revenue_pct, nok_revenue_pct
       FROM stock_fx_exposure
       WHERE ticker = $1
       LIMIT 1`,
      [t]
    );

    const detailed = detailResult.rows.map((r: any) => ({
      fiscalYear: parseInt(r.fiscal_year),
      revenue: {
        usd: parseFloat(r.revenue_usd_pct),
        eur: parseFloat(r.revenue_eur_pct),
        gbp: parseFloat(r.revenue_gbp_pct),
        nok: parseFloat(r.revenue_nok_pct),
        sek: parseFloat(r.revenue_sek_pct),
        other: parseFloat(r.revenue_other_pct),
      },
      cost: {
        usd: parseFloat(r.cost_usd_pct),
        eur: parseFloat(r.cost_eur_pct),
        gbp: parseFloat(r.cost_gbp_pct),
        nok: parseFloat(r.cost_nok_pct),
        sek: parseFloat(r.cost_sek_pct),
        other: parseFloat(r.cost_other_pct),
      },
      netExposure: {
        usd: parseFloat(r.net_usd_pct),
        eur: parseFloat(r.net_eur_pct),
        gbp: parseFloat(r.net_gbp_pct),
        sek: parseFloat(r.net_sek_pct),
      },
      sensitivity: {
        ebitdaUsd: parseFloat(r.ebitda_sensitivity_usd),
        ebitdaEur: parseFloat(r.ebitda_sensitivity_eur),
        ebitdaGbp: parseFloat(r.ebitda_sensitivity_gbp),
        epsUsd: parseFloat(r.eps_sensitivity_usd),
        epsEur: parseFloat(r.eps_sensitivity_eur),
        epsGbp: parseFloat(r.eps_sensitivity_gbp),
      },
      source: r.source,
      notes: r.notes,
    }));

    const simple = simpleResult.rows.length > 0
      ? {
          usd: parseFloat(simpleResult.rows[0].usd_revenue_pct),
          eur: parseFloat(simpleResult.rows[0].eur_revenue_pct),
          gbp: parseFloat(simpleResult.rows[0].gbp_revenue_pct),
          nok: parseFloat(simpleResult.rows[0].nok_revenue_pct),
        }
      : null;

    return NextResponse.json({
      ticker: t,
      detailed,
      simple,
      hasDetailedData: detailed.length > 0,
    });
  } catch (error: any) {
    console.error("[FX Exposure API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch FX exposure" },
      { status: 500 }
    );
  }
}
