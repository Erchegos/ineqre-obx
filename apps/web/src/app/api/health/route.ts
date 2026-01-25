import { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { secureJsonResponse } from "@/lib/security";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Health check endpoint for monitoring.
 *
 * SECURITY: This endpoint is intentionally minimal to avoid
 * information disclosure. It only returns:
 * - status: "healthy" or "unhealthy"
 * - timestamp
 *
 * Internal details (table names, counts, error messages) are NOT exposed.
 */
export async function GET(req: NextRequest) {
  // Rate limit health checks to prevent abuse
  const rateLimitResult = rateLimit(req, 'public');
  if (rateLimitResult) return rateLimitResult;

  try {
    // Simple database connectivity check - no details exposed
    await pool.query("SELECT 1");

    return secureJsonResponse({
      status: "healthy",
      timestamp: new Date().toISOString(),
    });

  } catch (error: unknown) {
    // Log error internally but don't expose details
    console.error('[Health Check] Database connection failed:', error);

    return secureJsonResponse(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}