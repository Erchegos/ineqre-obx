import type { Metadata } from "next";
import { pool } from "@/lib/db";
import HomeContent from "./HomeContent";
import type { SearchStock } from "@/components/StockSearchBar";

export const metadata: Metadata = {
  title: "Intelligence Equity Research — OSE Quant Platform",
  description: "Quantitative equity research platform covering 225+ Oslo Børs securities. ML predictions, GARCH volatility, Monte Carlo simulations, options analytics, portfolio optimization, and broker research.",
};

export const dynamic = "force-dynamic";

type SystemStats = {
  securities: number;
  last_updated: string | null;
  data_points: number;
};

async function getStats(): Promise<SystemStats> {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(DISTINCT ticker_summary.ticker) as securities,
        MAX(ticker_summary.max_date) as last_updated,
        SUM(ticker_summary.record_count) as data_points
      FROM (
        SELECT p.ticker, MAX(p.date) as max_date, COUNT(*) as record_count
        FROM prices_daily p
        INNER JOIN stocks s ON p.ticker = s.ticker
        WHERE p.close IS NOT NULL AND p.close > 0
        GROUP BY p.ticker
        HAVING COUNT(*) >= 100
      ) ticker_summary
    `);
    return {
      securities: Number(result.rows[0]?.securities || 0),
      last_updated: result.rows[0]?.last_updated ?? null,
      data_points: Number(result.rows[0]?.data_points || 0),
    };
  } catch {
    return { securities: 0, last_updated: null, data_points: 0 };
  }
}

async function getStocks(): Promise<SearchStock[]> {
  try {
    const result = await pool.query(`
      WITH latest_two AS (
        SELECT
          p.ticker,
          p.close,
          ROW_NUMBER() OVER (PARTITION BY p.ticker ORDER BY p.date DESC) AS rn
        FROM prices_daily p
        INNER JOIN stocks s ON s.ticker = p.ticker
        WHERE s.asset_type = 'equity'
          AND p.close IS NOT NULL AND p.close > 0
      ),
      price_info AS (
        SELECT
          ticker,
          MAX(CASE WHEN rn = 1 THEN close END) AS last_close,
          MAX(CASE WHEN rn = 2 THEN close END) AS prev_close
        FROM latest_two
        WHERE rn <= 2
        GROUP BY ticker
      ),
      latest_mktcap AS (
        SELECT DISTINCT ON (ff.ticker) ff.ticker, ff.mktcap
        FROM factor_fundamentals ff
        WHERE ff.mktcap IS NOT NULL
        ORDER BY ff.ticker, ff.date DESC
      )
      SELECT
        s.ticker,
        s.name,
        s.sector,
        pi.last_close,
        pi.prev_close,
        lm.mktcap
      FROM stocks s
      INNER JOIN price_info pi ON pi.ticker = s.ticker
      LEFT JOIN latest_mktcap lm ON lm.ticker = s.ticker
      WHERE s.asset_type = 'equity'
      ORDER BY s.ticker
    `);
    return result.rows.map((r) => ({
      ticker: r.ticker,
      name: r.name || r.ticker,
      sector: r.sector || null,
      last_close: Number(r.last_close || 0),
      prev_close: r.prev_close ? Number(r.prev_close) : null,
      mktcap: r.mktcap ? Number(r.mktcap) : null,
    }));
  } catch {
    return [];
  }
}

export default async function Page() {
  const [stats, stocks] = await Promise.all([getStats(), getStocks()]);
  return <HomeContent stats={stats} stocks={stocks} />;
}
