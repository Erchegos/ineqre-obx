import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';

/**
 * GET /api/alpha/signals/[ticker]?days=1825
 * Signal history + price data with technical context (SMA200, SMA50, volume),
 * fundamental context (EP, BM, DY, EV/EBITDA), and regime context.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    const { ticker } = await params;
    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get('days') || '1825');

    // 1. Signals
    const result = await pool.query(`
      SELECT s.signal_date, s.model_id, s.signal_value, s.predicted_return,
             s.confidence, s.feature_importance, s.horizon
      FROM alpha_signals s
      WHERE s.ticker = $1
        AND s.signal_date >= CURRENT_DATE - $2 * INTERVAL '1 day'
      ORDER BY s.signal_date DESC, s.model_id
    `, [ticker.toUpperCase(), days]);

    // 2. Price data with SMA200, SMA50, SMA20, volume, and relative position
    //    Need extra 200 days lookback for SMA calculation
    const returnsRes = await pool.query(`
      WITH raw AS (
        SELECT date, open, high, low, close, volume
        FROM prices_daily
        WHERE ticker = $1
          AND date >= CURRENT_DATE - ($2 + 250) * INTERVAL '1 day'
        ORDER BY date
      ),
      with_sma AS (
        SELECT date, open, high, low, close, volume,
          AVG(close) OVER (ORDER BY date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS sma200,
          AVG(close) OVER (ORDER BY date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS sma50,
          AVG(close) OVER (ORDER BY date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS sma20,
          AVG(volume) OVER (ORDER BY date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS avg_vol_20,
          close / LAG(close, 1) OVER (ORDER BY date) - 1 AS daily_return,
          close / LAG(close, 5) OVER (ORDER BY date) - 1 AS weekly_return,
          close / LAG(close, 21) OVER (ORDER BY date) - 1 AS monthly_return,
          -- True Range for ATR
          GREATEST(
            high - low,
            ABS(high - LAG(close, 1) OVER (ORDER BY date)),
            ABS(low - LAG(close, 1) OVER (ORDER BY date))
          ) AS true_range,
          -- 52-week high/low
          MAX(high) OVER (ORDER BY date ROWS BETWEEN 251 PRECEDING AND CURRENT ROW) AS high_52w,
          MIN(low) OVER (ORDER BY date ROWS BETWEEN 251 PRECEDING AND CURRENT ROW) AS low_52w,
          ROW_NUMBER() OVER (ORDER BY date) AS rn
        FROM raw
      ),
      with_atr AS (
        SELECT *,
          AVG(true_range) OVER (ORDER BY date ROWS BETWEEN 13 PRECEDING AND CURRENT ROW) AS atr14
        FROM with_sma
      )
      SELECT date, open::float, high::float, low::float, close, volume,
             sma200::float, sma50::float, sma20::float,
             daily_return::float, weekly_return::float, monthly_return::float,
             atr14::float,
             CASE WHEN sma200 > 0 THEN (close / sma200 - 1)::float ELSE NULL END AS dist_sma200,
             CASE WHEN avg_vol_20 > 0 THEN (volume / avg_vol_20)::float ELSE NULL END AS rel_volume,
             CASE WHEN high_52w > low_52w THEN ((close - low_52w) / (high_52w - low_52w))::float ELSE NULL END AS pct_52w_range
      FROM with_atr
      WHERE rn > 200 AND date >= CURRENT_DATE - $2 * INTERVAL '1 day'
      ORDER BY date DESC
    `, [ticker.toUpperCase(), days]);

    // 3. Fundamental context (latest available)
    const fundRes = await pool.query(`
      SELECT date, ep::float, bm::float, dy::float, sp::float,
             ev_ebitda::float, mktcap::float
      FROM factor_fundamentals
      WHERE ticker = $1
      ORDER BY date DESC LIMIT 1
    `, [ticker.toUpperCase()]);

    // 4. Sector averages for relative valuation
    const stockInfo = await pool.query(`
      SELECT sector FROM stocks WHERE ticker = $1 LIMIT 1
    `, [ticker.toUpperCase()]);
    const sector = stockInfo.rows[0]?.sector || '';

    let sectorAvg = null;
    if (sector) {
      const sectorRes = await pool.query(`
        SELECT
          AVG(f.ep)::float AS avg_ep,
          AVG(f.bm)::float AS avg_bm,
          AVG(f.dy)::float AS avg_dy,
          AVG(f.ev_ebitda)::float AS avg_ev_ebitda
        FROM (
          SELECT DISTINCT ON (ticker) ticker, ep, bm, dy, ev_ebitda
          FROM factor_fundamentals
          WHERE ticker IN (SELECT ticker FROM stocks WHERE sector = $1)
          ORDER BY ticker, date DESC
        ) f
      `, [sector]);
      sectorAvg = sectorRes.rows[0] || null;
    }

    // 5. Volatility regime (latest)
    const regimeRes = await pool.query(`
      WITH rets AS (
        SELECT date, close / LAG(close, 1) OVER (ORDER BY date) - 1 AS ret
        FROM prices_daily WHERE ticker = $1 ORDER BY date
      )
      SELECT
        STDDEV(ret) OVER (ORDER BY date ROWS BETWEEN 20 PRECEDING AND CURRENT ROW) AS vol_21d,
        STDDEV(ret) OVER (ORDER BY date ROWS BETWEEN 62 PRECEDING AND CURRENT ROW) AS vol_63d
      FROM rets
      ORDER BY date DESC LIMIT 1
    `, [ticker.toUpperCase()]);

    return secureJsonResponse({
      ticker: ticker.toUpperCase(),
      sector,
      days,
      signals: result.rows,
      actualReturns: returnsRes.rows,
      fundamentals: fundRes.rows[0] || null,
      sectorAvg,
      volatility: regimeRes.rows[0] || null,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch ticker signals');
  }
}
