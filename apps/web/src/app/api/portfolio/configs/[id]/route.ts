import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAuth } from '@/lib/security';

export const dynamic = 'force-dynamic';

/** GET /api/portfolio/configs/[id] — Load a specific portfolio configuration */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const numId = parseInt(id);
  if (isNaN(numId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM portfolio_configs WHERE id = $1',
      [numId]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ config: result.rows[0] });
  } catch (error) {
    console.error('Portfolio config load error:', error);
    return NextResponse.json({ error: 'Failed to load config' }, { status: 500 });
  }
}

/** PUT /api/portfolio/configs/[id] — Update a portfolio configuration */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const numId = parseInt(id);
  if (isNaN(numId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const {
      name, description, tickers, weights, optimization_mode,
      constraints, portfolio_value_nok, lookback_days, covariance_method
    } = body;

    const result = await pool.query(
      `UPDATE portfolio_configs
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           tickers = COALESCE($3, tickers),
           weights = COALESCE($4, weights),
           optimization_mode = COALESCE($5, optimization_mode),
           constraints = COALESCE($6, constraints),
           portfolio_value_nok = COALESCE($7, portfolio_value_nok),
           lookback_days = COALESCE($8, lookback_days),
           covariance_method = COALESCE($9, covariance_method),
           updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        name || null,
        description || null,
        tickers || null,
        weights || null,
        optimization_mode || null,
        constraints ? JSON.stringify(constraints) : null,
        portfolio_value_nok || null,
        lookback_days || null,
        covariance_method || null,
        numId,
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ config: result.rows[0] });
  } catch (error) {
    console.error('Portfolio config update error:', error);
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
}

/** DELETE /api/portfolio/configs/[id] — Delete a portfolio configuration */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const numId = parseInt(id);
  if (isNaN(numId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    const result = await pool.query(
      'DELETE FROM portfolio_configs WHERE id = $1 RETURNING id',
      [numId]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Portfolio config delete error:', error);
    return NextResponse.json({ error: 'Failed to delete config' }, { status: 500 });
  }
}
