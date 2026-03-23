import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';

/**
 * GET /api/alpha/top-performers
 *
 * Realistic walk-forward trade simulation on top 50 liquid OSE equities.
 *
 * Trade rules (no future data, proper stop loss):
 *  - ENTRY:   ML signal crosses UP through +1%
 *  - EXIT:    First of: (1) signal drops below +0.25% after min hold,
 *             (2) hard stop loss -5% from entry, (3) 21-day time stop
 *  - MIN HOLD: 5 trading days (eliminates micro-trades)
 *  - STOP LOSS: -5% from entry price (checked daily on close)
 *  - MAX HOLD:  21 trading days (= 1 month prediction horizon)
 *  - Per-trade max drawdown tracked from daily prices
 *  - Only trades entered within last 365 days count
 */

const ENTRY_PCT    = 1.0;    // Signal threshold to enter (%)
const EXIT_PCT     = 0.25;   // Signal threshold to exit (%)
const STOP_LOSS    = -0.05;  // Hard stop: -5% from entry price
const MIN_HOLD     = 5;      // Minimum trading days before signal-exit allowed
const MAX_HOLD     = 21;     // Maximum trading days (1-month horizon)
const LOOKBACK     = 5;      // Days to look back for previous signal (same as Explorer)

const CACHE_MAX_AGE_H = 25;

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const model = url.searchParams.get('model') || 'ensemble_v3';
    const cacheKey = `top_performers_v1_${model}`;

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

    // 1. Top 50 liquid OSE equities by avg NOK daily volume (last 3 months)
    const liquidRes = await pool.query(`
      SELECT ff.ticker, s.name, s.sector,
             AVG(ff.nokvol::float) AS avg_nokvol
      FROM factor_fundamentals ff
      JOIN stocks s ON ff.ticker = s.ticker
      WHERE ff.date >= NOW() - INTERVAL '3 months'
        AND (s.asset_type = 'equity' OR s.asset_type IS NULL)
        AND (s.currency = 'NOK' OR s.currency IS NULL)
        AND ff.ticker NOT LIKE '%.%'
        AND ff.nokvol IS NOT NULL AND ff.nokvol::float > 0
      GROUP BY ff.ticker, s.name, s.sector
      HAVING AVG(ff.nokvol::float) > 100000
      ORDER BY avg_nokvol DESC
      LIMIT 50
    `);

    const tickers = liquidRes.rows.map((r: { ticker: string }) => r.ticker);
    const tickerMeta = new Map<string, { name: string; sector: string; avg_nokvol: number }>(
      liquidRes.rows.map((r: { ticker: string; name: string; sector: string; avg_nokvol: number }) => [r.ticker, r])
    );
    if (tickers.length === 0) return secureJsonResponse({ topPerformers: [], meta: {} });

    // 2. alpha_signals for all tickers — same source as Explorer
    const sigRes = await pool.query(`
      SELECT ticker, signal_date::text AS date, predicted_return::float
      FROM alpha_signals
      WHERE ticker = ANY($1)
        AND model_id = $2
        AND signal_date >= NOW() - INTERVAL '400 days'
        AND predicted_return IS NOT NULL
      ORDER BY ticker, signal_date ASC
    `, [tickers, model]);

    // 3. Daily prices (400-day window — needed to track intra-trade drawdowns)
    const priceRes = await pool.query(`
      SELECT ticker, date::text, close::float
      FROM prices_daily
      WHERE ticker = ANY($1)
        AND date >= NOW() - INTERVAL '400 days'
        AND close > 0
      ORDER BY ticker, date ASC
    `, [tickers]);

    // 4. Latest signal per ticker
    const latestSigRes = await pool.query(`
      SELECT DISTINCT ON (ticker) ticker, predicted_return::float
      FROM alpha_signals
      WHERE ticker = ANY($1) AND model_id = $2 AND predicted_return IS NOT NULL
      ORDER BY ticker, signal_date DESC
    `, [tickers, model]);
    const latestPred = new Map<string, number>(
      latestSigRes.rows.map((r: { ticker: string; predicted_return: number }) => [r.ticker, r.predicted_return])
    );

    // 5. Build per-ticker signal and price maps
    const sigByTicker = new Map<string, Map<string, number>>();
    for (const row of sigRes.rows) {
      if (!sigByTicker.has(row.ticker)) sigByTicker.set(row.ticker, new Map());
      sigByTicker.get(row.ticker)!.set(row.date.slice(0, 10), row.predicted_return);
    }

    const priceByTicker = new Map<string, { date: string; close: number }[]>();
    for (const row of priceRes.rows) {
      if (!priceByTicker.has(row.ticker)) priceByTicker.set(row.ticker, []);
      priceByTicker.get(row.ticker)!.push({ date: row.date.slice(0, 10), close: row.close });
    }

    // 6. Walk-forward trade simulation
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 365);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    interface Trade {
      entryDate: string; exitDate: string;
      entryPrice: number; exitPrice: number;
      pnl: number; maxDrawdown: number;  // maxDrawdown = worst intra-trade close vs entry
      exitReason: 'signal' | 'stop' | 'timeStop';
    }

    interface TradeResult {
      ticker: string; name: string; sector: string;
      avg_nokvol: number; latestPred: number;
      trades: number; wins: number;
      totalPnl: number; avgPnl: number; winRate: number;
      avgMaxDrawdown: number; maxSingleDrawdown: number;
      score: number;
    }
    const results: TradeResult[] = [];

    for (const ticker of tickers) {
      const prices = priceByTicker.get(ticker);
      const sigs = sigByTicker.get(ticker);
      if (!prices || prices.length < 30 || !sigs || sigs.size === 0) continue;

      // Build day array: sparse pred_pct (null when no signal on that exact date)
      type Day = { date: string; close: number; pred_pct: number | null };
      const days: Day[] = prices.map(p => ({
        date: p.date, close: p.close,
        pred_pct: sigs.has(p.date) ? sigs.get(p.date)! * 100 : null,
      }));

      const trades: Trade[] = [];
      let inTrade = false;
      let entryIdx = 0;
      let entryDate = '';
      let entryPrice = 0;
      let minPriceDuringTrade = 0;

      for (let i = 1; i < days.length; i++) {
        if (!inTrade) {
          // Detect entry crossing (same lookback as Explorer)
          let prev: number | null = null;
          for (let j = i - 1; j >= Math.max(0, i - LOOKBACK); j--) {
            if (days[j].pred_pct != null) { prev = days[j].pred_pct!; break; }
          }
          const curr = days[i].pred_pct;
          if (prev != null && curr != null && prev < ENTRY_PCT && curr >= ENTRY_PCT
              && days[i].date >= cutoffStr) {
            inTrade = true;
            entryIdx = i;
            entryDate = days[i].date;
            entryPrice = days[i].close;
            minPriceDuringTrade = days[i].close;
          }
        } else {
          // Track intra-trade min close (for max drawdown)
          if (days[i].close < minPriceDuringTrade) minPriceDuringTrade = days[i].close;

          const daysHeld = i - entryIdx;
          const priceReturn = (days[i].close - entryPrice) / entryPrice;

          // Check exit conditions
          let exitReason: Trade['exitReason'] | null = null;

          // (1) Hard stop loss: -5% from entry (no minimum hold)
          if (priceReturn <= STOP_LOSS) {
            exitReason = 'stop';
          }
          // (2) Time stop: max 21 trading days
          else if (daysHeld >= MAX_HOLD) {
            exitReason = 'timeStop';
          }
          // (3) Signal exit — only after minimum hold period
          else if (daysHeld >= MIN_HOLD) {
            let prev: number | null = null;
            for (let j = i - 1; j >= Math.max(0, i - LOOKBACK); j--) {
              if (days[j].pred_pct != null) { prev = days[j].pred_pct!; break; }
            }
            const curr = days[i].pred_pct;
            if (prev != null && curr != null && prev > EXIT_PCT && curr <= EXIT_PCT) {
              exitReason = 'signal';
            }
          }

          if (exitReason) {
            const exitPrice = days[i].close;
            const pnl = (exitPrice - entryPrice) / entryPrice;
            const maxDrawdown = (minPriceDuringTrade - entryPrice) / entryPrice;
            trades.push({ entryDate, exitDate: days[i].date, entryPrice, exitPrice, pnl, maxDrawdown, exitReason });
            inTrade = false;
          }
        }
      }

      if (trades.length < 3) continue;

      const wins = trades.filter(t => t.pnl > 0).length;
      const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
      const avgPnl = totalPnl / trades.length;
      const winRate = wins / trades.length;
      const avgMaxDrawdown = trades.reduce((s, t) => s + t.maxDrawdown, 0) / trades.length;
      const maxSingleDrawdown = Math.min(...trades.map(t => t.maxDrawdown));

      if (winRate < 0.4) continue; // allow some losing strategies through for realism

      // Score: capped avg P&L per trade (10% cap) × win rate × sqrt(n)
      const cappedAvg = trades.reduce((s, t) => s + Math.min(t.pnl, 0.10), 0) / trades.length;
      if (cappedAvg <= 0) continue;
      const score = winRate * cappedAvg * Math.sqrt(trades.length);

      results.push({
        ticker,
        name: tickerMeta.get(ticker)?.name || ticker,
        sector: tickerMeta.get(ticker)?.sector || 'Other',
        avg_nokvol: tickerMeta.get(ticker)?.avg_nokvol || 0,
        latestPred: (latestPred.get(ticker) || 0) * 100,
        trades: trades.length,
        wins,
        totalPnl: Math.round(totalPnl * 10000) / 100,
        avgPnl: Math.round(avgPnl * 10000) / 100,
        winRate: Math.round(winRate * 1000) / 10,
        avgMaxDrawdown: Math.round(avgMaxDrawdown * 10000) / 100,
        maxSingleDrawdown: Math.round(maxSingleDrawdown * 10000) / 100,
        score,
      });
    }

    results.sort((a, b) => b.score - a.score);
    const top10 = results.slice(0, 10).map(({ score, ...r }) => r); // eslint-disable-line @typescript-eslint/no-unused-vars

    const result = {
      topPerformers: top10,
      meta: {
        model, universe: tickers.length, qualified: results.length,
        rules: { entryPct: ENTRY_PCT, exitPct: EXIT_PCT, stopLoss: STOP_LOSS * 100, minHold: MIN_HOLD, maxHold: MAX_HOLD },
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
    return safeErrorResponse(error, 'Top performers failed');
  }
}
