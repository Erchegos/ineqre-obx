/**
 * Commodity Correlation Matrix API
 * GET /api/commodities/correlation
 *
 * Computes NxN Pearson correlation matrix on log-returns for commodities
 * and optionally a set of equities.
 *
 * Query params:
 *   ?days=90          — lookback window (default 90)
 *   ?equities=EQNR,MOWI,NHY,FRO — comma-separated equity tickers to include
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMODITY_SYMBOLS = [
  "BZ=F", "CL=F", "NG=F", "ALI=F", "HG=F", "GC=F", "SI=F", "SALMON",
];

const COMMODITY_LABELS: Record<string, string> = {
  "BZ=F":   "Brent",
  "CL=F":   "WTI",
  "NG=F":   "Gas",
  "ALI=F":  "Aluminium",
  "HG=F":   "Copper",
  "GC=F":   "Gold",
  "SI=F":   "Silver",
  "SALMON": "Salmon",
};

function logReturns(prices: number[]): number[] {
  const ret: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && prices[i] > 0) {
      ret.push(Math.log(prices[i] / prices[i - 1]));
    } else {
      ret.push(0);
    }
  }
  return ret;
}

function pearsonCorr(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 5) return NaN;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return den === 0 ? NaN : num / den;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const days = Math.min(parseInt(sp.get("days") || "90"), 365);
    const equitiesParam = sp.get("equities") || "";
    const equityTickers = equitiesParam
      ? equitiesParam.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 10)
      : [];

    // Fetch commodity price series
    const commResult = await pool.query(
      `SELECT symbol, date, close::float AS close
       FROM commodity_prices
       WHERE symbol = ANY($1::text[])
         AND date >= NOW() - INTERVAL '${days} days'
       ORDER BY symbol, date ASC`,
      [COMMODITY_SYMBOLS]
    );

    // Build date-indexed maps per commodity
    const commPrices: Record<string, Map<string, number>> = {};
    for (const row of commResult.rows) {
      if (!commPrices[row.symbol]) commPrices[row.symbol] = new Map();
      commPrices[row.symbol].set(row.date.toISOString().slice(0, 10), row.close);
    }

    // Fetch equity price series if requested
    const equityPrices: Record<string, Map<string, number>> = {};
    if (equityTickers.length > 0) {
      const eqResult = await pool.query(
        `SELECT s.ticker, pd.date, pd.adj_close::float AS close
         FROM prices_daily pd
         JOIN stocks s ON s.id = pd.stock_id
         WHERE upper(s.ticker) = ANY($1::text[])
           AND pd.date >= NOW() - INTERVAL '${days} days'
         ORDER BY s.ticker, pd.date ASC`,
        [equityTickers]
      );
      for (const row of eqResult.rows) {
        const t = row.ticker.toUpperCase();
        if (!equityPrices[t]) equityPrices[t] = new Map();
        equityPrices[t].set(row.date.toISOString().slice(0, 10), row.close);
      }
    }

    // Collect all dates present in commodities
    const dateSet = new Set<string>();
    for (const sym of COMMODITY_SYMBOLS) {
      if (commPrices[sym]) commPrices[sym].forEach((_, d) => dateSet.add(d));
    }
    const allDates = Array.from(dateSet).sort();

    // Build series arrays (only commodities that have data)
    const tickers: string[] = [];
    const labels: string[] = [];
    const series: number[][] = [];

    for (const sym of COMMODITY_SYMBOLS) {
      const map = commPrices[sym];
      if (!map || map.size < 5) continue;
      const prices: number[] = [];
      for (const d of allDates) {
        prices.push(map.get(d) ?? NaN);
      }
      // Forward-fill NaN gaps
      let last = NaN;
      for (let i = 0; i < prices.length; i++) {
        if (!isNaN(prices[i])) last = prices[i];
        else prices[i] = last;
      }
      if (prices.filter((p) => !isNaN(p)).length < 5) continue;
      tickers.push(sym);
      labels.push(COMMODITY_LABELS[sym] || sym);
      series.push(logReturns(prices));
    }

    // Equity series
    const equityDates = allDates; // use same date grid
    for (const t of equityTickers) {
      const map = equityPrices[t];
      if (!map || map.size < 5) continue;
      const prices: number[] = [];
      for (const d of equityDates) {
        prices.push(map.get(d) ?? NaN);
      }
      let last = NaN;
      for (let i = 0; i < prices.length; i++) {
        if (!isNaN(prices[i])) last = prices[i];
        else prices[i] = last;
      }
      if (prices.filter((p) => !isNaN(p)).length < 5) continue;
      tickers.push(t);
      labels.push(t);
      series.push(logReturns(prices));
    }

    const n = tickers.length;
    const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(NaN));

    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1;
      for (let j = i + 1; j < n; j++) {
        const c = pearsonCorr(series[i], series[j]);
        matrix[i][j] = c;
        matrix[j][i] = c;
      }
    }

    return NextResponse.json({ tickers, labels, matrix, period: days });
  } catch (err) {
    console.error("[COMMODITY CORRELATION API]", err);
    return NextResponse.json({ error: "Failed to compute correlation" }, { status: 500 });
  }
}
