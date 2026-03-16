/**
 * FX Carry Trade API
 * GET /api/fx/carry?pair=NOKUSD&days=252
 *
 * Interest rate differential, carry Sharpe, cumulative carry vs spot P&L series.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { carryTradeMetrics } from "@/lib/fxTerminal";
import { decomposeCarry } from "@/lib/fxPairCalculations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const days = parseInt(searchParams.get("days") || "252");

    const foreignCurrency = PAIR_TO_CURRENCY[pair];
    if (!foreignCurrency) {
      return NextResponse.json({ error: `Unknown pair: ${pair}` }, { status: 400 });
    }

    // Fetch spot history — deduplicate: prefer 'norgesbank' over legacy 'norges_bank'
    const spotResult = await pool.query<{ date: string; spot_rate: string }>(
      `SELECT date::text, spot_rate FROM (
         SELECT DISTINCT ON (date) date, spot_rate
         FROM fx_spot_rates
         WHERE currency_pair = $1 AND spot_rate > 0
         ORDER BY date DESC,
           CASE WHEN source = 'norgesbank' THEN 0 ELSE 1 END
       ) sub
       ORDER BY date DESC
       LIMIT $2`,
      [pair, days + 1]
    );

    if (spotResult.rows.length < 10) {
      return NextResponse.json({ error: `Insufficient data for ${pair}` }, { status: 404 });
    }

    const spotHistory = spotResult.rows.reverse().map((r) => ({
      date: r.date,
      rate: parseFloat(r.spot_rate),
    }));

    // Fetch interest rates
    const ratesResult = await pool.query<{ currency: string; tenor: string; rate: string }>(
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

    // Use 3M rate for carry calculation
    const nokRate = rates["NOK"]?.["3M"] ?? rates["NOK"]?.["OVERNIGHT"] ?? 0.045;
    const foreignRate = rates[foreignCurrency]?.["3M"] ?? rates[foreignCurrency]?.["OVERNIGHT"] ?? 0;

    const result = carryTradeMetrics(nokRate, foreignRate, spotHistory);

    // Forward premium/discount time series (simplified: constant rate assumption)
    const forwardPremium = ((nokRate - foreignRate) / (1 + foreignRate)) * 100;

    // Carry decomposition: gross vs net after CP funding costs
    // Rime, Schrimpf & Syrstad (RFS 2022) Table 1: USD CP-OIS spreads
    const grossCarryBps = (nokRate - foreignRate) * 10000;
    const carryDecomposition = decomposeCarry(grossCarryBps);

    return NextResponse.json({
      pair,
      foreignCurrency,
      days: spotHistory.length,
      dateRange: {
        start: spotHistory[0]?.date,
        end: spotHistory[spotHistory.length - 1]?.date,
      },
      rates: {
        nokRate: nokRate * 100,
        foreignRate: foreignRate * 100,
        differential: (nokRate - foreignRate) * 100,
      },
      carry: result.carry,
      carrySharpe: result.carrySharpe,
      spotVol: result.spotVol,
      forwardPremiumPct: forwardPremium,
      cumulativePnl: result.cumulativePnl,
      carryDecomposition,
    });
  } catch (error: any) {
    console.error("[FX Carry API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to compute carry trade metrics" },
      { status: 500 }
    );
  }
}
