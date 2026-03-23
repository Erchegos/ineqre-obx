import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAuth, getAuthUser, safeErrorResponse, secureJsonResponse } from '@/lib/security';

/**
 * GET /api/alpha/paper/[id] — Portfolio detail with positions, equity curve, trades
 * DELETE /api/alpha/paper/[id] — Delete portfolio
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireAuth(req);
  if (authError) return authError;
  const user = getAuthUser(req);
  if (!user) return secureJsonResponse({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;

    // Portfolio
    const pRes = await pool.query(
      `SELECT * FROM alpha_paper_portfolios WHERE id = $1 AND profile = $2`,
      [id, user.profile]
    );
    if (pRes.rows.length === 0) return secureJsonResponse({ error: 'Not found' }, { status: 404 });
    const portfolio = pRes.rows[0];

    // Equity curve (NAV snapshots)
    const snapRes = await pool.query(
      `SELECT snapshot_date, nav, daily_return, positions_count,
              realized_pnl_cumulative, unrealized_pnl
       FROM alpha_paper_snapshots WHERE portfolio_id = $1
       ORDER BY snapshot_date`,
      [id]
    );

    // Recent trades (last 100)
    const tradesRes = await pool.query(
      `SELECT t.*, s.name AS stock_name
       FROM alpha_paper_trades t
       LEFT JOIN stocks s ON t.ticker = s.ticker
       WHERE t.portfolio_id = $1
       ORDER BY t.trade_date DESC, t.created_at DESC
       LIMIT 100`,
      [id]
    );

    // OBX benchmark (for comparison)
    let benchmark: { date: string; close: number }[] = [];
    if (snapRes.rows.length > 0) {
      const startDate = snapRes.rows[0].snapshot_date;
      const bRes = await pool.query(
        `SELECT date, close FROM prices_daily
         WHERE ticker = 'OBX' AND date >= $1 ORDER BY date`,
        [startDate]
      );
      benchmark = bRes.rows;
    }

    return secureJsonResponse({
      portfolio,
      equityCurve: snapRes.rows,
      trades: tradesRes.rows,
      benchmark,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch portfolio');
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireAuth(req);
  if (authError) return authError;
  const user = getAuthUser(req);
  if (!user) return secureJsonResponse({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const result = await pool.query(
      `DELETE FROM alpha_paper_portfolios WHERE id = $1 AND profile = $2 RETURNING id`,
      [id, user.profile]
    );
    if (result.rows.length === 0) return secureJsonResponse({ error: 'Not found' }, { status: 404 });
    return secureJsonResponse({ deleted: true });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to delete portfolio');
  }
}
