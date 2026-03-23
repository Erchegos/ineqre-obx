import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAuth, getAuthUser, safeErrorResponse, secureJsonResponse } from '@/lib/security';

/**
 * GET /api/alpha/paper — List paper portfolios (scoped by profile)
 * POST /api/alpha/paper — Create new paper portfolio
 */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;
  const user = getAuthUser(req);
  if (!user) return secureJsonResponse({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await pool.query(`
      SELECT p.*,
        (SELECT nav FROM alpha_paper_snapshots WHERE portfolio_id = p.id ORDER BY snapshot_date DESC LIMIT 1) AS latest_nav,
        (SELECT daily_return FROM alpha_paper_snapshots WHERE portfolio_id = p.id ORDER BY snapshot_date DESC LIMIT 1) AS latest_daily_return,
        (SELECT COUNT(*) FROM alpha_paper_trades WHERE portfolio_id = p.id) AS trade_count,
        (SELECT COUNT(*) FROM alpha_paper_snapshots WHERE portfolio_id = p.id) AS snapshot_count
      FROM alpha_paper_portfolios p
      WHERE p.profile = $1
      ORDER BY p.is_active DESC, p.created_at DESC
    `, [user.profile]);

    return secureJsonResponse({ portfolios: result.rows });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch paper portfolios');
  }
}

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;
  const user = getAuthUser(req);
  if (!user) return secureJsonResponse({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const {
      name, strategy = 'signal_weighted', model_id = 'ensemble_v3',
      initial_capital = 10000000, max_positions = 15,
      max_position_pct = 0.10, rebalance_freq_days = 21,
      cost_bps = 10,
    } = body;

    if (!name) return secureJsonResponse({ error: 'Name required' }, { status: 400 });

    const result = await pool.query(`
      INSERT INTO alpha_paper_portfolios
        (name, strategy, model_id, initial_capital, current_value,
         max_positions, max_position_pct, rebalance_freq_days, cost_bps, profile)
      VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [name, strategy, model_id, initial_capital, max_positions,
        max_position_pct, rebalance_freq_days, cost_bps, user.profile]);

    return secureJsonResponse({ portfolio: result.rows[0] }, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to create paper portfolio');
  }
}
