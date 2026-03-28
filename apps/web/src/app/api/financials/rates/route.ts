/**
 * Financials Rates API
 * GET /api/financials/rates
 *
 * Returns interest rate environment: current rates, yield curve, 2Y history,
 * rate sensitivity heatmap (OLS beta of stock returns vs NIBOR 3M changes),
 * and cross-currency rate comparison.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 1. Rate history (NOK, last 2Y)
    const historyResult = await pool.query(
      `SELECT date::text, tenor, rate_type, rate::float AS rate
       FROM interest_rates
       WHERE currency = 'NOK'
         AND date >= CURRENT_DATE - INTERVAL '730 days'
       ORDER BY date ASC, tenor, rate_type`
    );

    // 2. Current rate strip (latest per tenor+rate_type for NOK)
    const currentResult = await pool.query(
      `SELECT DISTINCT ON (tenor, rate_type)
        tenor, rate_type, rate::float AS rate, date::text
       FROM interest_rates
       WHERE currency = 'NOK'
       ORDER BY tenor, rate_type, date DESC`
    );

    // Build current rates map
    const currentRates: Record<string, { rate: number; date: string }> = {};
    for (const r of currentResult.rows) {
      currentRates[`${r.tenor}_${r.rate_type}`] = { rate: r.rate * 100, date: r.date };
    }

    // 3. Yield curve (latest NOK IBOR per tenor)
    const yieldCurveResult = await pool.query(
      `SELECT DISTINCT ON (tenor)
        tenor, rate::float AS rate, date::text
       FROM interest_rates
       WHERE currency = 'NOK' AND rate_type = 'IBOR'
       ORDER BY tenor, date DESC`
    );
    const tenorOrder: Record<string, number> = { OVERNIGHT: 0, "1M": 1, "3M": 2, "6M": 3, "12M": 4 };
    const yieldCurve = yieldCurveResult.rows
      .map((r: any) => ({ tenor: r.tenor, rate: r.rate * 100, date: r.date }))
      .sort((a: any, b: any) => (tenorOrder[a.tenor] ?? 99) - (tenorOrder[b.tenor] ?? 99));

    // 4. Cross-currency rates (latest per currency/tenor/rate_type)
    const crossResult = await pool.query(
      `SELECT DISTINCT ON (currency, tenor, rate_type)
        currency, tenor, rate_type, rate::float AS rate, date::text
       FROM interest_rates
       WHERE currency IN ('NOK', 'USD', 'EUR', 'GBP', 'SEK')
         AND rate_type IN ('POLICY_RATE', 'IBOR')
       ORDER BY currency, tenor, rate_type, date DESC`
    );
    const crossCurrency: Record<string, any[]> = {};
    for (const r of crossResult.rows) {
      if (!crossCurrency[r.currency]) crossCurrency[r.currency] = [];
      crossCurrency[r.currency].push({
        tenor: r.tenor,
        rateType: r.rate_type,
        rate: r.rate * 100,
        date: r.date,
      });
    }

    // Rate sensitivity removed — policy rate flat at 4.50% since Dec 2023, no meaningful variation for OLS

    // Format history for chart
    const rateHistory = historyResult.rows.map((r: any) => ({
      date: r.date,
      tenor: r.tenor,
      rateType: r.rate_type,
      rate: r.rate * 100,
    }));

    return NextResponse.json({
      current: {
        policyRate: currentRates["OVERNIGHT_POLICY_RATE"] || null,
        nibor3m: currentRates["3M_IBOR"] || null,
        nibor6m: currentRates["6M_IBOR"] || null,
        nibor12m: currentRates["12M_IBOR"] || null,
      },
      yieldCurve,
      rateHistory,
      crossCurrency,
    });
  } catch (err) {
    console.error("[financials/rates]", err);
    return NextResponse.json({ error: "Failed to fetch financials rates" }, { status: 500 });
  }
}
