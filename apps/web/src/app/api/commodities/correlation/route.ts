/**
 * Commodity Correlation Matrix API
 * GET /api/commodities/correlation
 *
 * Computes Pearson correlation on log-returns between all tracked commodities.
 * Optionally includes equities for cross-asset correlation.
 *
 * Query params:
 *   ?days=90                    — lookback period (default 90)
 *   ?equities=EQNR,MOWI,NHY    — optional equity tickers to include
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMODITY_LABELS: Record<string, string> = {
  "BZ=F": "Brent",
  "CL=F": "Crude Oil",
  "NG=F": "Natural Gas",
  "RB=F": "Gasoline",
  "HO=F": "Heating Oil",
  "TTF=F": "TTF Gas",
  "MTF=F": "Coal",
  "ALI=F": "Aluminium",
  "HG=F": "Copper",
  "GC=F": "Gold",
  "SI=F": "Silver",
  "ZS=F": "Soybeans",
  "ZW=F": "Wheat",
  "LBS=F": "Lumber",
  "SALMON": "Salmon",
};

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 5) return 0;
  const xs = x.slice(0, n);
  const ys = y.slice(0, n);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  return denom > 0 ? sxy / denom : 0;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const days = Math.min(Math.max(parseInt(sp.get("days") || "90"), 10), 1000);
    const equitiesParam = sp.get("equities") || "";
    const equityTickers = equitiesParam
      ? equitiesParam.split(",").map(t => t.trim().toUpperCase()).filter(t => /^[A-Z0-9.]{1,10}$/.test(t)).slice(0, 10)
      : [];

    // Fetch commodity prices
    const commodityResult = await pool.query(`
      SELECT symbol, date, close::float AS close
      FROM commodity_prices
      WHERE date >= NOW() - INTERVAL '${days + 10} days'
      ORDER BY symbol, date ASC
    `);

    // Group by symbol
    const pricesBySymbol: Record<string, { date: string; close: number }[]> = {};
    for (const row of commodityResult.rows) {
      if (!pricesBySymbol[row.symbol]) pricesBySymbol[row.symbol] = [];
      pricesBySymbol[row.symbol].push({ date: row.date, close: row.close });
    }

    // Fetch equity prices if requested
    if (equityTickers.length > 0) {
      const eqResult = await pool.query(`
        SELECT ticker AS symbol, date, adj_close::float AS close
        FROM prices_daily
        WHERE ticker = ANY($1::text[])
          AND date >= NOW() - INTERVAL '${days + 10} days'
        ORDER BY ticker, date ASC
      `, [equityTickers]);

      for (const row of eqResult.rows) {
        if (!pricesBySymbol[row.symbol]) pricesBySymbol[row.symbol] = [];
        pricesBySymbol[row.symbol].push({ date: row.date, close: row.close });
      }
    }

    // Compute log-returns for each symbol
    const logReturnsBySymbol: Record<string, Map<string, number>> = {};
    const allDates = new Set<string>();

    for (const [symbol, prices] of Object.entries(pricesBySymbol)) {
      logReturnsBySymbol[symbol] = new Map();
      for (let i = 1; i < prices.length; i++) {
        if (prices[i].close > 0 && prices[i - 1].close > 0) {
          const lr = Math.log(prices[i].close / prices[i - 1].close);
          const dateStr = typeof prices[i].date === 'string'
            ? prices[i].date.slice(0, 10)
            : new Date(prices[i].date).toISOString().slice(0, 10);
          logReturnsBySymbol[symbol].set(dateStr, lr);
          allDates.add(dateStr);
        }
      }
    }

    // Build aligned return arrays for each pair
    const sortedDates = Array.from(allDates).sort();

    // Only include symbols that have sufficient data
    const symbols = Object.keys(logReturnsBySymbol).filter(
      s => logReturnsBySymbol[s].size >= 10
    );

    // Order: tracked commodities first (in COMMODITY_LABELS order), then equities
    const commodityOrder = Object.keys(COMMODITY_LABELS);
    const orderedSymbols = [
      ...commodityOrder.filter(s => symbols.includes(s)),
      ...equityTickers.filter(s => symbols.includes(s)),
    ];

    const labels = orderedSymbols.map(s => COMMODITY_LABELS[s] || s);

    // Compute NxN correlation matrix
    const n = orderedSymbols.length;
    const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1;
      for (let j = i + 1; j < n; j++) {
        const retI = logReturnsBySymbol[orderedSymbols[i]];
        const retJ = logReturnsBySymbol[orderedSymbols[j]];
        // Build aligned arrays
        const xArr: number[] = [];
        const yArr: number[] = [];
        for (const d of sortedDates) {
          const xi = retI.get(d);
          const yi = retJ.get(d);
          if (xi !== undefined && yi !== undefined) {
            xArr.push(xi);
            yArr.push(yi);
          }
        }
        const corr = pearsonCorrelation(xArr, yArr);
        matrix[i][j] = Math.round(corr * 100) / 100;
        matrix[j][i] = Math.round(corr * 100) / 100;
      }
    }

    return NextResponse.json({
      tickers: orderedSymbols,
      labels,
      matrix,
      period: days,
      count: orderedSymbols.length,
    });
  } catch (err) {
    console.error("[COMMODITIES CORRELATION API]", err);
    return NextResponse.json(
      { error: "Failed to compute commodity correlations" },
      { status: 500 }
    );
  }
}
