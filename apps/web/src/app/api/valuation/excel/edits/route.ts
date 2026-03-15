import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAuth, getAuthUser, secureJsonResponse, safeErrorResponse } from "@/lib/security";

export const dynamic = "force-dynamic";

/**
 * GET /api/valuation/excel/edits?ticker=STB
 * Load saved spreadsheet edits for a ticker.
 * - With auth: returns the user's own saved model (scoped by profile)
 * - Without auth: returns the most recently updated model for this ticker (any profile)
 *   so that logged-out users can see a blurred preview
 */
export async function GET(req: NextRequest) {
  // List mode: return all tickers that have saved edits
  if (req.nextUrl.searchParams.get("list") === "true") {
    try {
      const result = await pool.query(
        `SELECT DISTINCT ticker FROM spreadsheet_edits ORDER BY ticker`
      );
      return secureJsonResponse({
        success: true,
        tickers: result.rows.map((r: { ticker: string }) => r.ticker),
      });
    } catch (error) {
      return safeErrorResponse(error, "Failed to list edits");
    }
  }

  const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase();
  if (!ticker || !/^[A-Z0-9.]{1,20}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  try {
    // Check if user is authenticated (don't require it)
    const user = getAuthUser(req);

    let result;
    if (user) {
      // Authenticated: return user's own model
      result = await pool.query(
        `SELECT sheet_data, version, updated_at, profile
         FROM spreadsheet_edits
         WHERE ticker = $1 AND profile = $2`,
        [ticker, user.profile]
      );
    } else {
      // Public: return most recently updated model for this ticker (any profile)
      result = await pool.query(
        `SELECT sheet_data, version, updated_at, profile
         FROM spreadsheet_edits
         WHERE ticker = $1
         ORDER BY updated_at DESC
         LIMIT 1`,
        [ticker]
      );
    }

    if (result.rows.length === 0) {
      return secureJsonResponse({ edits: null });
    }

    const row = result.rows[0];
    return secureJsonResponse({
      edits: row.sheet_data,
      version: row.version,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    return safeErrorResponse(error, "Failed to load edits");
  }
}

/**
 * POST /api/valuation/excel/edits
 * Save spreadsheet edits (auth required, UPSERT by ticker+profile)
 */
export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const user = getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { ticker, sheetData } = body;

    if (!ticker || !/^[A-Z0-9.]{1,20}$/i.test(ticker)) {
      return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
    }

    if (!sheetData || !Array.isArray(sheetData)) {
      return NextResponse.json({ error: "Invalid sheet data" }, { status: 400 });
    }

    const result = await pool.query(
      `INSERT INTO spreadsheet_edits (ticker, profile, sheet_data, version)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (ticker, profile) DO UPDATE
       SET sheet_data = $3, version = spreadsheet_edits.version + 1, updated_at = NOW()
       RETURNING version, updated_at`,
      [ticker.toUpperCase(), user.profile, JSON.stringify(sheetData)]
    );

    return secureJsonResponse({
      success: true,
      version: result.rows[0].version,
      updatedAt: result.rows[0].updated_at,
    });
  } catch (error) {
    return safeErrorResponse(error, "Failed to save edits");
  }
}

/**
 * DELETE /api/valuation/excel/edits?ticker=STB
 * Delete saved edits (revert to original Excel)
 */
export async function DELETE(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const user = getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase();
  if (!ticker || !/^[A-Z0-9.]{1,20}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  try {
    await pool.query(
      `DELETE FROM spreadsheet_edits WHERE ticker = $1 AND profile = $2`,
      [ticker, user.profile]
    );

    return secureJsonResponse({ deleted: true });
  } catch (error) {
    return safeErrorResponse(error, "Failed to delete edits");
  }
}
