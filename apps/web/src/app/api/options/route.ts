/**
 * Options Overview API
 * GET /api/options
 *
 * Returns list of all stocks with pre-loaded options data + aggregated stats
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Get meta + aggregated chain stats in one query
    const result = await pool.query(`
      SELECT
        m.ticker,
        m.underlying_price,
        m.currency,
        m.expirations,
        m.strikes,
        m.fetched_at,
        agg.total_call_oi,
        agg.total_put_oi,
        agg.total_call_vol,
        agg.total_put_vol,
        agg.total_contracts,
        agg.nearest_expiry,
        agg.farthest_expiry,
        agg.atm_call_iv,
        agg.atm_put_iv,
        agg.max_pain_strike
      FROM public.options_meta m
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(CASE WHEN c.option_right = 'call' THEN c.open_interest ELSE 0 END), 0)::int AS total_call_oi,
          COALESCE(SUM(CASE WHEN c.option_right = 'put' THEN c.open_interest ELSE 0 END), 0)::int AS total_put_oi,
          COALESCE(SUM(CASE WHEN c.option_right = 'call' THEN c.volume ELSE 0 END), 0)::int AS total_call_vol,
          COALESCE(SUM(CASE WHEN c.option_right = 'put' THEN c.volume ELSE 0 END), 0)::int AS total_put_vol,
          COUNT(*)::int AS total_contracts,
          MIN(c.expiry) AS nearest_expiry,
          MAX(c.expiry) AS farthest_expiry,
          -- ATM IV: closest strike to underlying for nearest expiry
          (SELECT iv FROM public.options_chain
           WHERE ticker = m.ticker AND option_right = 'call' AND expiry = MIN(c.expiry) AND iv > 0
           ORDER BY ABS(strike - m.underlying_price) LIMIT 1) AS atm_call_iv,
          (SELECT iv FROM public.options_chain
           WHERE ticker = m.ticker AND option_right = 'put' AND expiry = MIN(c.expiry) AND iv > 0
           ORDER BY ABS(strike - m.underlying_price) LIMIT 1) AS atm_put_iv,
          -- Max pain: strike with minimum total obligation
          (SELECT sub.strike FROM (
            SELECT strike,
              SUM(CASE WHEN option_right = 'call' AND strike < m.underlying_price THEN open_interest * (m.underlying_price - strike) ELSE 0 END) +
              SUM(CASE WHEN option_right = 'put' AND strike > m.underlying_price THEN open_interest * (strike - m.underlying_price) ELSE 0 END) AS pain
            FROM public.options_chain
            WHERE ticker = m.ticker AND expiry = MIN(c.expiry)
            GROUP BY strike
            ORDER BY pain ASC LIMIT 1
          ) sub) AS max_pain_strike
        FROM public.options_chain c
        WHERE c.ticker = m.ticker
      ) agg ON true
      ORDER BY m.ticker
    `);

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    const stocks = result.rows.map((row) => {
      const exps = (row.expirations as string[]).filter(e => e >= today);
      const callOI = parseInt(row.total_call_oi) || 0;
      const putOI = parseInt(row.total_put_oi) || 0;
      const pcRatioOI = callOI > 0 ? putOI / callOI : 0;
      const atmCallIV = row.atm_call_iv ? parseFloat(row.atm_call_iv) : null;
      const atmPutIV = row.atm_put_iv ? parseFloat(row.atm_put_iv) : null;
      const atmIV = atmCallIV && atmPutIV ? (atmCallIV + atmPutIV) / 2 : (atmCallIV || atmPutIV);

      // Days to nearest expiry
      let daysToExpiry: number | null = null;
      if (row.nearest_expiry) {
        const exp = row.nearest_expiry;
        const expDate = new Date(`${exp.slice(0,4)}-${exp.slice(4,6)}-${exp.slice(6,8)}`);
        daysToExpiry = Math.max(0, Math.round((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
      }

      return {
        ticker: row.ticker,
        underlying_price: parseFloat(row.underlying_price),
        currency: row.currency || "USD",
        expirations: exps,
        strikes: row.strikes as number[],
        fetched_at: row.fetched_at,
        total_call_oi: callOI,
        total_put_oi: putOI,
        total_oi: callOI + putOI,
        total_call_vol: parseInt(row.total_call_vol) || 0,
        total_put_vol: parseInt(row.total_put_vol) || 0,
        total_vol: (parseInt(row.total_call_vol) || 0) + (parseInt(row.total_put_vol) || 0),
        total_contracts: parseInt(row.total_contracts) || 0,
        pc_ratio_oi: pcRatioOI,
        atm_iv: atmIV,
        max_pain: row.max_pain_strike ? parseFloat(row.max_pain_strike) : null,
        nearest_expiry: row.nearest_expiry,
        farthest_expiry: row.farthest_expiry,
        days_to_expiry: daysToExpiry,
      };
    });

    return NextResponse.json({ stocks });
  } catch (error: unknown) {
    console.error("[Options Overview API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch options stocks" },
      { status: 500 }
    );
  }
}
