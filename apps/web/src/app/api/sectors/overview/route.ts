/**
 * Sectors Overview API
 * GET /api/sectors/overview
 *
 * Returns per-sector aggregate intelligence: multi-period performance,
 * commodity driver, best/worst performer, average beta, and top stocks.
 *
 * Uses ticker-based joins (same pattern as /api/intelligence/sectors).
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
  mktcap: number | null;
}[]> {
  if (!tickers.length) return [];
  try {
    // Single efficient query: get latest 2 prices for daily return + reference prices for weekly/monthly/ytd
    const r = await pool.query(
      `WITH latest_two AS (
        SELECT
          pd.ticker,
          pd.close::float,
          pd.adj_close::float AS adj_close,
          pd.date,
          ROW_NUMBER() OVER (PARTITION BY pd.ticker ORDER BY pd.date DESC) AS rn
        FROM prices_daily pd
        WHERE pd.ticker = ANY($1)
          AND pd.close IS NOT NULL AND pd.close > 0
          AND pd.date > NOW() - INTERVAL '10 days'
      ),
      week_ref AS (
        SELECT DISTINCT ON (pd.ticker) pd.ticker, pd.adj_close::float AS close
        FROM prices_daily pd
        WHERE pd.ticker = ANY($1)
          AND pd.close > 0
          AND pd.date <= NOW() - INTERVAL '5 days'
        ORDER BY pd.ticker, pd.date DESC
      ),
      month_ref AS (
        SELECT DISTINCT ON (pd.ticker) pd.ticker, pd.adj_close::float AS close
        FROM prices_daily pd
        WHERE pd.ticker = ANY($1)
          AND pd.close > 0
          AND pd.date <= NOW() - INTERVAL '21 days'
        ORDER BY pd.ticker, pd.date DESC
      ),
      ytd_ref AS (
        SELECT DISTINCT ON (pd.ticker) pd.ticker, pd.adj_close::float AS close
        FROM prices_daily pd
        WHERE pd.ticker = ANY($1)
          AND pd.close > 0
          AND pd.date >= date_trunc('year', CURRENT_DATE)
        ORDER BY pd.ticker, pd.date ASC
      ),
      latest_beta AS (
        SELECT DISTINCT ON (ft.ticker) ft.ticker, ft.beta::float
        FROM factor_technical ft
        WHERE ft.ticker = ANY($1) AND ft.beta IS NOT NULL
        ORDER BY ft.ticker, ft.date DESC
      ),
      latest_mktcap AS (
        SELECT DISTINCT ON (ff.ticker) ff.ticker, ff.mktcap::float
        FROM factor_fundamentals ff
        WHERE ff.ticker = ANY($1) AND ff.mktcap IS NOT NULL
        ORDER BY ff.ticker, ff.date DESC
      )
      SELECT
        t1.ticker,
        s.name,
        COALESCE(t1.adj_close, t1.close) AS latest,
        COALESCE(t2.adj_close, t2.close) AS prev,
        wr.close AS week_close,
        mr.close AS month_close,
        yr.close AS ytd_close,
        lb.beta,
        lm.mktcap
      FROM latest_two t1
      JOIN latest_two t2 ON t2.ticker = t1.ticker AND t2.rn = 2
      JOIN stocks s ON s.ticker = t1.ticker
      LEFT JOIN week_ref wr ON wr.ticker = t1.ticker
      LEFT JOIN month_ref mr ON mr.ticker = t1.ticker
      LEFT JOIN ytd_ref yr ON yr.ticker = t1.ticker
      LEFT JOIN latest_beta lb ON lb.ticker = t1.ticker
      LEFT JOIN latest_mktcap lm ON lm.ticker = t1.ticker
      WHERE t1.rn = 1`,
      [tickers]
    );

    const calcPct = (cur: number | null, ref: number | null) =>
      cur && ref && ref > 0 ? ((cur - ref) / ref) * 100 : null;

    return r.rows.map((row: {
      ticker: string; name: string; latest: number; prev: number;
      week_close: number | null; month_close: number | null; ytd_close: number | null;
      beta: number | null; mktcap: number | null;
    }) => ({
      ticker: row.ticker,
      name: row.name,
      dailyPct: calcPct(row.latest, row.prev),
      weeklyPct: calcPct(row.latest, row.week_close),
      monthlyPct: calcPct(row.latest, row.month_close),
      ytdPct: calcPct(row.latest, row.ytd_close),
      beta: row.beta,
      mktcap: row.mktcap,
    }));
  } catch (e) {
    console.error("[SECTOR STOCK PERF]", e);
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
          topStocks: [...stocks].sort((a, b) => (b.mktcap ?? 0) - (a.mktcap ?? 0)).slice(0, 10),
        };
      })
    );

    return NextResponse.json({ sectors: results });
  } catch (err) {
    console.error("[SECTORS OVERVIEW API]", err);
    return NextResponse.json({ error: "Failed to fetch sector data" }, { status: 500 });
  }
}
