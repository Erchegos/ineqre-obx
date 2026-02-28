/**
 * Company Exposure Matrix API
 * GET /api/seafood/company-exposure
 *
 * Returns seafood company risk matrix with stock prices and biological metrics
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEAFOOD_TICKERS = ["MOWI", "SALM", "LSG", "GSF", "BAKKA", "AUSS"];

export async function GET() {
  try {
    // Batch all queries in parallel
    const [metricsResult, stocksResult, pricesResult] = await Promise.all([
      // All company metrics (latest per ticker)
      pool.query(`
        SELECT DISTINCT ON (ticker)
          ticker, company_name, as_of_date, active_sites,
          avg_lice_4w::float, pct_above_threshold::float,
          treatment_rate::float, avg_sea_temp::float,
          risk_score::float, production_areas
        FROM seafood_company_metrics
        WHERE ticker = ANY($1::text[])
        ORDER BY ticker, as_of_date DESC
      `, [SEAFOOD_TICKERS]),

      // Stock master data
      pool.query(`
        SELECT upper(ticker) AS ticker, name, sector
        FROM stocks
        WHERE upper(ticker) = ANY($1::text[])
      `, [SEAFOOD_TICKERS]),

      // Last 30 prices for each ticker (for computing changes)
      pool.query(`
        SELECT ticker_upper, date, close, adj_close, rn FROM (
          SELECT upper(ticker) AS ticker_upper, date, close::float, adj_close::float,
                 ROW_NUMBER() OVER (PARTITION BY upper(ticker) ORDER BY date DESC) AS rn
          FROM prices_daily
          WHERE upper(ticker) = ANY($1::text[])
        ) sub
        WHERE rn <= 30
        ORDER BY ticker_upper, rn
      `, [SEAFOOD_TICKERS]),
    ]);

    // Index results by ticker
    const metricsMap = new Map(metricsResult.rows.map((r: any) => [r.ticker, r]));
    const stocksMap = new Map(stocksResult.rows.map((r: any) => [r.ticker, r]));

    // Group prices by ticker
    const pricesMap = new Map<string, any[]>();
    for (const r of pricesResult.rows) {
      if (!pricesMap.has(r.ticker_upper)) pricesMap.set(r.ticker_upper, []);
      pricesMap.get(r.ticker_upper)!.push(r);
    }

    const companies = SEAFOOD_TICKERS.map((ticker) => {
      const metrics = metricsMap.get(ticker) as any;
      const stock = stocksMap.get(ticker) as any;
      const prices = pricesMap.get(ticker) || [];

      const latest = prices[0]; // rn=1 = most recent
      const d1 = prices[1];    // rn=2
      const d5 = prices[4];    // rn=5
      const d22 = prices[21];  // rn=22

      return {
        ticker,
        name: stock?.name || metrics?.company_name || ticker,
        sector: stock?.sector || "Seafood",
        price: latest?.adj_close || latest?.close || null,
        priceDate: latest?.date || null,
        change1d: latest && d1 ? ((latest.close - d1.close) / d1.close) * 100 : null,
        change1w: latest && d5 ? ((latest.close - d5.close) / d5.close) * 100 : null,
        change1m: latest && d22 ? ((latest.close - d22.close) / d22.close) * 100 : null,
        activeSites: metrics?.active_sites || null,
        avgLice4w: metrics?.avg_lice_4w ?? null,
        pctAboveThreshold: metrics?.pct_above_threshold ?? null,
        treatmentRate: metrics?.treatment_rate ?? null,
        avgSeaTemp: metrics?.avg_sea_temp ?? null,
        riskScore: metrics?.risk_score ?? null,
        productionAreas: metrics?.production_areas || [],
        metricsDate: metrics?.as_of_date || null,
      };
    });

    return NextResponse.json({ companies });
  } catch (err) {
    console.error("[COMPANY EXPOSURE]", err);
    return NextResponse.json({ error: "Failed to fetch company exposure" }, { status: 500 });
  }
}
