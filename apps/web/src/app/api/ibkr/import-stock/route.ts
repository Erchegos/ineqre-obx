/**
 * API Route: Import stock data via IBKR
 * POST /api/ibkr/import-stock
 *
 * PROTECTED ENDPOINT - Requires authentication
 *
 * Body:
 * {
 *   "symbol": "AAPL",
 *   "exchange": "SMART",
 *   "duration": "1 Y",
 *   "currency": "USD"
 * }
 *
 * Security measures:
 * - Authentication required
 * - Rate limiting (write operations)
 * - Input validation
 */

import { NextRequest } from "next/server";
import { TWSClient, SecType } from "@ineqre/ibkr";
import { rateLimit } from "@/lib/rate-limit";
import { validateBody, ibkrImportSchema } from "@/lib/validation";
import { requireAuth, secureJsonResponse, safeErrorResponse } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 60 seconds

export async function POST(req: NextRequest) {
  // Rate limiting for write operations
  const rateLimitResult = rateLimit(req, 'write');
  if (rateLimitResult) return rateLimitResult;

  // Require authentication for import operations
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    // Validate request body
    const validation = await validateBody(req, ibkrImportSchema);
    if (!validation.success) return validation.response;

    const { ticker: symbol, exchange, duration } = validation.data;
    const currency = "NOK"; // Default for OSE

    console.log(`[IBKR API] Importing ${symbol} from ${exchange}...`);

    const client = new TWSClient();

    try {
      // Connect to IB Gateway
      await client.connect();

      // Fetch historical data
      const priceData = await client.importAsset(symbol, exchange, duration, {
        secType: SecType.STK,
        currency,
      });

      if (priceData.length === 0) {
        return secureJsonResponse(
          { error: `No data found for ${symbol}` },
          { status: 404 }
        );
      }

      // TODO: Insert into database
      // await insertPriceData(priceData);

      return secureJsonResponse({
        success: true,
        symbol,
        exchange,
        dataPoints: priceData.length,
        dateRange: {
          from: priceData[0].date,
          to: priceData[priceData.length - 1].date,
        },
        sampleData: priceData.slice(-5), // Last 5 data points
      });

    } finally {
      await client.disconnect();
    }

  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error);

    if (errMessage.includes("Connection")) {
      return secureJsonResponse(
        {
          error: "IB Gateway not available",
          message: "Make sure IB Gateway is running with API enabled",
        },
        { status: 503 }
      );
    }

    return safeErrorResponse(error, "Failed to import stock data");
  }
}
