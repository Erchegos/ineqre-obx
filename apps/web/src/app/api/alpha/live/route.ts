import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAlphaAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';

export const maxDuration = 30;

const STOP_PCT = 5.0;
const TP_PCT = 15.0;
const MAX_HOLD_DAYS = 21;
const MIN_HOLD_DAYS = 3;
const PROFILE = 'oslettebak'; // requireAlphaAuth enforces this

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS live_trade_signals (
      id SERIAL PRIMARY KEY,
      profile TEXT NOT NULL DEFAULT 'oslettebak',
      ticker TEXT NOT NULL,
      name TEXT,
      entry_price NUMERIC(12, 4) NOT NULL,
      stop_price NUMERIC(12, 4) NOT NULL,
      tp_price NUMERIC(12, 4) NOT NULL,
      min_exit_date DATE NOT NULL,
      max_exit_date DATE NOT NULL,
      ml_pred NUMERIC(8, 6),
      status TEXT NOT NULL DEFAULT 'open',
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      exit_price NUMERIC(12, 4),
      exit_reason TEXT,
      pnl_pct NUMERIC(8, 4)
    )
  `);
}

export async function GET(req: NextRequest) {
  const authError = requireAlphaAuth(req);
  if (authError) return authError;

  try {
    await ensureTable();

    // 1. Top 20 liquid OSE stocks with current ML signal
    const signalRes = await pool.query(`
      SELECT
        s.ticker, s.name, s.sector,
        mp.ensemble_prediction::float * 100 AS ml_pred,
        mp.prediction_date::text AS prediction_date,
        pd.close::float AS last_close,
        COALESCE(ff.avg_nokvol, 0)::float AS avg_nokvol
      FROM (
        SELECT DISTINCT ON (ticker) ticker, ensemble_prediction, prediction_date
        FROM ml_predictions
        WHERE ensemble_prediction IS NOT NULL
        ORDER BY ticker, prediction_date DESC
      ) mp
      JOIN stocks s ON mp.ticker = s.ticker
      JOIN (
        SELECT DISTINCT ON (ticker) ticker, close
        FROM prices_daily
        WHERE close > 0
        ORDER BY ticker, date DESC
      ) pd ON pd.ticker = mp.ticker
      LEFT JOIN (
        SELECT ticker, AVG(nokvol::float) AS avg_nokvol
        FROM factor_fundamentals
        WHERE date >= NOW() - INTERVAL '3 months'
          AND nokvol IS NOT NULL AND nokvol::float > 0
        GROUP BY ticker
        HAVING AVG(nokvol::float) > 100000
      ) ff ON ff.ticker = mp.ticker
      WHERE (s.asset_type = 'equity' OR s.asset_type IS NULL)
        AND (s.currency = 'NOK' OR s.currency IS NULL)
        AND mp.ticker NOT LIKE '%.%'
        AND ff.avg_nokvol IS NOT NULL
      ORDER BY ff.avg_nokvol DESC
      LIMIT 20
    `);

    // 2. Open positions with latest price
    const posRes = await pool.query(`
      SELECT
        lts.id,
        lts.ticker,
        lts.name,
        lts.entry_price::float,
        lts.stop_price::float,
        lts.tp_price::float,
        lts.min_exit_date::text,
        lts.max_exit_date::text,
        lts.ml_pred::float,
        lts.accepted_at::text,
        GREATEST(EXTRACT(DAY FROM NOW() - lts.accepted_at)::int, 0) AS days_held,
        pd.close::float AS current_close,
        pd.date::text AS price_date
      FROM live_trade_signals lts
      LEFT JOIN (
        SELECT DISTINCT ON (ticker) ticker, close, date
        FROM prices_daily WHERE close > 0
        ORDER BY ticker, date DESC
      ) pd ON pd.ticker = lts.ticker
      WHERE lts.profile = $1 AND lts.status = 'open'
      ORDER BY lts.accepted_at DESC
    `, [PROFILE]);

    const positions = posRes.rows.map(r => ({
      ...r,
      pnl_pct: r.current_close && r.entry_price
        ? ((r.current_close - r.entry_price) / r.entry_price) * 100
        : null,
    }));

    // 3. Closed trades (last 30)
    const closedRes = await pool.query(`
      SELECT
        id, ticker, name,
        entry_price::float, exit_price::float, pnl_pct::float,
        accepted_at::text, closed_at::text, exit_reason, ml_pred::float,
        GREATEST(EXTRACT(DAY FROM closed_at - accepted_at)::int, 0) AS days_held
      FROM live_trade_signals
      WHERE profile = $1 AND status = 'closed'
      ORDER BY closed_at DESC
      LIMIT 30
    `, [PROFILE]);

    return secureJsonResponse({
      signals: signalRes.rows,
      positions,
      closed: closedRes.rows,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch live trading data');
  }
}

export async function POST(req: NextRequest) {
  const authError = requireAlphaAuth(req);
  if (authError) return authError;

  try {
    await ensureTable();

    const body = await req.json();
    const { action } = body;

    if (action === 'enter') {
      const { ticker, name, entry_price, ml_pred } = body;
      if (!ticker || !entry_price) {
        return secureJsonResponse({ error: 'Missing required fields' }, { status: 400 });
      }

      const ep = Number(entry_price);
      const stopPrice = ep * (1 - STOP_PCT / 100);
      const tpPrice = ep * (1 + TP_PCT / 100);
      const minExitDate = new Date();
      minExitDate.setDate(minExitDate.getDate() + MIN_HOLD_DAYS);
      const maxExitDate = new Date();
      maxExitDate.setDate(maxExitDate.getDate() + MAX_HOLD_DAYS);

      // Prevent duplicate open position
      const existing = await pool.query(
        `SELECT id FROM live_trade_signals WHERE profile = $1 AND ticker = $2 AND status = 'open'`,
        [PROFILE, ticker]
      );
      if (existing.rows.length > 0) {
        return secureJsonResponse({ error: 'Position already open for this ticker' }, { status: 409 });
      }

      await pool.query(`
        INSERT INTO live_trade_signals
          (profile, ticker, name, entry_price, stop_price, tp_price, min_exit_date, max_exit_date, ml_pred, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open')
      `, [PROFILE, ticker, name || ticker, ep, stopPrice, tpPrice,
          minExitDate.toISOString().slice(0, 10),
          maxExitDate.toISOString().slice(0, 10),
          ml_pred ?? null]);

      return secureJsonResponse({ ok: true });
    }

    if (action === 'close') {
      const { id, exit_price, exit_reason } = body;
      if (!id) return secureJsonResponse({ error: 'Missing id' }, { status: 400 });

      const posRes = await pool.query(
        `SELECT entry_price::float FROM live_trade_signals WHERE id = $1 AND profile = $2 AND status = 'open'`,
        [id, PROFILE]
      );
      if (!posRes.rows.length) {
        return secureJsonResponse({ error: 'Position not found' }, { status: 404 });
      }

      const entryPrice = posRes.rows[0].entry_price;
      const exitPriceNum = exit_price ? Number(exit_price) : entryPrice;
      const pnlPct = ((exitPriceNum - entryPrice) / entryPrice) * 100;

      await pool.query(`
        UPDATE live_trade_signals
        SET status = 'closed', closed_at = NOW(), exit_price = $1, exit_reason = $2, pnl_pct = $3
        WHERE id = $4 AND profile = $5 AND status = 'open'
      `, [exitPriceNum, exit_reason || 'manual', pnlPct, id, PROFILE]);

      return secureJsonResponse({ ok: true });
    }

    if (action === 'check_rules') {
      // Apply stop/TP/time rules to all open positions using latest close prices
      const openRes = await pool.query(`
        SELECT
          lts.id, lts.ticker,
          lts.entry_price::float, lts.stop_price::float, lts.tp_price::float,
          GREATEST(EXTRACT(DAY FROM NOW() - lts.accepted_at)::int, 0) AS days_held,
          pd.close::float AS current_close
        FROM live_trade_signals lts
        LEFT JOIN (
          SELECT DISTINCT ON (ticker) ticker, close
          FROM prices_daily WHERE close > 0
          ORDER BY ticker, date DESC
        ) pd ON pd.ticker = lts.ticker
        WHERE lts.profile = $1 AND lts.status = 'open'
      `, [PROFILE]);

      const triggered = [];

      for (const pos of openRes.rows) {
        const { id, entry_price, stop_price, tp_price, current_close, days_held } = pos;
        if (!current_close) continue;

        const minHoldMet = days_held >= MIN_HOLD_DAYS;
        let exitReason: string | null = null;

        if (minHoldMet && current_close <= stop_price) exitReason = 'stop';
        else if (minHoldMet && current_close >= tp_price) exitReason = 'tp';
        else if (days_held >= MAX_HOLD_DAYS) exitReason = 'time';

        if (exitReason) {
          const pnlPct = ((current_close - entry_price) / entry_price) * 100;
          await pool.query(`
            UPDATE live_trade_signals
            SET status = 'closed', closed_at = NOW(), exit_price = $1, exit_reason = $2, pnl_pct = $3
            WHERE id = $4
          `, [current_close, exitReason, pnlPct, id]);
          triggered.push({ id, ticker: pos.ticker, exitReason, pnlPct: pnlPct.toFixed(2) });
        }
      }

      return secureJsonResponse({ ok: true, triggered });
    }

    return secureJsonResponse({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return safeErrorResponse(error, 'Live trading action failed');
  }
}
