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

/**
 * Compute max pain: the strike price where total payout to option holders is minimized.
 * For each candidate settlement price P (each unique strike), sum across ALL strikes K:
 *   call payout = max(0, P - K) * callOI[K]
 *   put payout  = max(0, K - P) * putOI[K]
 * Max pain = P with the lowest total payout.
 */
function computeMaxPain(
  chain: { strike: number; call_oi: number; put_oi: number }[]
): number | null {
  if (chain.length === 0) return null;

  const strikes = chain.map((c) => c.strike);
  let minPain = Infinity;
  let maxPainStrike: number | null = null;

  for (const P of strikes) {
    let totalPain = 0;
    for (const row of chain) {
      const K = row.strike;
      // Call holders get paid when settlement P > strike K
      if (P > K) totalPain += (P - K) * row.call_oi;
      // Put holders get paid when settlement P < strike K
      if (P < K) totalPain += (K - P) * row.put_oi;
    }
    if (totalPain < minPain) {
      minPain = totalPain;
      maxPainStrike = P;
    }
  }

  return maxPainStrike;
}

export async function GET() {
  try {
    // Get meta + aggregated chain stats in one query (without max pain)
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
        agg.atm_put_iv
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
           ORDER BY ABS(strike - m.underlying_price) LIMIT 1) AS atm_put_iv
        FROM public.options_chain c
        WHERE c.ticker = m.ticker
      ) agg ON true
      ORDER BY m.ticker
    `);

    // Fetch nearest-expiry chain data for max pain calculation
    // Get aggregated call/put OI per strike for each ticker's nearest expiry
    const maxPainResult = await pool.query(`
      SELECT
        c.ticker,
        c.strike,
        COALESCE(SUM(CASE WHEN c.option_right = 'call' THEN c.open_interest ELSE 0 END), 0)::int AS call_oi,
        COALESCE(SUM(CASE WHEN c.option_right = 'put' THEN c.open_interest ELSE 0 END), 0)::int AS put_oi
      FROM public.options_chain c
      INNER JOIN (
        SELECT ticker, MIN(expiry) AS nearest_expiry
        FROM public.options_chain
        GROUP BY ticker
      ) ne ON c.ticker = ne.ticker AND c.expiry = ne.nearest_expiry
      GROUP BY c.ticker, c.strike
      ORDER BY c.ticker, c.strike
    `);

    // Build max pain lookup: ticker -> chain data
    const maxPainChains = new Map<string, { strike: number; call_oi: number; put_oi: number }[]>();
    for (const row of maxPainResult.rows) {
      const ticker = row.ticker as string;
      if (!maxPainChains.has(ticker)) maxPainChains.set(ticker, []);
      maxPainChains.get(ticker)!.push({
        strike: parseFloat(row.strike),
        call_oi: parseInt(row.call_oi) || 0,
        put_oi: parseInt(row.put_oi) || 0,
      });
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    const stocks = result.rows.map((row) => {
      const exps = (row.expirations as string[]).filter(e => e >= today);
      const callOI = parseInt(row.total_call_oi) || 0;
      const putOI = parseInt(row.total_put_oi) || 0;
      const pcRatioOI = callOI > 0 ? putOI / callOI : 0;
      const atmCallIV = row.atm_call_iv ? parseFloat(row.atm_call_iv) : null;
      const atmPutIV = row.atm_put_iv ? parseFloat(row.atm_put_iv) : null;
      const atmIV = atmCallIV && atmPutIV ? (atmCallIV + atmPutIV) / 2 : (atmCallIV || atmPutIV);

      // Compute max pain in JS
      const chain = maxPainChains.get(row.ticker) || [];
      const maxPain = computeMaxPain(chain);

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
        max_pain: maxPain,
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
