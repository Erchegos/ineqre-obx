import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';

/**
 * GET /api/alpha/hit-rates?model=yggdrasil_v7&minSignals=15&minAvgReturn=0
 * Returns per-ticker directional hit rates with positive alpha only.
 * Hit rate = correct direction prediction on 21-day forward returns.
 * Only includes tickers with avg return > 0 (pure alpha generators).
 */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const model = url.searchParams.get('model') || 'yggdrasil_v7';
    const minSignals = parseInt(url.searchParams.get('minSignals') || '15');
    const buyThreshold = parseFloat(url.searchParams.get('buyThreshold') || '0.55');
    const sellThreshold = parseFloat(url.searchParams.get('sellThreshold') || '0.45');

    const result = await pool.query(`
      WITH sig_with_fwd AS (
        SELECT
          s.ticker,
          s.signal_date,
          s.confidence,
          (
            SELECT (p_fwd.close - p_now.close) / NULLIF(p_now.close, 0)
            FROM prices_daily p_now
            CROSS JOIN LATERAL (
              SELECT close FROM prices_daily
              WHERE ticker = s.ticker AND date > p_now.date
              ORDER BY date LIMIT 1 OFFSET 14
            ) p_fwd
            WHERE p_now.ticker = s.ticker AND p_now.date = s.signal_date
          ) AS fwd_return
        FROM alpha_signals s
        WHERE s.model_id = $1
          AND s.confidence >= 0.05
      ),
      actionable AS (
        SELECT *,
          CASE
            WHEN confidence > $2 THEN 'buy'
            WHEN confidence < $3 THEN 'sell'
            ELSE 'neutral'
          END AS direction
        FROM sig_with_fwd
        WHERE fwd_return IS NOT NULL
          AND (confidence > $2 OR confidence < $3)
      ),
      ticker_stats AS (
        SELECT
          ticker,
          COUNT(*) AS total_signals,
          SUM(CASE
            WHEN direction = 'buy' AND fwd_return > 0 THEN 1
            WHEN direction = 'sell' AND fwd_return < 0 THEN 1
            ELSE 0
          END)::float / COUNT(*) AS hit_rate,
          AVG(CASE
            WHEN direction = 'buy' THEN fwd_return
            WHEN direction = 'sell' THEN -fwd_return
          END) AS avg_return,
          SUM(CASE WHEN direction = 'buy' THEN 1 ELSE 0 END) AS buy_signals,
          SUM(CASE WHEN direction = 'sell' THEN 1 ELSE 0 END) AS sell_signals
        FROM actionable
        GROUP BY ticker
        HAVING COUNT(*) >= $4
      )
      SELECT ticker, total_signals::int,
             ROUND(hit_rate::numeric, 4)::float AS hit_rate,
             ROUND(avg_return::numeric, 4)::float AS avg_return,
             buy_signals::int, sell_signals::int,
             st.name AS stock_name, st.sector
      FROM ticker_stats
      LEFT JOIN stocks st USING (ticker)
      WHERE avg_return > 0
      ORDER BY hit_rate DESC
    `, [model, buyThreshold, sellThreshold, minSignals]);

    return secureJsonResponse({
      model,
      buyThreshold,
      sellThreshold,
      minSignals,
      count: result.rows.length,
      stocks: result.rows,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to compute hit rates');
  }
}
