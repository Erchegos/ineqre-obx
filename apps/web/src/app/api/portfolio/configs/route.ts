import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAuth, getAuthUser } from '@/lib/security';

export const dynamic = 'force-dynamic';

/** GET /api/portfolio/configs — List saved portfolios (filtered by profile) */
export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const user = getAuthUser(req);
  const profile = user?.profile || 'default';

  try {
    const result = await pool.query(
      `SELECT id, name, description, tickers, weights, optimization_mode,
              constraints, portfolio_value_nok, lookback_days, covariance_method,
              profile, created_at, updated_at
       FROM portfolio_configs
       WHERE profile = $1
       ORDER BY updated_at DESC`,
      [profile]
    );
    return NextResponse.json({ configs: result.rows, profile });
  } catch (error) {
    console.error('Portfolio configs list error:', error);
    return NextResponse.json({ error: 'Failed to load configs' }, { status: 500 });
  }
}

/** POST /api/portfolio/configs — Save a new portfolio configuration */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const user = getAuthUser(req);
  const profile = user?.profile || 'default';

  try {
    const body = await req.json();
    const {
      name, description, tickers, weights, optimization_mode,
      constraints, portfolio_value_nok, lookback_days, covariance_method
    } = body;

    if (!name || !tickers || !weights) {
      return NextResponse.json({ error: 'name, tickers, and weights are required' }, { status: 400 });
    }

    const result = await pool.query(
      `INSERT INTO portfolio_configs
        (name, description, tickers, weights, optimization_mode, constraints,
         portfolio_value_nok, lookback_days, covariance_method, profile)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        name,
        description || null,
        tickers,
        weights,
        optimization_mode || 'min_variance',
        JSON.stringify(constraints || {}),
        portfolio_value_nok || 10000000,
        lookback_days || 504,
        covariance_method || 'shrinkage',
        profile,
      ]
    );

    return NextResponse.json({ config: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error('Portfolio config save error:', error);
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
  }
}
