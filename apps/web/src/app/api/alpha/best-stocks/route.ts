import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAlphaAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';
import type { SimParams, SimStats, SimTrade } from '@/lib/mlTradingEngine';

/**
 * GET /api/alpha/best-stocks
 *
 * Cache-only: reads pre-computed walk-forward results from alpha_result_cache.
 * Heavy computation runs nightly via scripts/precompute-alpha.ts
 * (GitHub Actions ml-pipeline.yml, step "Precompute Alpha Engine cache").
 *
 * Returns { status: 'pending' } if no fresh cache exists — client should
 * show "Computing..." and retry after a few minutes.
 */

const CACHE_KEY      = 'best_stocks_v4_365d_walk_forward';
const CACHE_MAX_AGE_H = 25; // slightly > 24h to tolerate minor scheduling drift

export interface BestStockResult {
  rank: number;
  ticker: string;
  name: string;
  sector: string;
  avg_nokvol: number;
  bestParams: SimParams;
  stats: SimStats;
  trades: SimTrade[];
  combosRun: number;
  windowsSelected: number;
}

export interface ForwardTrade extends SimTrade {
  ticker: string;
}

export async function GET(req: NextRequest) {
  const authError = requireAlphaAuth(req);
  if (authError) return authError;

  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS alpha_result_cache (
      cache_key TEXT PRIMARY KEY, result JSONB NOT NULL, computed_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    const cached = await pool.query(
      `SELECT result, computed_at FROM alpha_result_cache
       WHERE cache_key = $1 AND computed_at > NOW() - INTERVAL '${CACHE_MAX_AGE_H} hours'`,
      [CACHE_KEY]
    );

    if (cached.rows.length > 0) {
      return secureJsonResponse(cached.rows[0].result);
    }

    // No fresh cache — computation runs nightly via precompute-alpha.ts script
    return secureJsonResponse({
      status: 'pending',
      message: 'Walk-forward results are being computed nightly. Check back in a few minutes or tomorrow after 02:00 UTC.',
      bestStocks: [],
      allForwardTrades: [],
      meta: { computedAt: null },
    });
  } catch (error) {
    return safeErrorResponse(error, 'Best stocks cache read failed');
  }
}
