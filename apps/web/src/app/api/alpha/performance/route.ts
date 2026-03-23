import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';

/**
 * GET /api/alpha/performance?window=63&days=365
 * Cross-model performance comparison over time.
 */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const window = parseInt(url.searchParams.get('window') || '63');
    const days = parseInt(url.searchParams.get('days') || '365');

    const result = await pool.query(`
      SELECT p.model_id, p.evaluation_date, p.window_days,
             p.hit_rate, p.ic, p.mae, p.sharpe, p.long_short_return,
             p.n_predictions, p.metadata,
             m.display_name, m.model_type
      FROM alpha_model_performance p
      JOIN alpha_model_registry m ON p.model_id = m.model_id
      WHERE p.window_days = $1
        AND p.evaluation_date >= CURRENT_DATE - $2 * INTERVAL '1 day'
        AND m.is_active = true
      ORDER BY p.evaluation_date DESC, p.model_id
    `, [window, days]);

    // Group by model for time series
    const modelSeries: Record<string, {
      model_id: string; display_name: string; model_type: string;
      series: { date: string; ic: number; hit_rate: number; sharpe: number }[];
    }> = {};

    for (const row of result.rows) {
      if (!modelSeries[row.model_id]) {
        modelSeries[row.model_id] = {
          model_id: row.model_id,
          display_name: row.display_name,
          model_type: row.model_type,
          series: [],
        };
      }
      modelSeries[row.model_id].series.push({
        date: row.evaluation_date,
        ic: parseFloat(row.ic),
        hit_rate: parseFloat(row.hit_rate),
        sharpe: parseFloat(row.sharpe),
      });
    }

    return secureJsonResponse({
      window,
      days,
      models: Object.values(modelSeries),
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch performance');
  }
}
