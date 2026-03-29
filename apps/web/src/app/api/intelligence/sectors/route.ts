/**
 * Sector Heatmap API
 * GET /api/intelligence/sectors
 *
 * Returns sector-level performance aggregated from latest daily returns.
 * Each sector includes: avg return, stock count, top gainer/loser, and per-stock breakdown.
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await pool.query(`
      WITH latest_two AS (
        SELECT
          pd.ticker,
          pd.close::float,
          pd.date,
          pd.inserted_at,
          ROW_NUMBER() OVER (PARTITION BY pd.ticker ORDER BY pd.date DESC) AS rn
        FROM prices_daily pd
        JOIN stocks s ON s.ticker = pd.ticker AND s.asset_type = 'equity'
        WHERE pd.close IS NOT NULL
          AND pd.date > NOW() - INTERVAL '10 days'
          AND EXTRACT(DOW FROM pd.date) NOT IN (0, 6)
      ),
      latest_mktcap AS (
        SELECT DISTINCT ON (ticker)
          ticker,
          mktcap::float
        FROM factor_fundamentals
        WHERE mktcap IS NOT NULL AND mktcap > 0
        ORDER BY ticker, date DESC
      ),
      returns AS (
        SELECT
          t1.ticker,
          s.name,
          s.sector,
          t1.close AS last_close,
          t2.close AS prev_close,
          t1.date AS trade_date,
          t1.inserted_at,
          CASE WHEN t2.close > 0
            THEN ((t1.close - t2.close) / t2.close * 100)::float
            ELSE NULL
          END AS return_pct,
          COALESCE(m.mktcap, 0) AS mktcap
        FROM latest_two t1
        JOIN latest_two t2 ON t2.ticker = t1.ticker AND t2.rn = 2
        JOIN stocks s ON s.ticker = t1.ticker
        LEFT JOIN latest_mktcap m ON m.ticker = t1.ticker
        WHERE t1.rn = 1 AND t2.close > 0 AND s.sector IS NOT NULL
      )
      SELECT
        sector,
        json_agg(json_build_object(
          'ticker', ticker,
          'name', name,
          'returnPct', round(return_pct::numeric, 2),
          'lastClose', last_close,
          'mktcap', mktcap,
          'tradeDate', trade_date,
          'updatedAt', inserted_at
        ) ORDER BY return_pct DESC) AS stocks,
        count(*)::int AS stock_count,
        round(
          CASE
            WHEN SUM(mktcap) > 0 THEN (SUM(return_pct * mktcap) / SUM(mktcap))::numeric
            ELSE avg(return_pct)::numeric
          END, 2
        ) AS avg_return,
        round(max(return_pct)::numeric, 2) AS best_return,
        round(min(return_pct)::numeric, 2) AS worst_return,
        max(CASE WHEN return_pct = (SELECT max(return_pct) FROM returns r2 WHERE r2.sector = returns.sector) THEN ticker END) AS best_ticker,
        max(CASE WHEN return_pct = (SELECT min(return_pct) FROM returns r2 WHERE r2.sector = returns.sector) THEN ticker END) AS worst_ticker,
        count(*) FILTER (WHERE return_pct > 0)::int AS up_count,
        count(*) FILTER (WHERE return_pct < 0)::int AS down_count
      FROM returns
      GROUP BY sector
      ORDER BY avg_return DESC
    `);

    // Get trade date from first result
    let tradeDate: string | null = null;
    for (const row of result.rows) {
      const stocks = row.stocks as { tradeDate: string }[];
      if (stocks?.[0]?.tradeDate) {
        tradeDate = stocks[0].tradeDate;
        break;
      }
    }

    const sectors = result.rows.map(r => ({
      sector: r.sector,
      stockCount: r.stock_count,
      avgReturn: parseFloat(r.avg_return),
      bestReturn: parseFloat(r.best_return),
      worstReturn: parseFloat(r.worst_return),
      bestTicker: r.best_ticker,
      worstTicker: r.worst_ticker,
      upCount: r.up_count,
      downCount: r.down_count,
      stocks: r.stocks,
    }));

    return NextResponse.json({ sectors, tradeDate });
  } catch (err) {
    console.error("[INTELLIGENCE SECTORS]", err);
    return NextResponse.json({ error: "Failed to fetch sector data" }, { status: 500 });
  }
}
