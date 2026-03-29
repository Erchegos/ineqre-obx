import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAlphaAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';

export const maxDuration = 30;

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
      trailing_stop_pct NUMERIC(6, 2),
      trailing_high NUMERIC(12, 4),
      min_exit_date DATE NOT NULL,
      max_exit_date DATE NOT NULL,
      ml_pred NUMERIC(8, 6),
      pos_size_pct NUMERIC(6, 2),
      cost_bps INT,
      status TEXT NOT NULL DEFAULT 'open',
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      exit_price NUMERIC(12, 4),
      exit_reason TEXT,
      pnl_pct NUMERIC(8, 4),
      gross_pnl_pct NUMERIC(8, 4)
    )
  `);
  // Migration: add columns incrementally
  await pool.query(`ALTER TABLE live_trade_signals ADD COLUMN IF NOT EXISTS trailing_high NUMERIC(12,4)`);
  await pool.query(`ALTER TABLE live_trade_signals ADD COLUMN IF NOT EXISTS trailing_stop_pct NUMERIC(6,2)`);
  await pool.query(`ALTER TABLE live_trade_signals ADD COLUMN IF NOT EXISTS pos_size_pct NUMERIC(6,2)`);
  await pool.query(`ALTER TABLE live_trade_signals ADD COLUMN IF NOT EXISTS cost_bps INT`);
  await pool.query(`ALTER TABLE live_trade_signals ADD COLUMN IF NOT EXISTS gross_pnl_pct NUMERIC(8,4)`);
  // Pending order fields
  await pool.query(`ALTER TABLE live_trade_signals ADD COLUMN IF NOT EXISTS order_type TEXT DEFAULT 'MARKET'`);
  await pool.query(`ALTER TABLE live_trade_signals ADD COLUMN IF NOT EXISTS limit_price NUMERIC(12,4)`);
  await pool.query(`ALTER TABLE live_trade_signals ADD COLUMN IF NOT EXISTS tif TEXT DEFAULT 'DAY'`);
  await pool.query(`ALTER TABLE live_trade_signals ADD COLUMN IF NOT EXISTS notes TEXT`);
}

export async function GET(req: NextRequest) {
  const authError = requireAlphaAuth(req);
  if (authError) return authError;

  try {
    await ensureTable();

    const url = new URL(req.url);
    const portfolioOnly = url.searchParams.get('portfolio') === '1';

    // Fast path: skip expensive signal queries, only return portfolio state
    if (portfolioOnly) {
      const pendingRes = await pool.query(`
        SELECT lts.id, lts.ticker, lts.name,
          lts.entry_price::float, lts.limit_price::float,
          lts.stop_price::float, lts.tp_price::float,
          lts.order_type, lts.tif,
          lts.ml_pred::float, lts.pos_size_pct::float,
          lts.accepted_at::text, lts.notes,
          pd.close::float AS current_close
        FROM live_trade_signals lts
        LEFT JOIN (
          SELECT DISTINCT ON (ticker) ticker, close FROM prices_daily WHERE close > 0 ORDER BY ticker, date DESC
        ) pd ON pd.ticker = lts.ticker
        WHERE lts.profile = $1 AND lts.status = 'pending'
        ORDER BY lts.accepted_at DESC
      `, [PROFILE]);

      const posRes = await pool.query(`
        SELECT lts.id, lts.ticker, lts.name,
          lts.entry_price::float, lts.stop_price::float, lts.tp_price::float,
          lts.trailing_stop_pct::float, lts.trailing_high::float,
          lts.min_exit_date::text, lts.max_exit_date::text,
          lts.ml_pred::float, lts.pos_size_pct::float,
          lts.order_type, lts.limit_price::float, lts.accepted_at::text,
          GREATEST(EXTRACT(DAY FROM NOW() - lts.accepted_at)::int, 0) AS days_held,
          pd.close::float AS current_close, pd.date::text AS price_date
        FROM live_trade_signals lts
        LEFT JOIN (
          SELECT DISTINCT ON (ticker) ticker, close, date FROM prices_daily WHERE close > 0 ORDER BY ticker, date DESC
        ) pd ON pd.ticker = lts.ticker
        WHERE lts.profile = $1 AND lts.status = 'open'
        ORDER BY lts.accepted_at DESC
      `, [PROFILE]);

      const closedRes = await pool.query(`
        SELECT id, ticker, name,
          entry_price::float, exit_price::float,
          pnl_pct::float, gross_pnl_pct::float,
          accepted_at::text, closed_at::text, exit_reason, ml_pred::float,
          pos_size_pct::float,
          GREATEST(EXTRACT(DAY FROM closed_at - accepted_at)::int, 0) AS days_held
        FROM live_trade_signals
        WHERE profile = $1 AND status = 'closed'
        ORDER BY closed_at DESC LIMIT 30
      `, [PROFILE]);

      const positions = posRes.rows.map(r => ({
        ...r,
        pnl_pct: r.current_close && r.entry_price ? ((r.current_close - r.entry_price) / r.entry_price) * 100 : null,
        gross_pnl_pct: r.current_close && r.entry_price ? ((r.current_close - r.entry_price) / r.entry_price) * 100 : null,
        effective_stop: r.trailing_stop_pct && r.trailing_high
          ? Math.max(r.stop_price, r.trailing_high * (1 - r.trailing_stop_pct / 100))
          : r.stop_price,
      }));

      const totalExposurePct = positions.reduce((s, p) => s + (p.pos_size_pct ?? 10), 0);
      const totalUnrealizedPnl = positions.reduce((s, p) => s + (p.pnl_pct ?? 0), 0);
      return secureJsonResponse({
        pending: pendingRes.rows,
        positions,
        closed: closedRes.rows,
        portfolio: { totalExposurePct, totalUnrealizedPnl, openCount: positions.length, pendingCount: pendingRes.rows.length, sectorBreakdown: {} },
      });
    }

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

    const tickers: string[] = signalRes.rows.map((r: { ticker: string }) => r.ticker);

    // 2. SMA200 / SMA50 for those tickers (efficient window rank approach)
    const smaRes = await pool.query(`
      SELECT ticker,
        AVG(CASE WHEN rn <= 200 THEN close END) AS sma200,
        AVG(CASE WHEN rn <= 50  THEN close END) AS sma50
      FROM (
        SELECT ticker, close::float,
               ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) AS rn
        FROM prices_daily
        WHERE ticker = ANY($1) AND close > 0
      ) ranked
      WHERE rn <= 200
      GROUP BY ticker
    `, [tickers]);

    // 3. Latest momentum + vol regime from factor_technical
    const ftRes = await pool.query(`
      SELECT DISTINCT ON (ticker)
        ticker,
        mom1m::float, mom6m::float, mom11m::float,
        vol1m::float
      FROM factor_technical
      WHERE ticker = ANY($1)
      ORDER BY ticker, date DESC
    `, [tickers]);

    // Build lookup maps
    const smaMap = new Map<string, { sma200: number; sma50: number }>();
    for (const r of smaRes.rows) smaMap.set(r.ticker, { sma200: r.sma200, sma50: r.sma50 });

    const ftMap = new Map<string, { mom1m: number; mom6m: number; mom11m: number; vol1m: number }>();
    for (const r of ftRes.rows) ftMap.set(r.ticker, r);

    const signals = signalRes.rows.map(r => ({
      ...r,
      sma200: smaMap.get(r.ticker)?.sma200 ?? null,
      sma50: smaMap.get(r.ticker)?.sma50 ?? null,
      mom1m: ftMap.get(r.ticker)?.mom1m ?? null,
      mom6m: ftMap.get(r.ticker)?.mom6m ?? null,
      mom11m: ftMap.get(r.ticker)?.mom11m ?? null,
      vol1m: ftMap.get(r.ticker)?.vol1m ?? null,
    }));

    // 4. Pending orders
    const pendingRes = await pool.query(`
      SELECT
        lts.id, lts.ticker, lts.name,
        lts.entry_price::float, lts.limit_price::float,
        lts.stop_price::float, lts.tp_price::float,
        lts.order_type, lts.tif,
        lts.ml_pred::float, lts.pos_size_pct::float,
        lts.accepted_at::text, lts.notes,
        pd.close::float AS current_close
      FROM live_trade_signals lts
      LEFT JOIN (
        SELECT DISTINCT ON (ticker) ticker, close FROM prices_daily WHERE close > 0 ORDER BY ticker, date DESC
      ) pd ON pd.ticker = lts.ticker
      WHERE lts.profile = $1 AND lts.status = 'pending'
      ORDER BY lts.accepted_at DESC
    `, [PROFILE]);

    // 5. Open positions with latest price + trailing stop logic
    const posRes = await pool.query(`
      SELECT
        lts.id, lts.ticker, lts.name,
        lts.entry_price::float,
        lts.stop_price::float,
        lts.tp_price::float,
        lts.trailing_stop_pct::float,
        lts.trailing_high::float,
        lts.min_exit_date::text,
        lts.max_exit_date::text,
        lts.ml_pred::float,
        lts.pos_size_pct::float,
        lts.order_type, lts.limit_price::float,
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

    const positions = posRes.rows.map(r => {
      const grossPnl = r.current_close && r.entry_price
        ? ((r.current_close - r.entry_price) / r.entry_price) * 100 : null;
      const costPct = r.pos_size_pct ? (((r.lts_cost_bps ?? 10) * 2) / 10000) * 100 : 0;
      return {
        ...r,
        pnl_pct: grossPnl != null ? grossPnl - costPct : null,
        gross_pnl_pct: grossPnl,
        // Effective stop: higher of fixed stop or trailing stop
        effective_stop: r.trailing_stop_pct && r.trailing_high
          ? Math.max(r.stop_price, r.trailing_high * (1 - r.trailing_stop_pct / 100))
          : r.stop_price,
      };
    });

    // 6. Closed trades (last 30)
    const closedRes = await pool.query(`
      SELECT
        id, ticker, name,
        entry_price::float, exit_price::float,
        pnl_pct::float, gross_pnl_pct::float,
        accepted_at::text, closed_at::text, exit_reason, ml_pred::float,
        pos_size_pct::float,
        GREATEST(EXTRACT(DAY FROM closed_at - accepted_at)::int, 0) AS days_held
      FROM live_trade_signals
      WHERE profile = $1 AND status = 'closed'
      ORDER BY closed_at DESC
      LIMIT 30
    `, [PROFILE]);

    // Portfolio stats
    const totalExposurePct = positions.reduce((s, p) => s + (p.pos_size_pct ?? 10), 0);
    const totalUnrealizedPnl = positions.reduce((s, p) => s + (p.pnl_pct ?? 0), 0);
    const sectorBreakdown: Record<string, number> = {};
    for (const p of positions) {
      const sig = signals.find(s => s.ticker === p.ticker);
      if (sig) sectorBreakdown[sig.sector] = (sectorBreakdown[sig.sector] ?? 0) + (p.pos_size_pct ?? 10);
    }

    return secureJsonResponse({
      signals,
      pending: pendingRes.rows,
      positions,
      closed: closedRes.rows,
      portfolio: { totalExposurePct, totalUnrealizedPnl, openCount: positions.length, pendingCount: pendingRes.rows.length, sectorBreakdown },
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
      const {
        ticker, name, entry_price, ml_pred,
        stop_loss_pct = 5.0,
        take_profit_pct = 15.0,
        max_hold_days = 21,
        min_hold_days = 3,
        pos_size_pct = 10.0,
        cost_bps = 10,
        use_trailing_stop = false,
        trailing_stop_pct = 3.0,
        order_type = 'MARKET',  // MARKET | LIMIT | STOP
        limit_price,            // for LIMIT orders — filled when price <= limit_price
        tif = 'DAY',            // DAY | GTC | OPG
        market_is_open = false, // client sends true only if OSE is open
        notes,
      } = body;

      if (!ticker || !entry_price) {
        return secureJsonResponse({ error: 'Missing required fields' }, { status: 400 });
      }

      const ep = Number(entry_price);
      // For LIMIT orders use limit_price as the effective entry price for stop/TP calculation
      const effectiveEp = (order_type === 'LIMIT' && limit_price) ? Number(limit_price) : ep;
      const stopPrice = effectiveEp * (1 - Number(stop_loss_pct) / 100);
      const tpPrice = effectiveEp * (1 + Number(take_profit_pct) / 100);
      const minExitDate = new Date();
      minExitDate.setDate(minExitDate.getDate() + Number(min_hold_days));
      const maxExitDate = new Date();
      maxExitDate.setDate(maxExitDate.getDate() + Number(max_hold_days));

      // Prevent duplicate open or pending position
      const existing = await pool.query(
        `SELECT id, status FROM live_trade_signals WHERE profile = $1 AND ticker = $2 AND status IN ('open', 'pending')`,
        [PROFILE, ticker]
      );
      if (existing.rows.length > 0) {
        return secureJsonResponse({ error: `Position already ${existing.rows[0].status} for ${ticker}` }, { status: 409 });
      }

      // Determine if order should be pending:
      // 1. Market is closed (client-reported) → always pending
      // 2. LIMIT order where current price > limit → pending until price falls to limit
      // 3. OPG TIF → pending until market open
      const currentPrice = Number(entry_price);
      const limitPriceNum = limit_price ? Number(limit_price) : null;
      const priceNotReached = order_type === 'LIMIT' && limitPriceNum && currentPrice > limitPriceNum;
      const isPending = !market_is_open || priceNotReached || tif === 'OPG';

      const finalStatus = isPending ? 'pending' : 'open';

      await pool.query(`
        INSERT INTO live_trade_signals
          (profile, ticker, name, entry_price, limit_price, stop_price, tp_price,
           trailing_stop_pct, trailing_high,
           min_exit_date, max_exit_date, ml_pred, pos_size_pct, cost_bps,
           order_type, tif, notes, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      `, [
        PROFILE, ticker, name || ticker,
        effectiveEp, limitPriceNum,
        stopPrice, tpPrice,
        use_trailing_stop ? Number(trailing_stop_pct) : null,
        use_trailing_stop ? effectiveEp : null,
        minExitDate.toISOString().slice(0, 10),
        maxExitDate.toISOString().slice(0, 10),
        ml_pred ?? null,
        Number(pos_size_pct),
        Number(cost_bps),
        order_type, tif, notes ?? null,
        finalStatus,
      ]);

      return secureJsonResponse({ ok: true, status: finalStatus });
    }

    if (action === 'cancel_pending') {
      const { id } = body;
      if (!id) return secureJsonResponse({ error: 'Missing id' }, { status: 400 });
      await pool.query(
        `UPDATE live_trade_signals SET status = 'cancelled', closed_at = NOW(), exit_reason = 'cancelled'
         WHERE id = $1 AND profile = $2 AND status = 'pending'`,
        [id, PROFILE]
      );
      return secureJsonResponse({ ok: true });
    }

    if (action === 'activate_pending') {
      // Called when market opens or on manual trigger.
      // Activates pending orders where price condition is met.
      const { market_is_open = false } = body;
      if (!market_is_open) {
        return secureJsonResponse({ ok: true, activated: [], message: 'Market closed' });
      }

      const pendingRes = await pool.query(`
        SELECT lts.id, lts.ticker, lts.order_type, lts.limit_price::float,
               lts.entry_price::float, lts.tif,
               pd.close::float AS current_price
        FROM live_trade_signals lts
        LEFT JOIN (
          SELECT DISTINCT ON (ticker) ticker, close FROM prices_daily WHERE close > 0 ORDER BY ticker, date DESC
        ) pd ON pd.ticker = lts.ticker
        WHERE lts.profile = $1 AND lts.status = 'pending'
      `, [PROFILE]);

      const activated = [];
      for (const order of pendingRes.rows) {
        const { id, order_type, limit_price, current_price, tif } = order;
        // DAY orders: cancel if not filled (caller should check at end of day)
        let shouldActivate = false;
        if (order_type === 'MARKET') {
          shouldActivate = true;
        } else if (order_type === 'LIMIT' && limit_price && current_price <= limit_price) {
          shouldActivate = true;
        } else if (order_type === 'STOP' && limit_price && current_price >= limit_price) {
          shouldActivate = true;
        }
        if (shouldActivate) {
          const fillPrice = order_type === 'MARKET' ? current_price : (limit_price ?? current_price);
          await pool.query(
            `UPDATE live_trade_signals SET status = 'open', entry_price = $1,
             stop_price = entry_price * (1 - (stop_price / entry_price - 1)),
             accepted_at = NOW()
             WHERE id = $2`,
            [fillPrice, id]
          );
          activated.push({ id, ticker: order.ticker, fill_price: fillPrice });
        }
      }
      return secureJsonResponse({ ok: true, activated });
    }

    if (action === 'close') {
      const { id, exit_price, exit_reason } = body;
      if (!id) return secureJsonResponse({ error: 'Missing id' }, { status: 400 });

      const posRes = await pool.query(
        `SELECT entry_price::float, pos_size_pct::float, cost_bps
         FROM live_trade_signals WHERE id = $1 AND profile = $2 AND status = 'open'`,
        [id, PROFILE]
      );
      if (!posRes.rows.length) {
        return secureJsonResponse({ error: 'Position not found' }, { status: 404 });
      }

      const { entry_price: entryPrice, cost_bps: costBps } = posRes.rows[0];
      const exitPriceNum = exit_price ? Number(exit_price) : entryPrice;
      const grossPnlPct = ((exitPriceNum - entryPrice) / entryPrice) * 100;
      const totalCostPct = ((Number(costBps ?? 10) * 2) / 10000) * 100;
      const netPnlPct = grossPnlPct - totalCostPct;

      await pool.query(`
        UPDATE live_trade_signals
        SET status = 'closed', closed_at = NOW(), exit_price = $1,
            exit_reason = $2, pnl_pct = $3, gross_pnl_pct = $4
        WHERE id = $5 AND profile = $6 AND status = 'open'
      `, [exitPriceNum, exit_reason || 'manual', netPnlPct, grossPnlPct, id, PROFILE]);

      return secureJsonResponse({ ok: true });
    }

    if (action === 'update_trailing') {
      // Called periodically to update trailing_high for each open position
      const openRes = await pool.query(`
        SELECT lts.id, lts.trailing_stop_pct::float, lts.trailing_high::float,
               pd.close::float AS current_close
        FROM live_trade_signals lts
        LEFT JOIN (
          SELECT DISTINCT ON (ticker) ticker, close FROM prices_daily WHERE close > 0 ORDER BY ticker, date DESC
        ) pd ON pd.ticker = lts.ticker
        WHERE lts.profile = $1 AND lts.status = 'open' AND lts.trailing_stop_pct IS NOT NULL
      `, [PROFILE]);

      for (const pos of openRes.rows) {
        if (pos.current_close && pos.current_close > (pos.trailing_high ?? 0)) {
          await pool.query(`UPDATE live_trade_signals SET trailing_high = $1 WHERE id = $2`, [pos.current_close, pos.id]);
        }
      }
      return secureJsonResponse({ ok: true });
    }

    if (action === 'check_rules') {
      const { settings } = body;
      const stopPct = Number(settings?.stopLossPct ?? 5);
      const tpPct = Number(settings?.takeProfitPct ?? 15);
      const maxHold = Number(settings?.maxHoldDays ?? 21);
      const minHold = Number(settings?.minHoldDays ?? 3);
      const useSignalExit = settings?.useSignalExit ?? true;
      const exitThreshold = Number(settings?.exitThreshold ?? 0.25);
      const useTrailingStop = settings?.useTrailingStop ?? false;

      const openRes = await pool.query(`
        SELECT
          lts.id, lts.ticker,
          lts.entry_price::float, lts.stop_price::float, lts.tp_price::float,
          lts.trailing_stop_pct::float, lts.trailing_high::float,
          GREATEST(EXTRACT(DAY FROM NOW() - lts.accepted_at)::int, 0) AS days_held,
          pd.close::float AS current_close,
          mp.ensemble_prediction::float * 100 AS current_ml_pred
        FROM live_trade_signals lts
        LEFT JOIN (
          SELECT DISTINCT ON (ticker) ticker, close FROM prices_daily WHERE close > 0 ORDER BY ticker, date DESC
        ) pd ON pd.ticker = lts.ticker
        LEFT JOIN (
          SELECT DISTINCT ON (ticker) ticker, ensemble_prediction FROM ml_predictions WHERE ensemble_prediction IS NOT NULL ORDER BY ticker, prediction_date DESC
        ) mp ON mp.ticker = lts.ticker
        WHERE lts.profile = $1 AND lts.status = 'open'
      `, [PROFILE]);

      const triggered = [];

      for (const pos of openRes.rows) {
        const { id, entry_price, stop_price, tp_price, trailing_stop_pct, trailing_high, current_close, days_held, current_ml_pred } = pos;
        if (!current_close) continue;

        const minHoldMet = days_held >= minHold;

        // Update trailing high if applicable
        if (trailing_stop_pct && trailing_high && current_close > trailing_high) {
          await pool.query(`UPDATE live_trade_signals SET trailing_high = $1 WHERE id = $2`, [current_close, id]);
        }

        // Effective stop: use trailing if higher
        const effectiveStop = trailing_stop_pct && trailing_high
          ? Math.max(stop_price, (trailing_high ?? entry_price) * (1 - trailing_stop_pct / 100))
          : stop_price;

        let exitReason: string | null = null;

        if (minHoldMet && current_close <= effectiveStop) {
          exitReason = trailing_stop_pct ? 'trailing_stop' : 'stop';
        } else if (minHoldMet && current_close >= tp_price) {
          exitReason = 'tp';
        } else if (days_held >= maxHold) {
          exitReason = 'time';
        } else if (useSignalExit && current_ml_pred != null && current_ml_pred < exitThreshold && minHoldMet) {
          exitReason = 'signal_exit';
        }

        if (exitReason) {
          const grossPnlPct = ((current_close - entry_price) / entry_price) * 100;
          await pool.query(`
            UPDATE live_trade_signals
            SET status = 'closed', closed_at = NOW(), exit_price = $1, exit_reason = $2,
                gross_pnl_pct = $3, pnl_pct = $3
            WHERE id = $4
          `, [current_close, exitReason, grossPnlPct, id]);
          triggered.push({ id, ticker: pos.ticker, exitReason, pnlPct: grossPnlPct.toFixed(2) });
        }
      }

      return secureJsonResponse({ ok: true, triggered });
    }

    return secureJsonResponse({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return safeErrorResponse(error, 'Live trading action failed');
  }
}
