import { pool } from "@/lib/db";
import StocksContent from "./StocksContent";

export const dynamic = "force-dynamic";

async function getEquityStocks() {
  try {
    const result = await pool.query(
      `
      WITH latest_prices AS (
        SELECT DISTINCT ON (p.ticker)
          p.ticker,
          p.close       AS last_close,
          p.adj_close   AS last_adj_close,
          p.date        AS end_date
        FROM prices_daily p
        INNER JOIN stocks s ON s.ticker = p.ticker
        WHERE s.asset_type = ANY($1)
          AND p.close IS NOT NULL
          AND p.close > 0
        ORDER BY p.ticker, p.date DESC
      ),
      price_stats AS (
        SELECT
          p.ticker,
          MIN(p.date) AS start_date,
          COUNT(*)    AS rows
        FROM prices_daily p
        INNER JOIN stocks s ON s.ticker = p.ticker
        WHERE s.asset_type = ANY($1)
          AND p.close IS NOT NULL
          AND p.close > 0
        GROUP BY p.ticker
        HAVING COUNT(*) >= 100
      ),
      latest_mktcap AS (
        SELECT DISTINCT ON (ff.ticker)
          ff.ticker,
          ff.mktcap
        FROM factor_fundamentals ff
        WHERE ff.mktcap IS NOT NULL
        ORDER BY ff.ticker, ff.date DESC
      )
      SELECT
        s.ticker,
        s.name,
        s.asset_type,
        s.sector,
        s.currency,
        lp.last_close,
        COALESCE(lp.last_adj_close, lp.last_close) AS last_adj_close,
        ps.start_date,
        lp.end_date,
        ps.rows,
        lm.mktcap
      FROM stocks s
      INNER JOIN latest_prices lp ON lp.ticker = s.ticker
      INNER JOIN price_stats   ps ON ps.ticker  = s.ticker
      LEFT  JOIN latest_mktcap lm ON lm.ticker  = s.ticker
      WHERE s.asset_type = ANY($1)
      ORDER BY s.ticker
      `,
      [["equity"]]
    );

    return result.rows.map((row) => ({
      ticker: row.ticker,
      name: row.name || row.ticker,
      asset_type: row.asset_type || "equity",
      sector: row.sector || null,
      currency: row.currency || "NOK",
      last_close: Number(row.last_close || 0),
      last_adj_close: row.last_adj_close ? Number(row.last_adj_close) : Number(row.last_close || 0),
      start_date: row.start_date instanceof Date
        ? row.start_date.toISOString().slice(0, 10)
        : String(row.start_date).slice(0, 10),
      end_date: row.end_date instanceof Date
        ? row.end_date.toISOString().slice(0, 10)
        : String(row.end_date).slice(0, 10),
      rows: Number(row.rows),
      mktcap: row.mktcap ? Number(row.mktcap) : null,
    }));
  } catch {
    return [];
  }
}

async function getFactorTickers(): Promise<string[]> {
  try {
    const result = await pool.query<{ ticker: string }>(`
      SELECT ft_agg.ticker
      FROM (
        SELECT ticker FROM factor_technical GROUP BY ticker HAVING COUNT(*) >= 100
      ) ft_agg
      INNER JOIN LATERAL (
        SELECT 1 FROM factor_technical ft2
        WHERE ft2.ticker = ft_agg.ticker
          AND ft2.beta IS NOT NULL AND ft2.ivol IS NOT NULL
        ORDER BY ft2.date DESC LIMIT 1
      ) beta_check ON true
      INNER JOIN LATERAL (
        SELECT 1 FROM factor_fundamentals ff
        WHERE ff.ticker = ft_agg.ticker
          AND ff.bm IS NOT NULL AND ff.mktcap IS NOT NULL AND ff.nokvol IS NOT NULL
        ORDER BY ff.date DESC LIMIT 1
      ) fund_check ON true
      ORDER BY ft_agg.ticker
    `);
    return result.rows.map((r) => r.ticker);
  } catch {
    return [];
  }
}

async function getBacktestTickers(): Promise<string[]> {
  try {
    const result = await pool.query<{ ticker: string }>(`
      SELECT DISTINCT bp.ticker
      FROM backtest_predictions bp
      WHERE bp.backtest_run_id = (
        SELECT id FROM backtest_runs ORDER BY created_at DESC LIMIT 1
      )
      ORDER BY bp.ticker
    `);
    return result.rows.map((r) => r.ticker);
  } catch {
    return [];
  }
}

export default async function StocksPage() {
  const [initialStocks, initialFactorTickers, initialBacktestTickers] = await Promise.all([
    getEquityStocks(),
    getFactorTickers(),
    getBacktestTickers(),
  ]);

  return (
    <StocksContent
      initialStocks={initialStocks}
      initialFactorTickers={initialFactorTickers}
      initialBacktestTickers={initialBacktestTickers}
    />
  );
}
