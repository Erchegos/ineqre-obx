/**
 * FX Pairs API - Professional Quant Analytics
 * GET /api/fx-pairs?pair=NOKUSD&days=252
 *
 * Returns comprehensive FX analytics for specified pair
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  calculateFXLogReturns,
  calculateFXVolatility,
  calculateRollingFXVolatility,
  validateFXDataIntegrity,
  normalizeFXPair,
  type FXSpotData,
} from "@/lib/fxPairCalculations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pair = searchParams.get("pair") || "NOKUSD";
    const days = parseInt(searchParams.get("days") || "252");

    // Validate and normalize pair
    const normalizedPair = normalizeFXPair(pair);

    // Fetch spot rates
    const query = `
      SELECT
        currency_pair as pair,
        date::text,
        spot_rate as spot,
        bid,
        ask,
        mid
      FROM fx_spot_rates
      WHERE currency_pair = $1
      ORDER BY date DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [normalizedPair, days]);

    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          error: `No data available for ${normalizedPair}`,
          hint: "Run: tsx scripts/fx/fetch-fx-rates.ts --backfill 252",
        },
        { status: 404 }
      );
    }

    // Reverse to get chronological order
    const spotData: FXSpotData[] = result.rows
      .reverse()
      .map((row) => ({
        date: row.date,
        pair: row.pair,
        spot: Number(row.spot),
        bid: row.bid ? Number(row.bid) : undefined,
        ask: row.ask ? Number(row.ask) : undefined,
      }));

    // Validate data integrity
    const integrity = validateFXDataIntegrity(spotData);
    if (!integrity.valid) {
      console.warn("Data integrity issues:", integrity.errors);
    }

    // Calculate returns
    const returns = calculateFXLogReturns(spotData);

    // Calculate volatility
    const volatility = calculateFXVolatility(returns);

    // Rolling volatility (20, 63, 252 day windows)
    const rollingVol20 = calculateRollingFXVolatility(returns, 20);
    const rollingVol63 = calculateRollingFXVolatility(returns, 63);
    const rollingVol252 = calculateRollingFXVolatility(returns, 252);

    // Latest values
    const latest = spotData[spotData.length - 1];
    const latestReturn = returns[returns.length - 1];

    // Statistics
    const logReturns = returns.map((r) => r.logReturn);
    const meanReturn = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    const minReturn = Math.min(...logReturns);
    const maxReturn = Math.max(...logReturns);

    // Response
    return NextResponse.json({
      pair: normalizedPair,
      dataPoints: spotData.length,
      dateRange: {
        start: spotData[0].date,
        end: latest.date,
      },

      // Latest spot
      latest: {
        date: latest.date,
        spot: latest.spot,
        bid: latest.bid,
        ask: latest.ask,
        logReturn: latestReturn?.logReturn || null,
        simpleReturn: latestReturn?.simpleReturn || null,
      },

      // Volatility
      volatility: {
        annualized: volatility.annualizedVol,
        window: volatility.window,
        observations: volatility.observations,
      },

      // Rolling volatility
      rollingVolatility: {
        '20D': rollingVol20[rollingVol20.length - 1]?.volatility || null,
        '63D': rollingVol63[rollingVol63.length - 1]?.volatility || null,
        '252D': rollingVol252[rollingVol252.length - 1]?.volatility || null,
      },

      // Return statistics
      returnStats: {
        mean: meanReturn * 100, // Convert to %
        min: minReturn * 100,
        max: maxReturn * 100,
        annualizedMean: meanReturn * 252 * 100,
      },

      // Time series data
      timeSeries: {
        spot: spotData.map((d) => ({ date: d.date, value: d.spot })),
        returns: returns.map((r) => ({ date: r.date, value: r.logReturn * 100 })),
        volatility20D: rollingVol20,
        volatility63D: rollingVol63,
        volatility252D: rollingVol252,
      },

      // Data integrity
      dataIntegrity: {
        valid: integrity.valid,
        errors: integrity.errors,
      },
    });
  } catch (error: any) {
    console.error("[FX Pairs API] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch FX pair data" },
      { status: 500 }
    );
  }
}
