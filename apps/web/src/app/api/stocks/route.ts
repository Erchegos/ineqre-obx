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
    // Uses CTEs with DISTINCT ON for O(N_tickers) index seeks instead of
    // ARRAY_AGG (O(N_rows × log N)) and LATERAL (N independent subqueries).
    const query = `
      WITH latest_prices AS (
        SELECT DISTINCT ON (p.ticker)
          p.ticker,
          p.close       AS last_close,
          p.adj_close   AS last_adj_close,
          p.date        AS end_date
        FROM prices_daily p
        INNER JOIN stocks s ON s.ticker = p.ticker
        WHERE s.asset_type = ANY($1)
          AND p.close IS NOT NULL
          AND p.close > 0
        ORDER BY p.ticker, p.date DESC
      ),
      price_stats AS (
        SELECT
          p.ticker,
          MIN(p.date) AS start_date,
          COUNT(*)    AS rows
        FROM prices_daily p
        INNER JOIN stocks s ON s.ticker = p.ticker
        WHERE s.asset_type = ANY($1)
          AND p.close IS NOT NULL
          AND p.close > 0
        GROUP BY p.ticker
        HAVING COUNT(*) >= 100
      ),
      latest_mktcap AS (
        SELECT DISTINCT ON (ff.ticker)
          ff.ticker,
          ff.mktcap
        FROM factor_fundamentals ff
        WHERE ff.mktcap IS NOT NULL
        ORDER BY ff.ticker, ff.date DESC
      )
      SELECT
        s.ticker,
        s.name,
        s.asset_type,
        s.sector,
        s.currency,
        lp.last_close,
        COALESCE(lp.last_adj_close, lp.last_close) AS last_adj_close,
        ps.start_date,
        lp.end_date,
        ps.rows,
        lm.mktcap
      FROM stocks s
      INNER JOIN latest_prices lp ON lp.ticker = s.ticker
      INNER JOIN price_stats   ps ON ps.ticker  = s.ticker
      LEFT  JOIN latest_mktcap lm ON lm.ticker  = s.ticker
      WHERE s.asset_type = ANY($1)
      ORDER BY s.ticker
    `;

    console.log('[STOCKS API] Executing query...');
    const result = await pool.query(query, [assetTypes]);
    console.log(`[STOCKS API] Successfully fetched ${result.rows.length} assets`);

    const stocks = result.rows.map((row) => ({
      ticker: row.ticker,
      name: row.name || row.ticker,
      asset_type: row.asset_type || 'equity',
      sector: row.sector || null,
      currency: row.currency || 'NOK',
      last_close: Number(row.last_close || 0),
      last_adj_close: row.last_adj_close ? Number(row.last_adj_close) : Number(row.last_close || 0),
      start_date: row.start_date instanceof Date
        ? row.start_date.toISOString().slice(0, 10)
        : String(row.start_date).slice(0, 10),
      end_date: row.end_date instanceof Date
        ? row.end_date.toISOString().slice(0, 10)
        : String(row.end_date).slice(0, 10),
      rows: Number(row.rows),
      mktcap: row.mktcap ? Number(row.mktcap) : null,
    }));

    return secureJsonResponse(stocks, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (e: unknown) {
    // Don't expose internal database error details to clients
    return safeErrorResponse(e, 'Failed to fetch stocks data');
  }
}
