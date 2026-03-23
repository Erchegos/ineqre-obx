import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';

/**
 * POST /api/alpha/backtest-atr
 *
 * Hedge-fund-style backtest:
 * 1. Compute per-ticker ML accuracy (hit rate) from historical signals
 * 2. Filter universe to only stocks where ML is proven accurate (>55%)
 * 3. Trade with ATR-based risk management on quality universe only
 *
 * This avoids the trap of trading stocks where the model has no predictive edge.
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const {
      model = 'mjolnir_v8',
      buyThreshold = 0.65,
      targetMultiple = 3.0,
      stopMultiple = 1.5,
      maxHoldDays = 21,
      costBps = 15,
      trendFilter = true,
      minSignals = 8,
      minHitRate = 0.55,
      positionPct = 0.05,
    } = body;

    // ── 1. Fetch all signals for OSE equities ──
    const signalsRes = await pool.query(`
      SELECT s.ticker, s.signal_date, s.confidence
      FROM alpha_signals s
      JOIN stocks st ON s.ticker = st.ticker
      WHERE s.model_id = $1
        AND s.confidence >= 0.05
        AND (st.asset_type = 'equity' OR st.asset_type IS NULL)
        AND (st.currency = 'NOK' OR st.currency IS NULL)
        AND s.ticker NOT LIKE '%.%'
      ORDER BY s.ticker, s.signal_date
    `, [model]);

    if (signalsRes.rows.length === 0) {
      return secureJsonResponse({ error: 'No signals found' }, { status: 404 });
    }

    // Group signals by ticker
    const signalsByTicker = new Map<string, { date: string; signal: number }[]>();
    for (const row of signalsRes.rows) {
      const ticker = row.ticker;
      const dateStr = row.signal_date instanceof Date
        ? row.signal_date.toISOString().slice(0, 10)
        : String(row.signal_date).slice(0, 10);
      if (!signalsByTicker.has(ticker)) signalsByTicker.set(ticker, []);
      signalsByTicker.get(ticker)!.push({ date: dateStr, signal: parseFloat(row.confidence) });
    }

    // Get candidate tickers (those with enough signals)
    const candidateTickers: string[] = [];
    for (const [ticker, sigs] of signalsByTicker) {
      if (sigs.filter(s => s.signal >= buyThreshold * 0.85).length >= minSignals) {
        candidateTickers.push(ticker);
      }
    }

    if (candidateTickers.length === 0) {
      return secureJsonResponse({ error: 'No tickers meet minimum signal count' }, { status: 404 });
    }

    // Liquidity filter
    const liqRes = await pool.query(`
      SELECT ticker, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY volume) AS median_vol
      FROM prices_daily
      WHERE ticker = ANY($1) AND date >= NOW() - INTERVAL '1 year' AND volume > 0
      GROUP BY ticker
      HAVING PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY volume) > 50000
    `, [candidateTickers]);
    const liquidTickers = new Set(liqRes.rows.map((r: { ticker: string }) => r.ticker));
    const liquidCandidates = candidateTickers.filter(t => liquidTickers.has(t));

    if (liquidCandidates.length === 0) {
      return secureJsonResponse({ error: 'No liquid tickers' }, { status: 404 });
    }

    // ── 2. Fetch price data ──
    const pricesRes = await pool.query(`
      WITH raw AS (
        SELECT ticker, date, high, low, close, volume,
          GREATEST(
            high - low,
            ABS(high - LAG(close, 1) OVER (PARTITION BY ticker ORDER BY date)),
            ABS(low - LAG(close, 1) OVER (PARTITION BY ticker ORDER BY date))
          ) AS true_range,
          AVG(close) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS sma50,
          ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date) AS rn
        FROM prices_daily
        WHERE ticker = ANY($1)
      ),
      with_atr AS (
        SELECT ticker, date, high, low, close, volume, sma50, rn,
          AVG(true_range) OVER (PARTITION BY ticker ORDER BY date ROWS BETWEEN 13 PRECEDING AND CURRENT ROW) AS atr14
        FROM raw
      )
      SELECT ticker, date, high::float, low::float, close::float, sma50::float, atr14::float
      FROM with_atr
      WHERE rn > 200
      ORDER BY ticker, date
    `, [liquidCandidates]);

    // Build sorted price arrays
    type PriceRow = { date: string; close: number; high: number; low: number; sma50: number | null; atr14: number | null };
    const pricesByTicker = new Map<string, PriceRow[]>();
    for (const row of pricesRes.rows) {
      const dateStr = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10);
      if (!pricesByTicker.has(row.ticker)) pricesByTicker.set(row.ticker, []);
      pricesByTicker.get(row.ticker)!.push({
        date: dateStr, close: row.close, high: row.high, low: row.low,
        sma50: row.sma50, atr14: row.atr14,
      });
    }

    // ── 3. Compute per-ticker ML accuracy (hit rate) ──
    // For each signal above threshold: did the stock go up in the next 21 trading days?
    interface TickerAccuracy {
      ticker: string;
      hitRate: number;
      totalSignals: number;
      avgReturn: number;
    }

    const tickerAccuracy: TickerAccuracy[] = [];

    for (const ticker of liquidCandidates) {
      const sigs = signalsByTicker.get(ticker) || [];
      const priceArr = pricesByTicker.get(ticker);
      if (!priceArr || priceArr.length < 50) continue;

      const dateIdx = new Map<string, number>();
      priceArr.forEach((p, i) => dateIdx.set(p.date, i));

      let hits = 0;
      let total = 0;
      let sumReturn = 0;

      for (const sig of sigs) {
        if (sig.signal < buyThreshold * 0.85) continue; // include near-threshold for accuracy calc

        const idx = dateIdx.get(sig.date);
        if (idx === undefined) continue;

        // Find price ~21 trading days later
        const futureIdx = Math.min(idx + 21, priceArr.length - 1);
        if (futureIdx <= idx) continue;

        const ret = (priceArr[futureIdx].close - priceArr[idx].close) / priceArr[idx].close;
        total++;
        sumReturn += ret;
        if (ret > 0) hits++;
      }

      if (total >= minSignals) {
        tickerAccuracy.push({
          ticker,
          hitRate: hits / total,
          totalSignals: total,
          avgReturn: sumReturn / total,
        });
      }
    }

    // Filter to quality universe: stocks where ML is proven accurate
    const qualityUniverse = tickerAccuracy
      .filter(t => t.hitRate >= minHitRate && t.avgReturn > 0)
      .sort((a, b) => b.hitRate - a.hitRate);

    const eligibleTickers = qualityUniverse.map(t => t.ticker);

    if (eligibleTickers.length === 0) {
      return secureJsonResponse({ error: 'No tickers meet accuracy threshold' }, { status: 404 });
    }

    // ── 4. Run ATR backtest on quality universe ──
    const costFraction = (costBps * 2) / 10000;

    interface Trade {
      ticker: string;
      entryDate: string;
      exitDate: string;
      entryPrice: number;
      exitPrice: number;
      netReturn: number;
      holdingDays: number;
      exitReason: string;
      riskRewardRatio: number;
    }

    interface TickerResult {
      ticker: string;
      trades: number;
      wins: number;
      winRate: number;
      avgReturn: number;
      totalReturn: number;
      profitFactor: number;
      avgHoldDays: number;
      bestTrade: number;
      worstTrade: number;
      mlAccuracy: number;
    }

    const allTrades: Trade[] = [];
    const tickerResults: TickerResult[] = [];

    for (const ticker of eligibleTickers) {
      const sigs = signalsByTicker.get(ticker) || [];
      const priceArr = pricesByTicker.get(ticker);
      if (!priceArr || priceArr.length < 50) continue;

      // Build signal date lookup
      const sigMap = new Map<string, number>();
      for (const s of sigs) sigMap.set(s.date, s.signal);

      const trades: Trade[] = [];
      let inTrade = false;
      let entryPrice = 0;
      let priceTarget = 0;
      let stopLoss = 0;
      let entryDate = '';

      for (let i = 0; i < priceArr.length; i++) {
        const p = priceArr[i];

        if (!inTrade) {
          // Check for ML signal on this date
          const conf = sigMap.get(p.date);
          if (conf === undefined || conf < buyThreshold) continue;

          const atr = p.atr14 || p.close * 0.02;

          // Trend filter: above SMA50
          if (trendFilter && p.sma50 && p.close <= p.sma50) continue;

          // Enter
          inTrade = true;
          entryDate = p.date;
          entryPrice = p.close;
          priceTarget = p.close + atr * targetMultiple;
          stopLoss = p.close - atr * stopMultiple;
        } else {
          // Check exit on every trading day
          const holdDays = Math.round(
            (new Date(p.date).getTime() - new Date(entryDate).getTime()) / 86400000
          );

          const hitTarget = p.high >= priceTarget;
          const hitStop = p.low <= stopLoss;
          const maxHold = holdDays >= maxHoldDays;

          // Trailing stop: breakeven after 1 ATR profit
          const atr = p.atr14 || entryPrice * 0.02;
          if (p.close > entryPrice + atr && stopLoss < entryPrice) {
            stopLoss = entryPrice;
          }

          if (hitTarget || hitStop || maxHold) {
            let exitPrice: number;
            let exitReason: string;

            if (hitStop && hitTarget) {
              // Same-day: conservative — assume stop first
              exitPrice = stopLoss;
              exitReason = 'Stop loss';
            } else if (hitStop) {
              exitPrice = stopLoss;
              exitReason = 'Stop loss';
            } else if (hitTarget) {
              exitPrice = priceTarget;
              exitReason = 'Target hit';
            } else {
              exitPrice = p.close;
              exitReason = 'Time exit';
            }

            const grossRet = (exitPrice - entryPrice) / entryPrice;
            const netRet = grossRet - costFraction;
            const rr = stopLoss < entryPrice
              ? (priceTarget - entryPrice) / (entryPrice - stopLoss)
              : 0;

            trades.push({
              ticker, entryDate, exitDate: p.date,
              entryPrice, exitPrice,
              netReturn: netRet, holdingDays: holdDays,
              exitReason, riskRewardRatio: rr,
            });
            inTrade = false;
          }
        }
      }

      if (trades.length === 0) continue;

      const wins = trades.filter(t => t.netReturn > 0);
      const losses = trades.filter(t => t.netReturn <= 0);
      const grossWins = wins.reduce((s, t) => s + t.netReturn, 0);
      const grossLosses = Math.abs(losses.reduce((s, t) => s + t.netReturn, 0));
      const accuracy = qualityUniverse.find(q => q.ticker === ticker);

      tickerResults.push({
        ticker,
        trades: trades.length,
        wins: wins.length,
        winRate: wins.length / trades.length,
        avgReturn: trades.reduce((s, t) => s + t.netReturn, 0) / trades.length,
        totalReturn: trades.reduce((s, t) => s + t.netReturn, 0),
        profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 99 : 0,
        avgHoldDays: trades.reduce((s, t) => s + t.holdingDays, 0) / trades.length,
        bestTrade: Math.max(...trades.map(t => t.netReturn)),
        worstTrade: Math.min(...trades.map(t => t.netReturn)),
        mlAccuracy: accuracy?.hitRate || 0,
      });

      allTrades.push(...trades);
    }

    if (allTrades.length === 0) {
      return secureJsonResponse({ error: 'No trades generated' }, { status: 404 });
    }

    // ── 5. Portfolio simulation ──
    allTrades.sort((a, b) => a.entryDate.localeCompare(b.entryDate));

    const totalTrades = allTrades.length;
    const totalWins = allTrades.filter(t => t.netReturn > 0).length;
    const grossWinsAll = allTrades.filter(t => t.netReturn > 0).reduce((s, t) => s + t.netReturn, 0);
    const grossLossesAll = Math.abs(allTrades.filter(t => t.netReturn <= 0).reduce((s, t) => s + t.netReturn, 0));

    const startingCapital = 10_000_000;
    let equity = startingCapital;
    let peak = startingCapital;
    let maxDD = 0;
    const equityCurve: { date: string; pctReturn: number }[] = [
      { date: allTrades[0]?.entryDate || '', pctReturn: 0 },
    ];
    const monthlyReturns = new Map<string, number>();

    for (const trade of allTrades) {
      const posSize = equity * positionPct;
      equity += posSize * trade.netReturn;
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDD) maxDD = dd;

      equityCurve.push({
        date: trade.exitDate,
        pctReturn: Math.round(((equity - startingCapital) / startingCapital) * 1000) / 10,
      });

      const month = trade.exitDate.slice(0, 7);
      monthlyReturns.set(month, (monthlyReturns.get(month) || 0) + trade.netReturn * positionPct);
    }

    const totalReturn = (equity - startingCapital) / startingCapital;
    const firstDate = allTrades[0]?.entryDate || '';
    const lastDate = allTrades[allTrades.length - 1]?.exitDate || '';
    const nYears = firstDate && lastDate
      ? (new Date(lastDate).getTime() - new Date(firstDate).getTime()) / (365.25 * 86400000)
      : 1;
    const annReturn = nYears > 0.1 ? Math.pow(1 + totalReturn, 1 / nYears) - 1 : totalReturn;

    const mReturns = Array.from(monthlyReturns.entries())
      .map(([m, r]) => ({ month: m, return: r }))
      .sort((a, b) => a.month.localeCompare(b.month));
    const avgMonthly = mReturns.reduce((s, m) => s + m.return, 0) / Math.max(mReturns.length, 1);
    const stdMonthly = Math.sqrt(
      mReturns.reduce((s, m) => s + (m.return - avgMonthly) ** 2, 0) / Math.max(mReturns.length - 1, 1)
    );
    const sharpe = stdMonthly > 0 ? (avgMonthly / stdMonthly) * Math.sqrt(12) : 0;

    // Sort ticker results by total return
    tickerResults.sort((a, b) => b.totalReturn - a.totalReturn);
    const sortedTrades = [...allTrades].sort((a, b) => b.netReturn - a.netReturn);

    const avgHitRate = qualityUniverse.reduce((s, t) => s + t.hitRate, 0) / qualityUniverse.length;

    return secureJsonResponse({
      params: {
        model, buyThreshold, targetMultiple, stopMultiple,
        maxHoldDays, costBps, trendFilter, minHitRate, positionPct,
      },
      universe: {
        scanned: liquidCandidates.length,
        qualified: qualityUniverse.length,
        avgHitRate: Math.round(avgHitRate * 1000) / 10,
        tickers: qualityUniverse.map(t => ({
          ticker: t.ticker,
          hitRate: Math.round(t.hitRate * 1000) / 10,
          signals: t.totalSignals,
          avgReturn: Math.round(t.avgReturn * 10000) / 100,
        })),
      },
      summary: {
        tickers: tickerResults.length,
        totalTrades,
        wins: totalWins,
        winRate: totalTrades > 0 ? totalWins / totalTrades : 0,
        avgReturn: totalTrades > 0 ? allTrades.reduce((s, t) => s + t.netReturn, 0) / totalTrades : 0,
        totalReturn,
        annualizedReturn: annReturn,
        sharpe,
        maxDrawdown: maxDD,
        profitFactor: grossLossesAll > 0 ? grossWinsAll / grossLossesAll : grossWinsAll > 0 ? 99 : 0,
        avgRR: totalTrades > 0 ? allTrades.reduce((s, t) => s + t.riskRewardRatio, 0) / totalTrades : 0,
        targetHits: allTrades.filter(t => t.exitReason === 'Target hit').length,
        stopHits: allTrades.filter(t => t.exitReason === 'Stop loss').length,
        timeExits: allTrades.filter(t => t.exitReason === 'Time exit').length,
        avgHoldDays: totalTrades > 0 ? allTrades.reduce((s, t) => s + t.holdingDays, 0) / totalTrades : 0,
      },
      equityCurve,
      monthlyReturns: mReturns,
      tickerResults: tickerResults.slice(0, 30),
      bestTrades: sortedTrades.slice(0, 10),
      worstTrades: sortedTrades.slice(-10).reverse(),
    });
  } catch (error) {
    return safeErrorResponse(error, 'ATR backtest failed');
  }
}
