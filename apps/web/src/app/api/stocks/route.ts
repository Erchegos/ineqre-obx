import { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { validateQuery, stocksQuerySchema } from "@/lib/validation";
import { secureJsonResponse, safeErrorResponse } from "@/lib/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/stocks
 *
 * List all stocks with basic info. Public endpoint.
 *
 * Query parameters:
 * - assetTypes: comma-separated list of asset types to include
 *   Valid values: equity, index, commodity_etf, index_etf
 *   Default: equity (equities only)
 *   Example: ?assetTypes=equity,index
 *
 * Security measures:
 * - Rate limiting (100 req/min per IP)
 * - Input validation
 * - Secure error handling (no internal details exposed)
 * - Security headers on response
 */
export async function GET(req: NextRequest) {
  // Rate limiting for public endpoints
  const rateLimitResult = rateLimit(req, 'public');
  if (rateLimitResult) return rateLimitResult;

  try {
    // Validate query parameters
    const searchParams = req.nextUrl.searchParams;
    const validation = validateQuery(searchParams, stocksQuerySchema);
    if (!validation.success) return validation.response;

    const { assetTypes } = validation.data;

    console.log('[STOCKS API] Starting query...');
    console.log('[STOCKS API] Asset types filter:', assetTypes);

    // Build query with asset type filter
    const query = `
      SELECT
        s.ticker,
        s.name,
        s.asset_type,
        (ARRAY_AGG(p.close ORDER BY p.date DESC))[1] as last_close,
        (ARRAY_AGG(p.adj_close ORDER BY p.date DESC))[1] as last_adj_close,
        MIN(p.date) as start_date,
        MAX(p.date) as end_date,
        COUNT(*) as rows
      FROM stocks s
      INNER JOIN prices_daily p ON s.ticker = p.ticker
      WHERE p.close IS NOT NULL
        AND p.close > 0
        AND s.asset_type = ANY($1)
      GROUP BY s.ticker, s.name, s.asset_type
      HAVING COUNT(*) >= 100
      ORDER BY s.ticker
    `;

    console.log('[STOCKS API] Executing query...');
    const result = await pool.query(query, [assetTypes]);
    console.log(`[STOCKS API] Successfully fetched ${result.rows.length} assets`);

    const stocks = result.rows.map((row) => ({
      ticker: row.ticker,
      name: row.name || row.ticker,
      asset_type: row.asset_type || 'equity',
      last_close: Number(row.last_close || 0),
      last_adj_close: row.last_adj_close ? Number(row.last_adj_close) : Number(row.last_close || 0),
      start_date: row.start_date instanceof Date
        ? row.start_date.toISOString().slice(0, 10)
        : String(row.start_date).slice(0, 10),
      end_date: row.end_date instanceof Date
        ? row.end_date.toISOString().slice(0, 10)
        : String(row.end_date).slice(0, 10),
      rows: Number(row.rows),
    }));

    return secureJsonResponse(stocks);
  } catch (e: unknown) {
    // Don't expose internal database error details to clients
    return safeErrorResponse(e, 'Failed to fetch stocks data');
  }
}
