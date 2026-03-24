import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAlphaAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';

/**
 * GET /api/alpha/models
 * List all registered models with latest performance metrics.
 */
export async function GET(req: NextRequest) {
  const authError = requireAlphaAuth(req);
  if (authError) return authError;

  try {
    const result = await pool.query(`
      SELECT
        m.model_id, m.model_type, m.display_name,
        m.hyperparameters, m.training_config,
        m.is_active, m.run_on_vps, m.notes, m.created_at,
        -- Latest signal count
        (SELECT COUNT(*) FROM alpha_signals s
         WHERE s.model_id = m.model_id
           AND s.signal_date = (SELECT MAX(signal_date) FROM alpha_signals WHERE model_id = m.model_id)
        ) AS latest_signal_count,
        -- Latest signal date
        (SELECT MAX(signal_date) FROM alpha_signals WHERE model_id = m.model_id) AS latest_signal_date,
        -- Total signals ever
        (SELECT COUNT(*) FROM alpha_signals WHERE model_id = m.model_id) AS total_signals
      FROM alpha_model_registry m
      ORDER BY m.is_active DESC, m.model_id
    `);

    // Get latest performance for each model at each window
    const perfRes = await pool.query(`
      SELECT DISTINCT ON (model_id, window_days)
        model_id, window_days, evaluation_date,
        hit_rate, ic, mae, sharpe, long_short_return, n_predictions
      FROM alpha_model_performance
      ORDER BY model_id, window_days, evaluation_date DESC
    `);

    // Group performance by model
    const perfMap = new Map<string, Record<number, Record<string, number | null>>>();
    for (const row of perfRes.rows) {
      if (!perfMap.has(row.model_id)) perfMap.set(row.model_id, {});
      perfMap.get(row.model_id)![row.window_days] = {
        hit_rate: parseFloat(row.hit_rate),
        ic: parseFloat(row.ic),
        mae: parseFloat(row.mae),
        sharpe: parseFloat(row.sharpe),
        long_short_return: parseFloat(row.long_short_return),
        n_predictions: parseInt(row.n_predictions),
      };
    }

    const models = result.rows.map(m => ({
      ...m,
      performance: perfMap.get(m.model_id) || {},
    }));

    return secureJsonResponse({ models });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch models');
  }
}
