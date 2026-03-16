/**
 * FX Dashboard API
 * GET /api/fx/dashboard
 *
 * Returns: latest spot rates with changes, realized vol, NOK TWI,
 * regime data, cross-pair correlations, sparklines.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { nokTradeWeightedIndex } from "@/lib/fxTerminal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAIRS = ["NOKUSD", "NOKEUR", "NOKGBP", "NOKSEK", "NOKDKK"] as const;

export async function GET() {
  try {
    // Fetch 252 days of spot data for all pairs
    // Deduplicate: prefer 'norgesbank' source over legacy 'norges_bank' (which has wrong rate convention for some pairs)
    const spotResult = await pool.query<{
      currency_pair: string;
      date: string;
      spot_rate: string;
    }>(
      `SELECT currency_pair, date::text, spot_rate FROM (
         SELECT DISTINCT ON (currency_pair, date) currency_pair, date, spot_rate
         FROM fx_spot_rates
         WHERE currency_pair = ANY($1) AND spot_rate > 0
         ORDER BY currency_pair, date DESC,
           CASE WHEN source = 'norgesbank' THEN 0 ELSE 1 END
       ) sub
       ORDER BY date DESC
       LIMIT $2`,
      [[...PAIRS], PAIRS.length * 260]
    );

    // Group by pair, chronological
    const byPair: Record<string, { date: string; rate: number }[]> = {};
    for (const row of spotResult.rows) {
      if (!byPair[row.currency_pair]) byPair[row.currency_pair] = [];
      byPair[row.currency_pair].push({ date: row.date, rate: parseFloat(row.spot_rate) });
    }
    // Reverse to chronological
    for (const pair of Object.keys(byPair)) {
      byPair[pair].reverse();
    }

    // Build rate cards with changes and sparklines
    const rateCards = PAIRS.map((pair) => {
      const data = byPair[pair] || [];
      const latest = data[data.length - 1];
      if (!latest) return { pair, spot: null, change1d: null, change1w: null, change1m: null, changeYtd: null, vol20d: null, vol63d: null, sparkline: [] };

      const prev1d = data.length > 1 ? data[data.length - 2] : null;
      const prev1w = data.length > 5 ? data[data.length - 6] : null;
      const prev1m = data.length > 21 ? data[data.length - 22] : null;
      // YTD: find first date of current year
      const currentYear = latest.date.slice(0, 4);
      const ytdStart = data.find((d) => d.date.startsWith(currentYear));

      const pctChange = (cur: number, prev: number | undefined) =>
        prev && prev > 0 ? ((cur / prev - 1) * 100) : null;

      // Realized vol (20D, 63D)
      const calcVol = (window: number) => {
        if (data.length < window + 1) return null;
        const slice = data.slice(-window - 1);
        const rets: number[] = [];
        for (let i = 1; i < slice.length; i++) {
          if (slice[i].rate > 0 && slice[i - 1].rate > 0) {
            rets.push(Math.log(slice[i].rate / slice[i - 1].rate));
          }
        }
        if (rets.length < 5) return null;
        const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
        const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
        return Math.sqrt(variance * 252) * 100;
      };

      // Sparkline: last 90 data points
      const sparkline = data.slice(-90).map((d) => ({ date: d.date, rate: d.rate }));

      return {
        pair,
        spot: latest.rate,
        date: latest.date,
        change1d: pctChange(latest.rate, prev1d?.rate),
        change1w: pctChange(latest.rate, prev1w?.rate),
        change1m: pctChange(latest.rate, prev1m?.rate),
        changeYtd: pctChange(latest.rate, ytdStart?.rate),
        vol20d: calcVol(20),
        vol63d: calcVol(63),
        sparkline,
      };
    });

    // NOK Trade-Weighted Index (90D)
    let nokIndex: { date: string; index: number; change1d: number }[] = [];
    const usdData = byPair["NOKUSD"] || [];
    const eurData = byPair["NOKEUR"] || [];
    const gbpData = byPair["NOKGBP"] || [];
    const sekData = byPair["NOKSEK"] || [];
    const dkkData = byPair["NOKDKK"] || [];

    if (usdData.length > 0 && eurData.length > 0) {
      // Build date-aligned rates
      const dateMaps = {
        usd: new Map(usdData.map((d) => [d.date, d.rate])),
        eur: new Map(eurData.map((d) => [d.date, d.rate])),
        gbp: new Map(gbpData.map((d) => [d.date, d.rate])),
        sek: new Map(sekData.map((d) => [d.date, d.rate])),
        dkk: new Map(dkkData.map((d) => [d.date, d.rate])),
      };

      // Use USD dates as reference, take last 90
      const allDates = usdData.map((d) => d.date);
      const recentDates = allDates.slice(-90);
      const aligned: { date: string; usd: number; eur: number; gbp: number; sek: number; dkk: number }[] = [];
      for (const date of recentDates) {
        const usd = dateMaps.usd.get(date);
        const eur = dateMaps.eur.get(date);
        const gbp = dateMaps.gbp.get(date);
        const sek = dateMaps.sek.get(date);
        const dkk = dateMaps.dkk.get(date);
        if (usd && eur && gbp && sek && dkk) {
          aligned.push({ date, usd, eur, gbp, sek, dkk });
        }
      }

      nokIndex = nokTradeWeightedIndex(aligned);
    }

    // Cross-pair correlation matrix (63D returns) — includes NOK TWI
    const corrPairs = ["NOKUSD", "NOKEUR", "NOKGBP", "NOKSEK", "NOKDKK"] as const;
    const pairReturns: Record<string, number[]> = {};
    for (const p of corrPairs) {
      const data = byPair[p] || [];
      const last64 = data.slice(-64);
      const rets: number[] = [];
      for (let i = 1; i < last64.length; i++) {
        if (last64[i].rate > 0 && last64[i - 1].rate > 0) {
          rets.push(Math.log(last64[i].rate / last64[i - 1].rate));
        }
      }
      pairReturns[p] = rets;
    }

    // Compute NOK TWI returns for the correlation matrix
    if (nokIndex.length > 1) {
      const twiRets: number[] = [];
      const last64 = nokIndex.slice(-64);
      for (let i = 1; i < last64.length; i++) {
        if (last64[i].index > 0 && last64[i - 1].index > 0) {
          twiRets.push(Math.log(last64[i].index / last64[i - 1].index));
        }
      }
      pairReturns["NOK"] = twiRets;
    }

    const allCorrKeys = [...corrPairs, ...(pairReturns["NOK"] ? ["NOK"] as const : [])];
    const correlationMatrix: Record<string, Record<string, number>> = {};
    for (const p1 of allCorrKeys) {
      correlationMatrix[p1] = {};
      for (const p2 of allCorrKeys) {
        correlationMatrix[p1][p2] = correlation(pairReturns[p1] || [], pairReturns[p2] || []);
      }
    }

    // Fetch latest regime data (fx_market_regimes has a single NOK regime, not per-pair)
    const regimeResult = await pool.query<{
      regime: string;
      nok_regime: string;
      date: string;
    }>(
      `SELECT regime, nok_regime, date::text
       FROM fx_market_regimes
       ORDER BY date DESC
       LIMIT 1`
    );
    const regimes: Record<string, { regime: string; confidence: number }> = {};
    if (regimeResult.rows.length > 0) {
      const r = regimeResult.rows[0];
      regimes["NOK"] = { regime: r.nok_regime || r.regime || "Normal", confidence: 0.8 };
    }

    // OSE exposure heatmap: top 20 tickers by |net exposure|
    const exposureResult = await pool.query<{
      ticker: string;
      net_usd_pct: string;
      net_eur_pct: string;
      net_gbp_pct: string;
      net_sek_pct: string;
    }>(
      `SELECT DISTINCT ON (ticker) ticker, net_usd_pct, net_eur_pct, net_gbp_pct, net_sek_pct
       FROM fx_fundamental_exposure
       ORDER BY ticker, fiscal_year DESC`
    );
    const exposureHeatmap = exposureResult.rows.map((r) => ({
      ticker: r.ticker,
      usd: parseFloat(r.net_usd_pct),
      eur: parseFloat(r.net_eur_pct),
      gbp: parseFloat(r.net_gbp_pct),
      sek: parseFloat(r.net_sek_pct),
    }));

    // Funding regime: CB balance sheet / GDP classification
    // Rime, Schrimpf & Syrstad (RFS 2022) Table 4:
    //   Large CB balance sheets compress domestic funding spreads and widen the cross-currency basis.
    let fundingRegimes: object[] = [];
    try {
      const cbResult = await pool.query<{
        currency: string;
        cb_name: string;
        balance_sheet_pct_gdp: string;
        as_of_date: string;
      }>(
        `SELECT DISTINCT ON (currency) currency, cb_name, balance_sheet_pct_gdp, as_of_date::text
         FROM cb_balance_sheets
         ORDER BY currency, as_of_date DESC`
      );

      fundingRegimes = cbResult.rows.map((r) => {
        const pct = parseFloat(r.balance_sheet_pct_gdp);
        let regime: string;
        let color: string;
        let implication: string;
        if (pct > 80) {
          regime = "HIGHLY EXPANSIVE";
          color = "#10b981";
          implication = "Excess reserves compress local funding costs; strong synthetic USD swap demand";
        } else if (pct > 40) {
          regime = "EXPANSIVE";
          color = "#3b82f6";
          implication = "Funding costs moderately compressed; elevated FX swap activity";
        } else if (pct > 15) {
          regime = "NEUTRAL";
          color = "#9e9e9e";
          implication = "Normal funding conditions; standard swap demand";
        } else {
          regime = "TIGHT";
          color = "#ef4444";
          implication = "Funding expensive; low CB excess reserves; less swap demand";
        }
        return {
          currency: r.currency,
          cbName: r.cb_name,
          balanceSheetPctGdp: pct,
          asOfDate: r.as_of_date,
          regime,
          regimeLabel: `${pct.toFixed(0)}% of GDP`,
          color,
          implication,
        };
      });
    } catch {
      // Table may not exist yet — graceful degradation
      fundingRegimes = [];
    }

    return NextResponse.json({
      status: "ok",
      rateCards,
      nokIndex,
      nokIndexCurrent: nokIndex.length > 0 ? nokIndex[nokIndex.length - 1] : null,
      regimes,
      correlationMatrix,
      exposureHeatmap,
      fundingRegimes,
    });
  } catch (error: any) {
    console.error("[FX Dashboard API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch FX dashboard" },
      { status: 500 }
    );
  }
}

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 5) return 0;
  const ax = a.slice(-n);
  const bx = b.slice(-n);
  const ma = ax.reduce((s, v) => s + v, 0) / n;
  const mb = bx.reduce((s, v) => s + v, 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = ax[i] - ma;
    const db = bx[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  const denom = Math.sqrt(va * vb);
  return denom > 0 ? cov / denom : 0;
}
