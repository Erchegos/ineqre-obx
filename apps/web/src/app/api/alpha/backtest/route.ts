import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAlphaAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';

/**
 * POST /api/alpha/backtest
 * Run comparative backtest across selected models using historical signals.
 * Body: { models: string[], tickers?: string[], startDate?, endDate?, rebalanceDays?: number, costBps?: number }
 */
export async function POST(req: NextRequest) {
  const authError = requireAlphaAuth(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const {
      models = ['ensemble_v4_21d'],
      tickers,
      startDate,
      endDate,
      rebalanceDays = 21,
      costBps = 10,
      topN = 10,
      strategy = 'long_short', // long_only, long_short, signal_weighted
    } = body;

    // Get all signal dates for rebalancing
    let dateFilter = '';
    const params: (string | number | string[])[] = [models];
    let paramIdx = 1;

    if (startDate) { paramIdx++; dateFilter += ` AND s.signal_date >= $${paramIdx}::date`; params.push(startDate); }
    if (endDate) { paramIdx++; dateFilter += ` AND s.signal_date <= $${paramIdx}::date`; params.push(endDate); }

    let tickerFilter = '';
    if (tickers && tickers.length > 0) {
      paramIdx++; tickerFilter = ` AND s.ticker = ANY($${paramIdx})`; params.push(tickers);
    }

    // Get signals grouped by date
    const signalsRes = await pool.query(`
      SELECT s.signal_date, s.ticker, s.model_id,
             s.signal_value, s.predicted_return, s.confidence
      FROM alpha_signals s
      WHERE s.model_id = ANY($1)
        ${dateFilter} ${tickerFilter}
      ORDER BY s.signal_date, s.model_id, s.signal_value DESC
    `, params);

    // Get price data for all tickers in signal set
    const tickerSet = new Set(signalsRes.rows.map((r: { ticker: string }) => r.ticker));
    const allTickers = Array.from(tickerSet);

    if (allTickers.length === 0) {
      return secureJsonResponse({
        error: 'No signals found for the specified parameters',
        models, tickers, startDate, endDate,
      }, { status: 404 });
    }

    const pricesRes = await pool.query(`
      SELECT ticker, date, close FROM prices_daily
      WHERE ticker = ANY($1)
        AND date >= (SELECT MIN(signal_date) FROM alpha_signals WHERE model_id = ANY($2))
      ORDER BY ticker, date
    `, [allTickers, models]);

    // Build price map: ticker -> date -> close
    const priceMap = new Map<string, Map<string, number>>();
    for (const row of pricesRes.rows) {
      if (!priceMap.has(row.ticker)) priceMap.set(row.ticker, new Map());
      priceMap.get(row.ticker)!.set(row.date.toISOString().slice(0, 10), parseFloat(row.close));
    }

    // Walk-forward backtest per model
    const results: Record<string, {
      model_id: string;
      totalReturn: number;
      annualizedReturn: number;
      sharpe: number;
      maxDrawdown: number;
      hitRate: number;
      trades: number;
      equityCurve: { date: string; value: number }[];
      monthlyReturns: { month: string; return: number }[];
    }> = {};

    // Group signals by date and model
    const signalsByDateModel = new Map<string, Map<string, { ticker: string; signal: number; predicted: number }[]>>();
    for (const row of signalsRes.rows) {
      const dateStr = row.signal_date instanceof Date ? row.signal_date.toISOString().slice(0, 10) : String(row.signal_date).slice(0, 10);
      const key = `${dateStr}|${row.model_id}`;
      if (!signalsByDateModel.has(key)) signalsByDateModel.set(key, new Map());
      const modelMap = signalsByDateModel.get(key)!;
      if (!modelMap.has(row.model_id)) modelMap.set(row.model_id, []);
      modelMap.get(row.model_id)!.push({
        ticker: row.ticker,
        signal: parseFloat(row.signal_value),
        predicted: parseFloat(row.predicted_return) || 0,
      });
    }

    // Simple backtest: for each model, at each signal date, take top-N long / bottom-N short
    for (const modelId of models) {
      const equity = [{ date: '', value: 10000000 }];
      const monthlyMap = new Map<string, number>();
      let hits = 0;
      let totalPredictions = 0;
      let peak = 10000000;
      let maxDD = 0;

      // Get unique signal dates for this model
      const modelDates = [...new Set(
        signalsRes.rows
          .filter((r: { model_id: string }) => r.model_id === modelId)
          .map((r: { signal_date: Date | string }) => {
            const d = r.signal_date;
            return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
          })
      )].sort();

      for (let i = 0; i < modelDates.length; i++) {
        const date = modelDates[i];
        const nextDate = modelDates[i + 1];
        if (!nextDate) break;

        // Get signals for this date
        const key = `${date}|${modelId}`;
        const signals = signalsByDateModel.get(key)?.get(modelId) || [];
        if (signals.length === 0) continue;

        // Sort by signal strength
        signals.sort((a, b) => b.signal - a.signal);
        const longs = signals.slice(0, topN);
        const shorts = strategy === 'long_short' ? signals.slice(-topN) : [];

        // Calculate return for this period
        let periodReturn = 0;
        let periodPredictions = 0;

        for (const pos of longs) {
          const entryPrice = priceMap.get(pos.ticker)?.get(date);
          const exitPrice = priceMap.get(pos.ticker)?.get(nextDate);
          if (entryPrice && exitPrice) {
            const ret = (exitPrice - entryPrice) / entryPrice;
            periodReturn += ret / topN;
            if ((ret > 0 && pos.signal > 0) || (ret < 0 && pos.signal < 0)) hits++;
            periodPredictions++;
          }
        }

        for (const pos of shorts) {
          const entryPrice = priceMap.get(pos.ticker)?.get(date);
          const exitPrice = priceMap.get(pos.ticker)?.get(nextDate);
          if (entryPrice && exitPrice) {
            const ret = -(exitPrice - entryPrice) / entryPrice;
            periodReturn += ret / topN;
            if ((ret > 0 && pos.signal < 0) || (ret < 0 && pos.signal > 0)) hits++;
            periodPredictions++;
          }
        }

        totalPredictions += periodPredictions;

        // Apply transaction costs
        const costFraction = (costBps / 10000) * 2; // entry + exit
        periodReturn -= costFraction;

        const newValue = equity[equity.length - 1].value * (1 + periodReturn);
        equity.push({ date: nextDate, value: newValue });

        // Track drawdown
        if (newValue > peak) peak = newValue;
        const dd = (peak - newValue) / peak;
        if (dd > maxDD) maxDD = dd;

        // Monthly aggregation
        const month = nextDate.slice(0, 7);
        monthlyMap.set(month, (monthlyMap.get(month) || 0) + periodReturn);
      }

      const totalReturn = equity.length > 1
        ? (equity[equity.length - 1].value / equity[0].value) - 1
        : 0;
      const nYears = modelDates.length > 1
        ? (new Date(modelDates[modelDates.length - 1]).getTime() - new Date(modelDates[0]).getTime()) / (365.25 * 86400000)
        : 1;
      const annReturn = Math.pow(1 + totalReturn, 1 / Math.max(nYears, 0.1)) - 1;

      // Sharpe from monthly returns
      const monthlyReturns = Array.from(monthlyMap.entries()).map(([month, ret]) => ({ month, return: ret }));
      const avgMonthly = monthlyReturns.reduce((s, m) => s + m.return, 0) / Math.max(monthlyReturns.length, 1);
      const stdMonthly = Math.sqrt(
        monthlyReturns.reduce((s, m) => s + (m.return - avgMonthly) ** 2, 0) / Math.max(monthlyReturns.length - 1, 1)
      );
      const sharpe = stdMonthly > 0 ? (avgMonthly / stdMonthly) * Math.sqrt(12) : 0;

      results[modelId] = {
        model_id: modelId,
        totalReturn,
        annualizedReturn: annReturn,
        sharpe,
        maxDrawdown: maxDD,
        hitRate: totalPredictions > 0 ? hits / totalPredictions : 0,
        trades: totalPredictions,
        equityCurve: equity.filter(e => e.date),
        monthlyReturns,
      };
    }

    return secureJsonResponse({
      strategy,
      topN,
      costBps,
      rebalanceDays,
      models: results,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Backtest failed');
  }
}
