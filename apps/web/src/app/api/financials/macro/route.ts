/**
 * Financials Macro API
 * GET /api/financials/macro
 *
 * Returns macro backdrop: FX rates + 90d history, CB balance sheet regimes,
 * oil/commodity exposure betas, and FX revenue breakdown per company.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKERS = [
  // Major banks
  "DNB", "MING", "NONG", "MORG", "SPOL", "SB1NO",
  // Regional banks
  "HELG", "PARB", "RING", "SOAG", "SPOG", "AURG", "JAREN", "GRONG",
  "SNOR", "MELG", "SKUE", "VVL", "BIEN", "HGSB", "ROGS", "TRSB",
  "SBNOR", "TINDE", "SB68", "KRAB", "INSTA",
  // Insurance
  "GJF", "STB", "PROT",
  // Financial services
  "ABG", "ACR", "B2I", "BNOR",
  // Investment companies
  "AKER", "BONHR", "AFK", "MGN", "SAGA", "ENDUR",
];

const FX_PAIRS = ["NOKUSD", "NOKEUR", "NOKGBP", "NOKSEK"];

export async function GET() {
  try {
    // 1. FX latest + change
    const fxLatestResult = await pool.query(
      `WITH latest AS (
        SELECT DISTINCT ON (currency_pair)
          currency_pair, spot_rate::float AS rate, date::text
        FROM fx_spot_rates
        WHERE currency_pair = ANY($1)
        ORDER BY currency_pair, date DESC
      ),
      prev AS (
        SELECT DISTINCT ON (fs.currency_pair)
          fs.currency_pair, fs.spot_rate::float AS rate
        FROM fx_spot_rates fs
        WHERE fs.currency_pair = ANY($1)
          AND fs.date < (
            SELECT MAX(date) FROM fx_spot_rates WHERE currency_pair = fs.currency_pair
          )
        ORDER BY fs.currency_pair, fs.date DESC
      )
      SELECT l.currency_pair, l.rate, l.date,
        CASE WHEN p.rate > 0 THEN ((l.rate / p.rate) - 1) * 100 ELSE NULL END AS change_pct
      FROM latest l
      LEFT JOIN prev p ON p.currency_pair = l.currency_pair`,
      [FX_PAIRS]
    );

    const fxStrip = fxLatestResult.rows.map((r: any) => ({
      pair: r.currency_pair,
      rate: r.rate,
      changePct: r.change_pct,
      date: r.date,
    }));

    // 2. FX 90d history
    const fxHistResult = await pool.query(
      `SELECT currency_pair, date::text, spot_rate::float AS rate
       FROM fx_spot_rates
       WHERE currency_pair = ANY($1)
         AND date >= CURRENT_DATE - INTERVAL '90 days'
       ORDER BY currency_pair, date ASC`,
      [FX_PAIRS]
    );
    const fxHistory: Record<string, { date: string; rate: number }[]> = {};
    for (const r of fxHistResult.rows) {
      if (!fxHistory[r.currency_pair]) fxHistory[r.currency_pair] = [];
      fxHistory[r.currency_pair].push({ date: r.date, rate: r.rate });
    }

    // 3. CB balance sheet regimes
    const cbResult = await pool.query(
      `SELECT DISTINCT ON (currency)
        currency, cb_name, balance_sheet_pct_gdp::float AS bs_pct_gdp, as_of_date::text
      FROM cb_balance_sheets
      ORDER BY currency, as_of_date DESC`
    );
    const cbRegimes = cbResult.rows.map((r: any) => {
      let regime = "Normal";
      if (r.bs_pct_gdp > 80) regime = "QE Active";
      else if (r.bs_pct_gdp > 40) regime = "Elevated";
      else if (r.bs_pct_gdp > 20) regime = "Tapering";
      else regime = "Minimal";
      return {
        currency: r.currency,
        cbName: r.cb_name,
        bsPctGdp: r.bs_pct_gdp,
        regime,
        asOfDate: r.as_of_date,
      };
    });

    // 4. Oil/commodity exposure for financials tickers
    const validResult = await pool.query(
      `SELECT ticker FROM stocks WHERE ticker = ANY($1) AND asset_type = 'equity'`,
      [TICKERS]
    );
    const validTickers = validResult.rows.map((r: any) => r.ticker);

    const oilResult = await pool.query(
      `SELECT ticker, commodity_symbol, beta::float, correlation_60d::float, r_squared::float
       FROM commodity_stock_sensitivity
       WHERE ticker = ANY($1) AND commodity_symbol IN ('BZ=F', 'CL=F')
       ORDER BY ticker, commodity_symbol`,
      [validTickers]
    );
    const oilExposure = oilResult.rows.map((r: any) => ({
      ticker: r.ticker,
      commodity: r.commodity_symbol,
      beta: r.beta,
      correlation: r.correlation_60d,
      rSquared: r.r_squared,
    }));

    // 5. FX revenue exposure
    const fxExpResult = await pool.query(
      `SELECT ticker,
        usd_revenue_pct::float AS usd,
        eur_revenue_pct::float AS eur,
        gbp_revenue_pct::float AS gbp,
        nok_revenue_pct::float AS nok,
        other_revenue_pct::float AS other
      FROM stock_fx_exposure
      WHERE ticker = ANY($1)`,
      [validTickers]
    );
    const fxExposure = fxExpResult.rows.map((r: any) => ({
      ticker: r.ticker,
      usd: r.usd ? r.usd * 100 : null,
      eur: r.eur ? r.eur * 100 : null,
      gbp: r.gbp ? r.gbp * 100 : null,
      nok: r.nok ? r.nok * 100 : null,
      other: r.other ? r.other * 100 : null,
    }));

    return NextResponse.json({
      fxStrip,
      fxHistory,
      cbRegimes,
      oilExposure,
      fxExposure,
    });
  } catch (err) {
    console.error("[financials/macro]", err);
    return NextResponse.json({ error: "Failed to fetch financials macro" }, { status: 500 });
  }
}
