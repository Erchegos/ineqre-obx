/**
 * FX Forward Rates API
 * GET /api/fx/rates/forward?pair=NOKUSD
 *
 * Computes forward rates at 1M/3M/6M/12M via covered Interest Rate Parity.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { calculateHedgeCostAndBreakeven } from "@/lib/fxTerminal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TENORS = [
  { label: "1M", days: 30, tenor: "1M" },
  { label: "3M", days: 91, tenor: "3M" },
  { label: "6M", days: 182, tenor: "6M" },
  { label: "12M", days: 365, tenor: "12M" },
];

// Map pair to foreign currency code
const PAIR_TO_CURRENCY: Record<string, string> = {
  NOKUSD: "USD",
  NOKEUR: "EUR",
  NOKGBP: "GBP",
  NOKSEK: "SEK",
  NOKDKK: "DKK",
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pair = (searchParams.get("pair") || "NOKUSD").toUpperCase();

    const foreignCurrency = PAIR_TO_CURRENCY[pair];
    if (!foreignCurrency) {
      return NextResponse.json({ error: `Unknown pair: ${pair}` }, { status: 400 });
    }

    // Fetch latest spot rate — prefer 'norgesbank' source
    const spotResult = await pool.query<{ spot_rate: string; date: string }>(
      `SELECT spot_rate, date::text FROM fx_spot_rates
       WHERE currency_pair = $1 AND spot_rate > 0
       ORDER BY date DESC,
         CASE WHEN source = 'norgesbank' THEN 0 ELSE 1 END
       LIMIT 1`,
      [pair]
    );
    if (spotResult.rows.length === 0) {
      return NextResponse.json({ error: `No spot data for ${pair}` }, { status: 404 });
    }
    const spot = parseFloat(spotResult.rows[0].spot_rate);
    const spotDate = spotResult.rows[0].date;

    // Fetch interest rates for NOK and foreign currency
    const ratesResult = await pool.query<{
      currency: string;
      tenor: string;
      rate: string;
    }>(
      `SELECT DISTINCT ON (currency, tenor) currency, tenor, rate
       FROM interest_rates
       WHERE currency IN ('NOK', $1)
       ORDER BY currency, tenor, date DESC`,
      [foreignCurrency]
    );

    const rates: Record<string, Record<string, number>> = {};
    for (const row of ratesResult.rows) {
      if (!rates[row.currency]) rates[row.currency] = {};
      rates[row.currency][row.tenor] = parseFloat(row.rate);
    }

    const nokOvernight = rates["NOK"]?.["OVERNIGHT"] ?? 0.045;

    // Compute forwards for each tenor
    const forwards = TENORS.map(({ label, days, tenor }) => {
      const nokRate = rates["NOK"]?.[tenor] ?? nokOvernight;
      const foreignRate = rates[foreignCurrency]?.[tenor] ?? 0;

      const hedge = calculateHedgeCostAndBreakeven(spot, nokRate, foreignRate, 1.0, days);

      return {
        tenor: label,
        days,
        spot,
        forward: hedge.forwardRate,
        forwardPoints: hedge.forwardPoints,
        forwardPointsBps: (hedge.forwardPoints / spot) * 10000,
        annualizedCarryPct: (nokRate - foreignRate) * 100,
        hedgeCostBps: hedge.costBps,
        breakEvenPct: hedge.breakEvenPct,
        nokRate: nokRate * 100,
        foreignRate: foreignRate * 100,
      };
    });

    return NextResponse.json({
      pair,
      spotDate,
      spot,
      foreignCurrency,
      forwards,
    });
  } catch (error: any) {
    console.error("[FX Forward API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to compute forward rates" },
      { status: 500 }
    );
  }
}
