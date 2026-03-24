import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAlphaAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';

/**
 * GET /api/alpha/signals?date=2026-03-20&model=ensemble_v3
 * Returns latest signals grouped by ticker with per-model breakdown.
 */
export async function GET(req: NextRequest) {
  const authError = requireAlphaAuth(req);
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date');
    const model = url.searchParams.get('model');

    // Resolve signal date — filter by model so we get the correct latest date
    let signalDate = date;
    if (!signalDate) {
      const maxQuery = model
        ? `SELECT MAX(signal_date)::text AS d FROM alpha_signals WHERE model_id = $1`
        : `SELECT MAX(signal_date)::text AS d FROM alpha_signals`;
      const maxRes = await pool.query(maxQuery, model ? [model] : []);
      signalDate = maxRes.rows[0]?.d;
      if (!signalDate) {
        return secureJsonResponse({ signals: [], date: null, signalCount: 0 });
      }
    }

    // Fetch signals — for sparse models, get latest signal per ticker within recent window
    const mode = url.searchParams.get('mode'); // 'latest_per_ticker' for sparse models
    let result;

    // Common filter: OSE equities only (no ETFs, no .US tickers)
    const oseFilter = `AND (st.asset_type = 'equity' OR st.asset_type IS NULL)
        AND (st.currency = 'NOK' OR st.currency IS NULL)
        AND s.ticker NOT LIKE '%.%'`;

    if (mode === 'latest_per_ticker' && model) {
      // Get the most recent signal per ticker within 90 days of the latest signal date
      result = await pool.query(`
        SELECT DISTINCT ON (s.ticker) s.ticker, s.model_id, s.signal_value::float, s.predicted_return::float,
               s.confidence::float, s.signal_date::text, s.metadata,
               st.name AS stock_name, st.sector
        FROM alpha_signals s
        LEFT JOIN stocks st ON s.ticker = st.ticker
        WHERE s.model_id = $1
          AND s.signal_date >= ($2::date - INTERVAL '90 days')
          AND s.signal_date <= $2::date
          ${oseFilter}
        ORDER BY s.ticker, s.signal_date DESC
      `, [model, signalDate]);
    } else {
      const params: (string | number)[] = [signalDate];
      let modelFilter = '';
      if (model) {
        modelFilter = 'AND s.model_id = $2';
        params.push(model);
      }

      result = await pool.query(`
        SELECT s.ticker, s.model_id, s.signal_value::float, s.predicted_return::float,
               s.confidence::float, s.signal_date::text, s.metadata,
               st.name AS stock_name, st.sector
        FROM alpha_signals s
        LEFT JOIN stocks st ON s.ticker = st.ticker
        WHERE s.signal_date = $1::date ${modelFilter}
          ${oseFilter}
        ORDER BY s.ticker, s.model_id
      `, params);
    }

    // Get latest prices + daily return for each ticker
    const tickers = [...new Set(result.rows.map((r: { ticker: string }) => r.ticker))];
    const priceMap = new Map<string, { last_close: number; daily_return: number }>();

    if (tickers.length > 0) {
      const priceRes2 = await pool.query(`
        SELECT p1.ticker, p1.close::float AS last_close,
               CASE WHEN p2.close > 0 THEN (p1.close - p2.close) / p2.close ELSE 0 END AS daily_return
        FROM (
          SELECT DISTINCT ON (ticker) ticker, close, date FROM prices_daily
          WHERE ticker = ANY($1) ORDER BY ticker, date DESC
        ) p1
        LEFT JOIN LATERAL (
          SELECT close FROM prices_daily
          WHERE ticker = p1.ticker AND date < p1.date ORDER BY date DESC LIMIT 1
        ) p2 ON true
      `, [tickers]);

      for (const row of priceRes2.rows) {
        priceMap.set(row.ticker, {
          last_close: row.last_close || 0,
          daily_return: parseFloat(row.daily_return) || 0,
        });
      }
    }

    // Group by ticker → match page's SignalRow interface
    const tickerMap = new Map<string, {
      ticker: string; name: string; sector: string;
      last_close: number; daily_return: number;
      signals: { model_id: string; signal_value: number; predicted_return: number; confidence: number; signal_date: string; metadata?: Record<string, unknown> }[];
    }>();

    for (const row of result.rows) {
      if (!tickerMap.has(row.ticker)) {
        const price = priceMap.get(row.ticker);
        tickerMap.set(row.ticker, {
          ticker: row.ticker,
          name: row.stock_name || row.ticker,
          sector: row.sector || '',
          last_close: price?.last_close || 0,
          daily_return: price?.daily_return || 0,
          signals: [],
        });
      }
      const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : undefined;
      tickerMap.get(row.ticker)!.signals.push({
        model_id: row.model_id,
        signal_value: row.signal_value,
        predicted_return: row.predicted_return,
        confidence: row.confidence,
        signal_date: row.signal_date,
        ...(metadata ? { metadata } : {}),
      });
    }

    // Sort by strongest signal (first model's absolute signal value)
    const signals = Array.from(tickerMap.values())
      .sort((a, b) => Math.abs(b.signals[0]?.signal_value || 0) - Math.abs(a.signals[0]?.signal_value || 0));

    return secureJsonResponse({
      date: signalDate,
      signalCount: signals.length,
      signals,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch signals');
  }
}
