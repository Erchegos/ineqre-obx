/**
 * FX Portfolio Risk API
 * POST /api/fx/portfolio
 * Body: { tickers: string[], weights: number[] }
 *
 * Weighted average FX exposure, portfolio FX VaR, per-stock FX risk contribution,
 * currency contribution breakdown, stress scenarios.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { portfolioFxVaR } from "@/lib/fxTerminal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { tickers, weights } = body as { tickers: string[]; weights: number[] };

    if (!tickers || !weights || tickers.length !== weights.length || tickers.length === 0) {
      return NextResponse.json({ error: "tickers and weights arrays required, same length" }, { status: 400 });
    }

    const normalizedTickers = tickers.map((t: string) => t.toUpperCase());

    // Fetch regression betas for each ticker
    const betaResult = await pool.query<{
      ticker: string;
      beta_usd: string;
      beta_eur: string;
      beta_gbp: string;
      beta_sek: string;
    }>(
      `SELECT DISTINCT ON (ticker) ticker, beta_usd, beta_eur, beta_gbp, beta_sek
       FROM fx_regression_results
       WHERE ticker = ANY($1)
       ORDER BY ticker, window_end DESC`,
      [normalizedTickers]
    );

    const betaMap: Record<string, { usd: number; eur: number; gbp: number; sek: number }> = {};
    for (const row of betaResult.rows) {
      betaMap[row.ticker] = {
        usd: parseFloat(row.beta_usd),
        eur: parseFloat(row.beta_eur),
        gbp: parseFloat(row.beta_gbp),
        sek: parseFloat(row.beta_sek),
      };
    }

    // Fetch fundamental exposure for weighted average
    const expResult = await pool.query<{
      ticker: string;
      net_usd_pct: string;
      net_eur_pct: string;
      net_gbp_pct: string;
      net_sek_pct: string;
    }>(
      `SELECT DISTINCT ON (ticker) ticker, net_usd_pct, net_eur_pct, net_gbp_pct, net_sek_pct
       FROM fx_fundamental_exposure
       WHERE ticker = ANY($1)
       ORDER BY ticker, fiscal_year DESC`,
      [normalizedTickers]
    );

    const expMap: Record<string, { usd: number; eur: number; gbp: number; sek: number }> = {};
    for (const row of expResult.rows) {
      expMap[row.ticker] = {
        usd: parseFloat(row.net_usd_pct),
        eur: parseFloat(row.net_eur_pct),
        gbp: parseFloat(row.net_gbp_pct),
        sek: parseFloat(row.net_sek_pct),
      };
    }

    // Fetch FX vols (63D realized) — deduplicate sources
    const volResult = await pool.query<{ currency_pair: string; spot_rate: string }>(
      `SELECT currency_pair, spot_rate FROM (
         SELECT DISTINCT ON (currency_pair, date) currency_pair, date, spot_rate
         FROM fx_spot_rates
         WHERE currency_pair IN ('NOKUSD','NOKEUR','NOKGBP','NOKSEK')
           AND spot_rate > 0
         ORDER BY currency_pair, date DESC,
           CASE WHEN source = 'norgesbank' THEN 0 ELSE 1 END
       ) sub
       ORDER BY date DESC
       LIMIT 260`
    );

    // Compute realized vols per pair
    const volByPair: Record<string, number[]> = {};
    for (const row of volResult.rows) {
      if (!volByPair[row.currency_pair]) volByPair[row.currency_pair] = [];
      volByPair[row.currency_pair].push(parseFloat(row.spot_rate));
    }

    const calcAnnualVol = (prices: number[]) => {
      if (prices.length < 10) return 0.10;
      const rets: number[] = [];
      for (let i = 1; i < Math.min(prices.length, 64); i++) {
        if (prices[i - 1] > 0 && prices[i] > 0) {
          rets.push(Math.log(prices[i - 1] / prices[i])); // reversed because DESC
        }
      }
      if (rets.length < 5) return 0.10;
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
      return Math.sqrt(variance * 252);
    };

    const fxVols = {
      usd: calcAnnualVol(volByPair["NOKUSD"] || []),
      eur: calcAnnualVol(volByPair["NOKEUR"] || []),
      gbp: calcAnnualVol(volByPair["NOKGBP"] || []),
      sek: calcAnnualVol(volByPair["NOKSEK"] || []),
    };

    // Simple correlation assumption (or could compute from data)
    const fxCorrelations = [
      [1.0, 0.7, 0.6, 0.5],
      [0.7, 1.0, 0.8, 0.7],
      [0.6, 0.8, 1.0, 0.6],
      [0.5, 0.7, 0.6, 1.0],
    ];

    // Build beta arrays aligned to portfolio tickers
    const fxBetas = {
      usd: normalizedTickers.map((t: string) => betaMap[t]?.usd ?? 0),
      eur: normalizedTickers.map((t: string) => betaMap[t]?.eur ?? 0),
      gbp: normalizedTickers.map((t: string) => betaMap[t]?.gbp ?? 0),
      sek: normalizedTickers.map((t: string) => betaMap[t]?.sek ?? 0),
    };

    // Portfolio FX VaR
    const varResult = portfolioFxVaR(weights, fxBetas, fxVols, fxCorrelations);

    // Weighted average fundamental exposure
    const weightedExposure = { usd: 0, eur: 0, gbp: 0, sek: 0 };
    for (let i = 0; i < normalizedTickers.length; i++) {
      const exp = expMap[normalizedTickers[i]];
      if (exp) {
        weightedExposure.usd += weights[i] * exp.usd;
        weightedExposure.eur += weights[i] * exp.eur;
        weightedExposure.gbp += weights[i] * exp.gbp;
        weightedExposure.sek += weights[i] * exp.sek;
      }
    }

    // Per-stock FX risk contribution
    const perStock = normalizedTickers.map((t: string, i: number) => {
      const beta = betaMap[t];
      const exp = expMap[t];
      const totalBetaAbs = beta
        ? Math.abs(beta.usd) + Math.abs(beta.eur) + Math.abs(beta.gbp) + Math.abs(beta.sek)
        : 0;
      return {
        ticker: t,
        weight: weights[i],
        fxBetaTotal: totalBetaAbs,
        riskContribution: weights[i] * totalBetaAbs,
        hasBeta: !!beta,
        hasExposure: !!exp,
        betas: beta || { usd: 0, eur: 0, gbp: 0, sek: 0 },
        fundamentalExposure: exp || { usd: 0, eur: 0, gbp: 0, sek: 0 },
      };
    });

    // Stress scenarios — multiply exposure (decimal) by scenario move (decimal)
    // e.g. 55% net USD exposure * 5% NOK weakening = 2.75% earnings impact
    const stressScenarios = [
      { scenario: "NOK weakens 5%", usdImpact: weightedExposure.usd * 0.05, eurImpact: weightedExposure.eur * 0.05, totalImpact: (weightedExposure.usd + weightedExposure.eur + weightedExposure.gbp + weightedExposure.sek) * 0.05 },
      { scenario: "NOK weakens 10%", usdImpact: weightedExposure.usd * 0.10, eurImpact: weightedExposure.eur * 0.10, totalImpact: (weightedExposure.usd + weightedExposure.eur + weightedExposure.gbp + weightedExposure.sek) * 0.10 },
      { scenario: "NOK strengthens 5%", usdImpact: weightedExposure.usd * -0.05, eurImpact: weightedExposure.eur * -0.05, totalImpact: (weightedExposure.usd + weightedExposure.eur + weightedExposure.gbp + weightedExposure.sek) * -0.05 },
      { scenario: "Oil crash (USD +15%)", usdImpact: weightedExposure.usd * 0.15, eurImpact: weightedExposure.eur * 0.05, totalImpact: weightedExposure.usd * 0.15 + weightedExposure.eur * 0.05 },
    ];

    return NextResponse.json({
      portfolio: {
        tickers: normalizedTickers,
        weights,
      },
      weightedExposure,
      fxVaR: varResult,
      fxVols: { usd: fxVols.usd * 100, eur: fxVols.eur * 100, gbp: fxVols.gbp * 100, sek: fxVols.sek * 100 },
      perStock,
      stressScenarios,
    });
  } catch (error: any) {
    console.error("[FX Portfolio API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to compute portfolio FX risk" },
      { status: 500 }
    );
  }
}
