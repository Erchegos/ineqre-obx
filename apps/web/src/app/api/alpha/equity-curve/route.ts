import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAlphaAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';

/**
 * GET /api/alpha/equity-curve?model=yggdrasil_v7
 *
 * Slot-based portfolio simulation across top 50 liquid OSE equities.
 * 10 equal-weight slots, each compounding independently.
 * Same trade rules as Explorer & top-performers:
 *   Entry: signal crosses UP through +1%
 *   Exit:  (1) -5% stop loss  (2) 21d time stop  (3) signal <+0.25% after 5d min hold
 */

const ENTRY_PCT = 1.0;
const EXIT_PCT  = 0.25;
const STOP_LOSS = -0.05;
const MIN_HOLD  = 5;
const MAX_HOLD  = 21;
const LOOKBACK  = 5;
const MAX_SLOTS = 10;

const CACHE_MAX_AGE_H = 25;

export async function GET(req: NextRequest) {
  const authError = requireAlphaAuth(req);
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const model = url.searchParams.get('model') || 'fwd_ret_21d';
    const cacheKey = `equity_curve_v3_fwd21d`;

    // Check DB cache first
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS alpha_result_cache (
        cache_key TEXT PRIMARY KEY, result JSONB NOT NULL, computed_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const cached = await pool.query(
        `SELECT result FROM alpha_result_cache
         WHERE cache_key = $1 AND computed_at > NOW() - INTERVAL '${CACHE_MAX_AGE_H} hours'`,
        [cacheKey]
      );
      if (cached.rows.length > 0) return secureJsonResponse(cached.rows[0].result);
    } catch { /* fall through to compute */ }

    // 1. Top 50 liquid OSE tickers (same filter as top-performers)
    const liquidRes = await pool.query(`
      SELECT ff.ticker
      FROM factor_fundamentals ff
      JOIN stocks s ON ff.ticker = s.ticker
      WHERE ff.date >= NOW() - INTERVAL '3 months'
        AND (s.asset_type = 'equity' OR s.asset_type IS NULL)
        AND (s.currency = 'NOK' OR s.currency IS NULL)
        AND ff.ticker NOT LIKE '%.%'
        AND ff.nokvol IS NOT NULL AND ff.nokvol::float > 0
      GROUP BY ff.ticker
      HAVING AVG(ff.nokvol::float) > 100000
      ORDER BY AVG(ff.nokvol::float) DESC
      LIMIT 50
    `);
    const tickers: string[] = liquidRes.rows.map((r: { ticker: string }) => r.ticker);
    if (tickers.length === 0) return secureJsonResponse({ equityCurve: [], stats: {} });

    // 2. Signals — compute fwd_ret_21d from prices (no alpha_signals dependency)
    //    Fetch 445 days so LEAD(close,21) is non-null through the 415-day sim window
    const sigRes = await pool.query(`
      WITH raw AS (
        SELECT ticker, date, close::float
        FROM prices_daily
        WHERE ticker = ANY($1)
          AND date >= NOW() - INTERVAL '445 days'
          AND close > 0
      ),
      with_fwd AS (
        SELECT ticker, date,
          ((LEAD(close, 21) OVER (PARTITION BY ticker ORDER BY date) - close)
            / NULLIF(close, 0))::float AS predicted_return
        FROM raw
      )
      SELECT ticker, date::text AS date, predicted_return
      FROM with_fwd
      WHERE date >= CURRENT_DATE - INTERVAL '415 days'
        AND predicted_return IS NOT NULL
      ORDER BY ticker, date ASC
    `, [tickers]);

    // 3. Daily prices — same window
    const priceRes = await pool.query(`
      SELECT ticker, date::text, close::float
      FROM prices_daily
      WHERE ticker = ANY($1)
        AND date >= NOW() - INTERVAL '415 days'
        AND close > 0
      ORDER BY date ASC
    `, [tickers]);

    // ── Build lookup maps ──────────────────────────────────────────────────────

    // priceByTicker[ticker][date] = close
    const priceByTicker = new Map<string, Map<string, number>>();
    const allDatesSet = new Set<string>();
    for (const row of priceRes.rows as { ticker: string; date: string; close: number }[]) {
      const d = row.date.slice(0, 10);
      if (!priceByTicker.has(row.ticker)) priceByTicker.set(row.ticker, new Map());
      priceByTicker.get(row.ticker)!.set(d, row.close);
      allDatesSet.add(d);
    }
    const allDates = [...allDatesSet].sort();

    // sigByTicker[ticker][date] = pred_pct (%)
    const sigByTicker = new Map<string, Map<string, number>>();
    for (const row of sigRes.rows as { ticker: string; date: string; predicted_return: number }[]) {
      const d = row.date.slice(0, 10);
      if (!sigByTicker.has(row.ticker)) sigByTicker.set(row.ticker, new Map());
      sigByTicker.get(row.ticker)!.set(d, row.predicted_return * 100);
    }

    // Simulation window: last 365 calendar days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 365);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const simDates = allDates.filter(d => d >= cutoffStr);
    if (simDates.length === 0) return secureJsonResponse({ equityCurve: [], stats: {} });

    // Index maps for O(1) lookup
    const allDateIdx = new Map<string, number>();
    allDates.forEach((d, i) => allDateIdx.set(d, i));

    // ── Helpers ──────────────────────────────────────────────────────────────

    // Returns [currentPredPct, previousPredPct] for a ticker at sim-step si
    const getSignalCurrPrev = (ticker: string, si: number): [number | null, number | null] => {
      const date = simDates[si];
      const ai = allDateIdx.get(date) ?? 0;
      const sigMap = sigByTicker.get(ticker);
      const curr = sigMap?.get(date) ?? null;
      let prev: number | null = null;
      if (sigMap) {
        for (let j = ai - 1; j >= Math.max(0, ai - LOOKBACK); j--) {
          if (sigMap.has(allDates[j])) { prev = sigMap.get(allDates[j])!; break; }
        }
      }
      return [curr, prev];
    };

    // ── Precompute crossings per sim-day ──────────────────────────────────────
    // crossingsBySimIdx[si] = tickers that just crossed +1% on that day (sorted by strength)
    const crossingsBySimIdx: string[][] = Array.from({ length: simDates.length }, () => []);
    for (const ticker of tickers) {
      for (let si = 1; si < simDates.length; si++) {
        const [curr, prev] = getSignalCurrPrev(ticker, si);
        if (prev !== null && curr !== null && prev < ENTRY_PCT && curr >= ENTRY_PCT) {
          crossingsBySimIdx[si].push(ticker);
        }
      }
    }
    for (let si = 0; si < simDates.length; si++) {
      const date = simDates[si];
      crossingsBySimIdx[si].sort((a, b) =>
        (sigByTicker.get(b)?.get(date) ?? 0) - (sigByTicker.get(a)?.get(date) ?? 0)
      );
    }

    // ── Slot-based portfolio simulation ──────────────────────────────────────
    // 10 independent slots, each starting at 10 units (100 / MAX_SLOTS)
    // Each slot compounds on its own P&L. Portfolio value = sum of all slot values.

    const INIT_SLOT = 100 / MAX_SLOTS;
    const slotBalance = Array<number>(MAX_SLOTS).fill(INIT_SLOT);

    interface SlotPos { ticker: string; entryPrice: number; entrySimIdx: number; entryDate: string }
    const slotPos = Array<SlotPos | null>(MAX_SLOTS).fill(null);

    const equityCurve: { date: string; value: number; positions: number }[] = [];
    interface TradeLog { ticker: string; entryDate: string; exitDate: string; entryPrice: number; exitPrice: number; pnlPct: number; daysHeld: number; exitReason: 'signal' | 'stop' | 'time' }
    const tradeLog: TradeLog[] = [];
    let tradeCount = 0, winCount = 0;

    for (let si = 0; si < simDates.length; si++) {
      const date = simDates[si];

      // 1. Check exits
      for (let s = 0; s < MAX_SLOTS; s++) {
        const pos = slotPos[s];
        if (!pos) continue;
        const price = priceByTicker.get(pos.ticker)?.get(date);
        if (!price) continue;

        const daysHeld = si - pos.entrySimIdx;
        const priceReturn = (price - pos.entryPrice) / pos.entryPrice;
        const [curr, prev] = getSignalCurrPrev(pos.ticker, si);

        let exitReason: TradeLog['exitReason'] | null = null;
        if (priceReturn <= STOP_LOSS) exitReason = 'stop';
        else if (daysHeld >= MAX_HOLD) exitReason = 'time';
        else if (daysHeld >= MIN_HOLD && prev !== null && curr !== null
                 && prev > EXIT_PCT && curr <= EXIT_PCT) exitReason = 'signal';

        if (exitReason) {
          tradeLog.push({
            ticker: pos.ticker,
            entryDate: pos.entryDate,
            exitDate: date,
            entryPrice: Math.round(pos.entryPrice * 100) / 100,
            exitPrice: Math.round(price * 100) / 100,
            pnlPct: Math.round(priceReturn * 10000) / 100,
            daysHeld,
            exitReason,
          });
          slotBalance[s] *= (1 + priceReturn);
          slotPos[s] = null;
          tradeCount++;
          if (priceReturn > 0) winCount++;
        }
      }

      // 2. Fill free slots with highest-signal crossings
      const freeSlots: number[] = [];
      for (let s = 0; s < MAX_SLOTS; s++) if (!slotPos[s]) freeSlots.push(s);

      if (freeSlots.length > 0) {
        const activeTickers = new Set(slotPos.filter(Boolean).map(p => p!.ticker));
        let fi = 0;
        for (const ticker of crossingsBySimIdx[si]) {
          if (fi >= freeSlots.length) break;
          if (activeTickers.has(ticker)) continue;
          const price = priceByTicker.get(ticker)?.get(date);
          if (!price) continue;
          slotPos[freeSlots[fi]] = { ticker, entryPrice: price, entrySimIdx: si, entryDate: date };
          activeTickers.add(ticker);
          fi++;
        }
      }

      // 3. Mark-to-market portfolio value
      let totalValue = 0;
      let activePosCount = 0;
      for (let s = 0; s < MAX_SLOTS; s++) {
        const pos = slotPos[s];
        if (!pos) {
          totalValue += slotBalance[s]; // cash slot earns 0%
        } else {
          const price = priceByTicker.get(pos.ticker)?.get(date);
          const ret = price ? (price - pos.entryPrice) / pos.entryPrice : 0;
          totalValue += slotBalance[s] * (1 + ret);
          activePosCount++;
        }
      }
      equityCurve.push({ date, value: Math.round(totalValue * 100) / 100, positions: activePosCount });
    }

    // ── Summary stats ─────────────────────────────────────────────────────────
    const vals = equityCurve.map(e => e.value);
    const totalReturn = vals.length > 0 ? vals[vals.length - 1] - 100 : 0;
    let maxDD = 0, peak = 100;
    for (const v of vals) {
      if (v > peak) peak = v;
      const dd = (v - peak) / peak * 100;
      if (dd < maxDD) maxDD = dd;
    }

    // Sort trades newest first
    tradeLog.sort((a, b) => b.exitDate.localeCompare(a.exitDate));

    const result = {
      equityCurve,
      tradeLog,
      stats: {
        totalReturn: Math.round(totalReturn * 10) / 10,
        maxDrawdown: Math.round(maxDD * 10) / 10,
        winRate: tradeCount > 0 ? Math.round(winCount / tradeCount * 1000) / 10 : 0,
        trades: tradeCount,
        model,
        universe: tickers.length,
      },
    };
    try {
      await pool.query(
        `INSERT INTO alpha_result_cache (cache_key, result, computed_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (cache_key) DO UPDATE SET result = $2, computed_at = NOW()`,
        [cacheKey, JSON.stringify(result)]
      );
    } catch { /* non-fatal */ }
    return secureJsonResponse(result);
  } catch (error) {
    return safeErrorResponse(error, 'Equity curve failed');
  }
}
