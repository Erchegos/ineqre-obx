/**
 * FX Sensitivity API
 * GET /api/fx/sensitivity/EQNR
 *
 * Combined statistical + fundamental sensitivity for a stock.
 * Statistical: multi-currency regression betas from fx_regression_results
 * Fundamental: revenue/cost exposure from fx_fundamental_exposure
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

    // Statistical: latest regression result
    const latestResult = await pool.query<{
      window_end: string;
      window_days: string;
      beta_market: string;
      tstat_market: string;
      beta_usd: string;
      tstat_usd: string;
      beta_eur: string;
      tstat_eur: string;
      beta_gbp: string;
      tstat_gbp: string;
      beta_sek: string;
      tstat_sek: string;
      r_squared: string;
      r_squared_fx_only: string;
      residual_vol: string;
      observations: string;
    }>(
      `SELECT window_end::text, window_days, beta_market, tstat_market,
              beta_usd, tstat_usd, beta_eur, tstat_eur,
              beta_gbp, tstat_gbp, beta_sek, tstat_sek,
              r_squared, r_squared_fx_only, residual_vol, observations
       FROM fx_regression_results
       WHERE ticker = $1
       ORDER BY window_end DESC
       LIMIT 1`,
      [t]
    );

    const statistical = latestResult.rows.length > 0
      ? {
          windowEnd: latestResult.rows[0].window_end,
          windowDays: parseInt(latestResult.rows[0].window_days),
          betaMarket: parseFloat(latestResult.rows[0].beta_market),
          tstatMarket: parseFloat(latestResult.rows[0].tstat_market),
          betaUsd: parseFloat(latestResult.rows[0].beta_usd),
          tstatUsd: parseFloat(latestResult.rows[0].tstat_usd),
          betaEur: parseFloat(latestResult.rows[0].beta_eur),
          tstatEur: parseFloat(latestResult.rows[0].tstat_eur),
          betaGbp: parseFloat(latestResult.rows[0].beta_gbp),
          tstatGbp: parseFloat(latestResult.rows[0].tstat_gbp),
          betaSek: parseFloat(latestResult.rows[0].beta_sek),
          tstatSek: parseFloat(latestResult.rows[0].tstat_sek),
          rSquared: parseFloat(latestResult.rows[0].r_squared),
          rSquaredFxOnly: parseFloat(latestResult.rows[0].r_squared_fx_only),
          residualVol: parseFloat(latestResult.rows[0].residual_vol),
          observations: parseInt(latestResult.rows[0].observations),
        }
      : null;

    // Rolling history (last 2Y of windows for charts)
    const rollingResult = await pool.query<{
      window_end: string;
      beta_usd: string;
      beta_eur: string;
      beta_gbp: string;
      beta_sek: string;
      r_squared: string;
    }>(
      `SELECT window_end::text, beta_usd, beta_eur, beta_gbp, beta_sek, r_squared
       FROM fx_regression_results
       WHERE ticker = $1
       ORDER BY window_end DESC
       LIMIT 100`,
      [t]
    );

    const rollingHistory = rollingResult.rows.reverse().map((r) => ({
      date: r.window_end,
      betaUsd: parseFloat(r.beta_usd),
      betaEur: parseFloat(r.beta_eur),
      betaGbp: parseFloat(r.beta_gbp),
      betaSek: parseFloat(r.beta_sek),
      rSquared: parseFloat(r.r_squared),
    }));

    // Fundamental exposure
    const fundResult = await pool.query<{
      fiscal_year: string;
      revenue_usd_pct: string;
      revenue_eur_pct: string;
      revenue_gbp_pct: string;
      revenue_nok_pct: string;
      revenue_sek_pct: string;
      revenue_other_pct: string;
      cost_usd_pct: string;
      cost_eur_pct: string;
      cost_gbp_pct: string;
      cost_nok_pct: string;
      cost_sek_pct: string;
      cost_other_pct: string;
      net_usd_pct: string;
      net_eur_pct: string;
      net_gbp_pct: string;
      net_sek_pct: string;
      ebitda_sensitivity_usd: string;
      ebitda_sensitivity_eur: string;
      ebitda_sensitivity_gbp: string;
      eps_sensitivity_usd: string;
      eps_sensitivity_eur: string;
      eps_sensitivity_gbp: string;
      source: string;
      notes: string;
    }>(
      `SELECT * FROM fx_fundamental_exposure
       WHERE ticker = $1
       ORDER BY fiscal_year DESC
       LIMIT 1`,
      [t]
    );

    const fundamental = fundResult.rows.length > 0
      ? {
          fiscalYear: parseInt(fundResult.rows[0].fiscal_year),
          revenue: {
            usd: parseFloat(fundResult.rows[0].revenue_usd_pct),
            eur: parseFloat(fundResult.rows[0].revenue_eur_pct),
            gbp: parseFloat(fundResult.rows[0].revenue_gbp_pct),
            nok: parseFloat(fundResult.rows[0].revenue_nok_pct),
            sek: parseFloat(fundResult.rows[0].revenue_sek_pct),
            other: parseFloat(fundResult.rows[0].revenue_other_pct),
          },
          cost: {
            usd: parseFloat(fundResult.rows[0].cost_usd_pct),
            eur: parseFloat(fundResult.rows[0].cost_eur_pct),
            gbp: parseFloat(fundResult.rows[0].cost_gbp_pct),
            nok: parseFloat(fundResult.rows[0].cost_nok_pct),
            sek: parseFloat(fundResult.rows[0].cost_sek_pct),
            other: parseFloat(fundResult.rows[0].cost_other_pct),
          },
          netExposure: {
            usd: parseFloat(fundResult.rows[0].net_usd_pct),
            eur: parseFloat(fundResult.rows[0].net_eur_pct),
            gbp: parseFloat(fundResult.rows[0].net_gbp_pct),
            sek: parseFloat(fundResult.rows[0].net_sek_pct),
          },
          sensitivity: {
            ebitdaUsd: parseFloat(fundResult.rows[0].ebitda_sensitivity_usd),
            ebitdaEur: parseFloat(fundResult.rows[0].ebitda_sensitivity_eur),
            ebitdaGbp: parseFloat(fundResult.rows[0].ebitda_sensitivity_gbp),
            epsUsd: parseFloat(fundResult.rows[0].eps_sensitivity_usd),
            epsEur: parseFloat(fundResult.rows[0].eps_sensitivity_eur),
            epsGbp: parseFloat(fundResult.rows[0].eps_sensitivity_gbp),
          },
          source: fundResult.rows[0].source,
          notes: fundResult.rows[0].notes,
        }
      : null;

    // Divergence check: compare regression betas vs fundamental net exposure
    // Only flag currencies with meaningful reported exposure (|net| >= 3%)
    let divergences: { currency: string; statistical: number; fundamental: number; difference: number; assessment: string }[] = [];
    if (statistical && fundamental) {
      const check = (ccy: string, beta: number, net: number) => {
        // Skip currencies with no meaningful reported exposure
        if (Math.abs(net) < 0.03) return null;
        const diff = beta - net;
        // Only flag if difference is material (>5pp)
        if (Math.abs(diff) < 0.05) return null;
        let assessment: string;
        if (Math.sign(beta) !== Math.sign(net)) {
          assessment = "Opposite direction — likely hedged or market sees different exposure";
        } else if (Math.abs(beta) > Math.abs(net) * 1.5) {
          assessment = "Market prices in more exposure than reported — may reflect supply chain or commodity links";
        } else if (Math.abs(beta) < Math.abs(net) * 0.5) {
          assessment = "Market prices in less than reported — company may be actively hedging";
        } else {
          assessment = "Moderate gap — within normal range for hedged companies";
        }
        return { currency: ccy, statistical: beta, fundamental: net, difference: diff, assessment };
      };
      const checks = [
        check("USD", statistical.betaUsd, fundamental.netExposure.usd),
        check("EUR", statistical.betaEur, fundamental.netExposure.eur),
        check("GBP", statistical.betaGbp, fundamental.netExposure.gbp),
        check("SEK", statistical.betaSek, fundamental.netExposure.sek),
      ];
      divergences = checks.filter((c): c is NonNullable<typeof c> => c !== null);
    }

    return NextResponse.json({
      ticker: t,
      statistical,
      rollingHistory,
      fundamental,
      divergences,
      hasDivergence: divergences.length > 0,
    });
  } catch (error: any) {
    console.error("[FX Sensitivity API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch FX sensitivity" },
      { status: 500 }
    );
  }
}
