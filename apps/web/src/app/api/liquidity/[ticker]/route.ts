/**
 * Liquidity Analysis API Endpoint
 * GET /api/liquidity/[ticker]
 *
 * Returns liquidity regime classification and trading implications.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { detectLiquidityRegime, formatLiquidityDisplay } from '@/lib/liquidityRegime';
import { secureJsonResponse, safeErrorResponse } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{
    ticker: string;
  }>;
}

export async function GET(
  req: NextRequest,
  { params }: RouteParams
) {
  try {
    const { ticker } = await params;

    if (!ticker || typeof ticker !== 'string') {
      return secureJsonResponse(
        { error: 'Invalid ticker parameter' },
        { status: 400 }
      );
    }

    // Get volume data for the ticker (last 90 days)
    const result = await pool.query(
      `SELECT date, volume, close
       FROM prices_daily
       WHERE ticker = $1
       AND volume IS NOT NULL
       AND close IS NOT NULL
       ORDER BY date DESC
       LIMIT 90`,
      [ticker.toUpperCase()]
    );

    if (result.rows.length < 30) {
      return secureJsonResponse(
        {
          error: 'Insufficient data',
          message: `Need at least 30 days of volume data. Found ${result.rows.length} days.`,
        },
        { status: 404 }
      );
    }

    // Reverse to chronological order
    const volumeData = result.rows.reverse().map(row => ({
      date: row.date.toISOString().split('T')[0],
      volume: parseFloat(row.volume),
      close: parseFloat(row.close),
    }));

    // Detect liquidity regime
    const metrics = detectLiquidityRegime(volumeData, ticker.toUpperCase(), 60);

    if (!metrics) {
      return secureJsonResponse(
        { error: 'Failed to calculate liquidity metrics' },
        { status: 500 }
      );
    }

    // Format for display
    const display = formatLiquidityDisplay(metrics);

    return secureJsonResponse({
      ticker: ticker.toUpperCase(),
      liquidity: metrics,
      display,
      dataPoints: volumeData.length,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to analyze liquidity');
  }
}
