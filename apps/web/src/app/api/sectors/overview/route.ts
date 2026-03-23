/**
 * Sectors Overview API
 * GET /api/sectors/overview
 *
 * Returns per-sector aggregate intelligence: performance, commodity driver,
 * best/worst performer, and average beta.
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { SECTOR_MAP } from "@/lib/sectorMapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMODITY_NAMES: Record<string, string> = {
  "BZ=F":   "Brent Crude",
  "CL=F":   "WTI Crude",
  "NG=F":   "Natural Gas",
  "ALI=F":  "Aluminium",
  "HG=F":   "Copper",
  "GC=F":   "Gold",
  "SI=F":   "Silver",
  "SALMON": "Salmon",
};

async function getCommodityDriver(symbol: string): Promise<{
  symbol: string;
  name: string;
  price: number | null;
  dailyPct: number | null;
  sparkline30d: number[];
} | null> {
  if (!symbol) return null;
  try {
    const r = await pool.query(
      `WITH ordered AS (
        SELECT date, close::float AS close,
          LAG(close::float) OVER (ORDER BY date) AS prev_close,
          ROW_NUMBER() OVER (ORDER BY date DESC) AS rn
        FROM commodity_prices
        WHERE symbol = $1
      )
      SELECT
        (SELECT close FROM ordered WHERE rn = 1) AS latest_close,
        (SELECT prev_close FROM ordered WHERE rn = 1) AS prev_close
      `,
      [symbol]
    );
    const sparkR = await pool.query(
      `SELECT close::float AS close FROM commodity_prices
       WHERE symbol = $1 AND date >= NOW() - INTERVAL '30 days'
       ORDER BY date ASC`,
      [symbol]
    );
    const row = r.rows[0];
    const price = row?.latest_close ?? null;
    const prev = row?.prev_close ?? null;
    const dailyPct = price && prev && prev > 0 ? ((price - prev) / prev) * 100 : null;
    return {
      symbol,
      name: COMMODITY_NAMES[symbol] || symbol,
      price,
      dailyPct,
      sparkline30d: sparkR.rows.map((r: { close: number }) => r.close),
    };
  } catch {
    return null;
  }
}

async function getBDIDriver(): Promise<{
  symbol: string;
  name: string;
  price: number | null;
  dailyPct: number | null;
  sparkline30d: number[];
} | null> {
  try {
    const r = await pool.query(
      `WITH ordered AS (
        SELECT rate_date AS date, rate_value::float AS close,
          LAG(rate_value::float) OVER (ORDER BY rate_date) AS prev_close,
          ROW_NUMBER() OVER (ORDER BY rate_date DESC) AS rn
        FROM shipping_market_rates
        WHERE index_name = 'BDI'
      )
      SELECT
        (SELECT close FROM ordered WHERE rn = 1) AS latest_close,
        (SELECT prev_close FROM ordered WHERE rn = 1) AS prev_close
      `
    );
    const sparkR = await pool.query(
      `SELECT rate_value::float AS close FROM shipping_market_rates
       WHERE index_name = 'BDI' AND rate_date >= NOW() - INTERVAL '30 days'
       ORDER BY rate_date ASC`
    );
    const row = r.rows[0];
    const price = row?.latest_close ?? null;
    const prev = row?.prev_close ?? null;
    const dailyPct = price && prev && prev > 0 ? ((price - prev) / prev) * 100 : null;
    return {
      symbol: "BDI",
      name: "Baltic Dry Index",
      price,
      dailyPct,
      sparkline30d: sparkR.rows.map((r: { close: number }) => r.close),
    };
  } catch {
    return null;
  }
}

async function getSectorStockPerformance(tickers: string[]): Promise<{
  ticker: string;
  name: string;
  dailyPct: number | null;
  weeklyPct: number | null;
  monthlyPct: number | null;
  ytdPct: number | null;
  beta: number | null;
}[]> {
  if (!tickers.length) return [];
  try {
    const r = await pool.query(
      `WITH prices AS (
        SELECT s.ticker, s.name,
          FIRST_VALUE(pd.adj_close::float) OVER (PARTITION BY s.ticker ORDER BY pd.date DESC) AS latest,
          NTH_VALUE(pd.adj_close::float, 2) OVER (PARTITION BY s.ticker ORDER BY pd.date DESC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS prev,
          ROW_NUMBER() OVER (PARTITION BY s.ticker ORDER BY pd.date DESC) AS rn
        FROM prices_daily pd
        JOIN stocks s ON s.id = pd.stock_id
        WHERE upper(s.ticker) = ANY($1::text[])
          AND pd.date >= NOW() - INTERVAL '400 days'
      )
      SELECT ticker, name, latest, prev FROM prices WHERE rn = 1`,
      [tickers.map((t) => t.toUpperCase())]
    );

    // Get weekly, monthly, YTD closes separately
    const weekR = await pool.query(
      `SELECT DISTINCT ON (s.ticker) s.ticker, pd.adj_close::float AS close
       FROM prices_daily pd
       JOIN stocks s ON s.id = pd.stock_id
       WHERE upper(s.ticker) = ANY($1::text[])
         AND pd.date <= NOW() - INTERVAL '5 days'
       ORDER BY s.ticker, pd.date DESC`,
      [tickers.map((t) => t.toUpperCase())]
    );
    const monthR = await pool.query(
      `SELECT DISTINCT ON (s.ticker) s.ticker, pd.adj_close::float AS close
       FROM prices_daily pd
       JOIN stocks s ON s.id = pd.stock_id
       WHERE upper(s.ticker) = ANY($1::text[])
         AND pd.date <= NOW() - INTERVAL '21 days'
       ORDER BY s.ticker, pd.date DESC`,
      [tickers.map((t) => t.toUpperCase())]
    );
    const ytdR = await pool.query(
      `SELECT DISTINCT ON (s.ticker) s.ticker, pd.adj_close::float AS close
       FROM prices_daily pd
       JOIN stocks s ON s.id = pd.stock_id
       WHERE upper(s.ticker) = ANY($1::text[])
         AND pd.date >= date_trunc('year', CURRENT_DATE)
       ORDER BY s.ticker, pd.date ASC`,
      [tickers.map((t) => t.toUpperCase())]
    );

    const weekMap = new Map(weekR.rows.map((r: { ticker: string; close: number }) => [r.ticker.toUpperCase(), r.close]));
    const monthMap = new Map(monthR.rows.map((r: { ticker: string; close: number }) => [r.ticker.toUpperCase(), r.close]));
    const ytdMap = new Map(ytdR.rows.map((r: { ticker: string; close: number }) => [r.ticker.toUpperCase(), r.close]));

    // Get betas from factor_technical
    const betaR = await pool.query(
      `SELECT DISTINCT ON (s.ticker) s.ticker, ft.beta::float
       FROM factor_technical ft
       JOIN stocks s ON s.id = ft.stock_id
       WHERE upper(s.ticker) = ANY($1::text[])
       ORDER BY s.ticker, ft.date DESC`,
      [tickers.map((t) => t.toUpperCase())]
    );
    const betaMap = new Map(betaR.rows.map((r: { ticker: string; beta: number }) => [r.ticker.toUpperCase(), r.beta]));

    const calcPct = (cur: number | null, ref: number | null) =>
      cur && ref && ref > 0 ? ((cur - ref) / ref) * 100 : null;

    return r.rows.map((row: { ticker: string; name: string; latest: number; prev: number }) => {
      const t = row.ticker.toUpperCase();
      return {
        ticker: t,
        name: row.name,
        dailyPct: calcPct(row.latest, row.prev),
        weeklyPct: calcPct(row.latest, weekMap.get(t) ?? null),
        monthlyPct: calcPct(row.latest, monthMap.get(t) ?? null),
        ytdPct: calcPct(row.latest, ytdMap.get(t) ?? null),
        beta: betaMap.get(t) ?? null,
      };
    });
  } catch {
    return [];
  }
}

export async function GET(_req: NextRequest) {
  try {
    const sectorNames = Object.keys(SECTOR_MAP);

    const results = await Promise.all(
      sectorNames.map(async (name) => {
        const def = SECTOR_MAP[name];

        // Get commodity driver
        let commodityDriver = null;
        if (def.primaryCommodity) {
          commodityDriver = await getCommodityDriver(def.primaryCommodity);
        } else if (name === "Shipping") {
          commodityDriver = await getBDIDriver();
        }

        // Get stock performance
        const stocks = await getSectorStockPerformance(def.tickers);

        // Aggregate performance (equal weight over stocks that have data)
        const withDaily = stocks.filter((s) => s.dailyPct !== null);
        const withWeekly = stocks.filter((s) => s.weeklyPct !== null);
        const withMonthly = stocks.filter((s) => s.monthlyPct !== null);
        const withYtd = stocks.filter((s) => s.ytdPct !== null);

        const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

        const performance = {
          daily: avg(withDaily.map((s) => s.dailyPct!)),
          weekly: avg(withWeekly.map((s) => s.weeklyPct!)),
          monthly: avg(withMonthly.map((s) => s.monthlyPct!)),
          ytd: avg(withYtd.map((s) => s.ytdPct!)),
        };

        const avgBeta = avg(stocks.filter((s) => s.beta !== null).map((s) => s.beta!));

        const sorted = [...withDaily].sort((a, b) => (b.dailyPct ?? 0) - (a.dailyPct ?? 0));
        const bestPerformer = sorted[0] ? { ticker: sorted[0].ticker, name: sorted[0].name, dailyPct: sorted[0].dailyPct } : null;
        const worstPerformer = sorted[sorted.length - 1] ? { ticker: sorted[sorted.length - 1].ticker, name: sorted[sorted.length - 1].name, dailyPct: sorted[sorted.length - 1].dailyPct } : null;

        return {
          name,
          color: def.color,
          tickers: def.tickers,
          stockCount: def.tickers.length,
          commodityDriver,
          performance,
          bestPerformer,
          worstPerformer,
          avgBeta,
          topStocks: stocks.slice(0, 6),
        };
      })
    );

    return NextResponse.json({ sectors: results });
  } catch (err) {
    console.error("[SECTORS OVERVIEW API]", err);
    return NextResponse.json({ error: "Failed to fetch sector data" }, { status: 500 });
  }
}
