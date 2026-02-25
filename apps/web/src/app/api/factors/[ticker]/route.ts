/**
 * GET /api/factors/:ticker
 *
 * Returns calculated factors for a specific ticker
 * Query params:
 *   - startDate: Start date (YYYY-MM-DD)
 *   - endDate: End date (YYYY-MM-DD)
 *   - type: fundamental | technical | all (default: all)
 *   - limit: Max number of rows (default: 252)
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.enum(["fundamental", "technical", "all"]).optional().default("all"),
  limit: z.coerce.number().int().min(1).max(5000).optional().default(252),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker: rawTicker } = await params;

    // Validate ticker
    const ticker = rawTicker.toUpperCase().trim();
    if (!/^[A-Z0-9.]{1,10}$/.test(ticker)) {
      return NextResponse.json(
        { error: "Invalid ticker format" },
        { status: 400 }
      );
    }

    // Parse query params
    const { searchParams } = new URL(req.url);
    const validation = querySchema.safeParse({
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      type: searchParams.get("type") || undefined,
      limit: searchParams.get("limit") || undefined,
    });

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: validation.error.errors },
        { status: 400 }
      );
    }

    const { startDate, endDate, type, limit } = validation.data;

    // Build query based on type
    let query = "";
    const queryParams: any[] = [ticker];

    if (type === "all") {
      query = `
        SELECT
          ft.ticker,
          ft.date,
          -- Technical factors (momentum)
          ft.mom1m, ft.mom6m, ft.mom11m, ft.mom36m, ft.chgmom,
          -- Technical factors (volatility)
          ft.vol1m, ft.vol3m, ft.vol12m, ft.maxret, ft.beta, ft.ivol,
          ft.dum_jan,
          -- Fundamental factors (forward-filled)
          ff.bm, ff.nokvol, ff.ep, ff.dy, ff.sp, ff.sg, ff.mktcap, ff.ev_ebitda,
          ff.is_forward_filled
        FROM factor_technical ft
        LEFT JOIN LATERAL (
          SELECT * FROM factor_fundamentals ff2
          WHERE ff2.ticker = ft.ticker AND ff2.date <= ft.date
          ORDER BY ff2.date DESC
          LIMIT 1
        ) ff ON true
        WHERE ft.ticker = $1
      `;
    } else if (type === "technical") {
      query = `
        SELECT * FROM factor_technical
        WHERE ticker = $1
      `;
    } else {
      query = `
        SELECT * FROM factor_fundamentals
        WHERE ticker = $1
      `;
    }

    // Add date filters (use qualified column name for "all" type)
    const dateCol = type === "all" ? "ft.date" : "date";
    if (startDate) {
      queryParams.push(startDate);
      query += ` AND ${dateCol} >= $${queryParams.length}`;
    }
    if (endDate) {
      queryParams.push(endDate);
      query += ` AND ${dateCol} <= $${queryParams.length}`;
    }

    query += ` ORDER BY ${dateCol} DESC LIMIT $${queryParams.length + 1}`;
    queryParams.push(limit);

    const result = await pool.query(query, queryParams);

    return NextResponse.json({
      success: true,
      ticker,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error: any) {
    console.error("Factors API error:", error);
    return NextResponse.json(
      { error: "Internal server error", message: error.message },
      { status: 500 }
    );
  }
}
