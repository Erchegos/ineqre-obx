/**
 * CIP Arbitrage Monitor API
 * GET /api/fx/arb-monitor?tenor=3M
 *
 * Estimates CIP arbitrage profit for each tracked NOK pair at the selected tenor,
 * distinguishing between high-rated (A-1/P-1) and mid-rated (A-2/P-2) banks.
 *
 * Formula (paper Section 2.1, Table 3):
 *   CIP Arb Profit = Forward Premium − (r_USD_CP − r_foreign_CB_deposit)
 *   Forward Premium = (F/S − 1) × (360/tenorDays) × 10000
 *   r_USD_CP = USD OIS + CP_spread (19 bps high-rated, 36 bps mid-rated)
 *   r_foreign_CB = static CB deposit facility rate per currency
 *
 * Note: Positive arb profit is rare and accessible only to banks with CB deposit
 * account access. For most market participants, the implementable basis is ≤ 0.
 *
 * Source: Rime, Schrimpf & Syrstad (RFS 2022) — Section 2.1, Tables 3 & 1
 *
 * Pairs covered: NOKUSD, NOKEUR, NOKGBP, NOKSEK
 * (NOKJPY and NOKCHF excluded — no spot data in DB)
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAIR_TO_CURRENCY: Record<string, string> = {
  NOKUSD: "USD",
  NOKEUR: "EUR",
  NOKGBP: "GBP",
  NOKSEK: "SEK",
};

const TENOR_DAYS: Record<string, number> = {
  "1M": 30,
  "3M": 91,
  "6M": 182,
  "12M": 365,
};

// Static CB deposit facility rates (bps) — update quarterly
// Rime, Schrimpf & Syrstad (RFS 2022) Table 3 vehicle: CB deposit account
// These reflect approximate current policy stances (2025–2026)
const CB_DEPOSIT_RATES_BPS: Record<string, number> = {
  USD: 10,   // Fed overnight reverse repo ~10 bps above floor
  EUR: -50,  // ECB deposit facility (historically negative, may vary)
  GBP: 10,   // BoE reserve remuneration ~Bank Rate
  SEK: -50,  // Riksbank deposit facility (approximate)
  NOK: 0,    // Not used directly (NOK is domestic currency here)
};

// USD CP-OIS spreads — Rime, Schrimpf & Syrstad (RFS 2022) Table 1
const CP_OIS_HIGH = 19; // bps, A-1/P-1 banks
const CP_OIS_MID  = 36; // bps, A-2/P-2 banks

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenor = (searchParams.get("tenor") || "3M").toUpperCase();
    const tenorDays = TENOR_DAYS[tenor];
    if (!tenorDays) {
      return NextResponse.json({ error: `Unknown tenor: ${tenor}` }, { status: 400 });
    }

    const pairs = Object.keys(PAIR_TO_CURRENCY);

    // Fetch latest spot rates for all pairs
    const spotResult = await pool.query<{ currency_pair: string; spot_rate: string }>(
      `SELECT DISTINCT ON (currency_pair) currency_pair, spot_rate
       FROM fx_spot_rates
       WHERE currency_pair = ANY($1) AND spot_rate > 0
       ORDER BY currency_pair, date DESC,
         CASE WHEN source = 'norgesbank' THEN 0 ELSE 1 END`,
      [pairs]
    );
    const spots: Record<string, number> = {};
    for (const row of spotResult.rows) {
      spots[row.currency_pair] = parseFloat(row.spot_rate);
    }

    // Fetch latest interest rates for all relevant currencies
    const currencies = ["NOK", ...Object.values(PAIR_TO_CURRENCY)];
    const ratesResult = await pool.query<{ currency: string; rate: string }>(
      `SELECT DISTINCT ON (currency) currency, rate
       FROM interest_rates
       WHERE currency = ANY($1) AND tenor = $2
       ORDER BY currency, date DESC`,
      [currencies, tenor]
    );
    const rates: Record<string, number> = {};
    for (const row of ratesResult.rows) {
      rates[row.currency] = parseFloat(row.rate);
    }

    const nokRate = rates["NOK"] ?? 0.045;
    const tau = tenorDays / 360; // FX convention uses ACT/360

    const results = pairs.map((pair) => {
      const foreignCcy = PAIR_TO_CURRENCY[pair];
      const spot = spots[pair];
      const foreignRate = rates[foreignCcy] ?? 0;

      if (!spot) {
        return { pair, tenor, error: "No spot data", signal: "NO_DATA" };
      }

      // IRP forward (ACT/365 for consistency with rest of system)
      const tauAct365 = tenorDays / 365;
      const forward = spot * ((1 + nokRate * tauAct365) / (1 + foreignRate * tauAct365));

      // Forward premium in bps (annualized, ACT/360)
      const forwardPremiumBps = ((forward / spot) - 1) * (360 / tenorDays) * 10000;

      // OIS basis: forward premium minus rate differential
      // basis_bps = forwardPremium - (r_NOK - r_foreign) × 10000
      const oisBasisBps = forwardPremiumBps - (nokRate - foreignRate) * 10000;

      // USD CP funding cost above OIS (bank must fund in CP, not OIS)
      // r_USD_CP = USD OIS + CP_spread
      const usdOisRate = rates["USD"] ?? 0.04;
      const usdCpHighBps = usdOisRate * 10000 + CP_OIS_HIGH;
      const usdCpMidBps  = usdOisRate * 10000 + CP_OIS_MID;

      // Foreign CB deposit rate
      const foreignCbDepositBps = CB_DEPOSIT_RATES_BPS[foreignCcy] ?? 0;

      // CIP arb profit = forward premium − (r_USD_CP − r_foreign_CB_deposit)
      // Rime et al. (RFS 2022) Section 2.1, Table 3
      const fundingCostHigh = usdCpHighBps - foreignCbDepositBps;
      const fundingCostMid  = usdCpMidBps  - foreignCbDepositBps;
      const arbProfitHigh = forwardPremiumBps - fundingCostHigh;
      const arbProfitMid  = forwardPremiumBps - fundingCostMid;

      // Signal
      let signal: "POSITIVE_ARB" | "MARGINAL" | "NO_ARB";
      if (arbProfitHigh > 5) signal = "POSITIVE_ARB";
      else if (arbProfitHigh >= 0) signal = "MARGINAL";
      else signal = "NO_ARB";

      return {
        pair,
        foreignCurrency: foreignCcy,
        tenor,
        spot: parseFloat(spot.toFixed(4)),
        forward: parseFloat(forward.toFixed(4)),
        forwardPremiumBps: parseFloat(forwardPremiumBps.toFixed(2)),
        oisBasisBps: parseFloat(oisBasisBps.toFixed(2)),
        usdCpHighBps: parseFloat(usdCpHighBps.toFixed(2)),
        usdCpMidBps: parseFloat(usdCpMidBps.toFixed(2)),
        foreignCbDepositBps,
        arbProfitHighRatedBps: parseFloat(arbProfitHigh.toFixed(2)),
        arbProfitMidRatedBps: parseFloat(arbProfitMid.toFixed(2)),
        signal,
      };
    });

    return NextResponse.json({
      tenor,
      tenorDays,
      results,
      constants: {
        cpOisHighBps: CP_OIS_HIGH,
        cpOisMidBps: CP_OIS_MID,
        cbDepositRates: CB_DEPOSIT_RATES_BPS,
      },
      note: "Positive arb profit accessible only to high-rated banks with CB deposit accounts. For most participants, implementable basis ≤ 0.",
      source: "Rime, Schrimpf & Syrstad (RFS 2022) — Section 2.1, Tables 1 & 3",
    });
  } catch (error: any) {
    console.error("[FX Arb Monitor API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to compute CIP arbitrage" },
      { status: 500 }
    );
  }
}
