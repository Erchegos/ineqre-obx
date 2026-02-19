/**
 * API proxy to Python ML volatility service — with DB cache.
 *
 * Priority:
 *   1. Read pre-computed results from `volatility_models` table (instant)
 *   2. Fall back to live Python ML service call (slow, ~10-30s)
 *
 * GET /api/volatility/ml/{ticker}
 *   → returns GARCH, MSGARCH, VaR, VaR backtest, jump detection
 *
 * GET /api/volatility/ml/{ticker}?model=garch|regime|msgarch|var|var-backtest|jumps
 *   → returns specific model (live only, not cached per-model)
 *
 * GET /api/volatility/ml/{ticker}?fresh=true
 *   → skip DB cache and call Python directly
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

export const dynamic = "force-dynamic";

// ─── DB Cache ─────────────────────────────────────────────────────

async function getCachedResult(ticker: string): Promise<any | null> {
  try {
    const result = await pool.query(
      `SELECT model_data, computed_date
       FROM volatility_models
       WHERE ticker = $1
       ORDER BY computed_date DESC
       LIMIT 1`,
      [ticker.toUpperCase()]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const data = typeof row.model_data === "string"
      ? JSON.parse(row.model_data)
      : row.model_data;

    // Add cache metadata
    data._cached = true;
    data._computed_date = row.computed_date;

    return data;
  } catch (e) {
    console.warn("[ML API] DB cache read failed:", e);
    return null;
  }
}

// ─── Live Python call ─────────────────────────────────────────────

async function callPythonService(
  ticker: string,
  model: string,
  queryParams: URLSearchParams
): Promise<Response> {
  let endpoint: string;

  switch (model) {
    case "garch":
      endpoint = `/volatility/garch/${encodeURIComponent(ticker)}`;
      break;
    case "regime":
      endpoint = `/volatility/regime/${encodeURIComponent(ticker)}`;
      break;
    case "msgarch":
      endpoint = `/volatility/msgarch/${encodeURIComponent(ticker)}`;
      break;
    case "var":
      endpoint = `/volatility/var/${encodeURIComponent(ticker)}`;
      break;
    case "var-backtest":
      endpoint = `/volatility/var-backtest/${encodeURIComponent(ticker)}`;
      break;
    case "jumps":
      endpoint = `/volatility/jumps/${encodeURIComponent(ticker)}`;
      break;
    case "full":
    default:
      endpoint = `/volatility/full/${encodeURIComponent(ticker)}`;
      break;
  }

  const url = `${ML_SERVICE_URL}${endpoint}?${queryParams.toString()}`;

  return fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
}

// ─── Route Handler ────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const searchParams = request.nextUrl.searchParams;
  const model = searchParams.get("model") || "full";
  const fresh = searchParams.get("fresh") === "true";
  const limit = searchParams.get("limit") || "1260";
  const nStates = searchParams.get("n_states") || "2";
  const confidence = searchParams.get("confidence") || "0.99";

  // Validate ticker
  if (!/^[A-Za-z0-9._-]{1,15}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  // 1. Try DB cache first (only for "full" model, not per-model queries)
  if (model === "full" && !fresh) {
    const cached = await getCachedResult(ticker);
    if (cached) {
      return NextResponse.json(cached);
    }
  }

  // 2. Fall back to live Python service
  const queryParams = new URLSearchParams({ limit });
  if (model === "regime" || model === "msgarch") queryParams.set("n_states", nStates);
  if (model === "var-backtest") queryParams.set("confidence", confidence);

  try {
    const res = await callPythonService(ticker, model, queryParams);

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `ML service error: ${text}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    if (e?.name === "AbortError" || e?.name === "TimeoutError") {
      return NextResponse.json(
        { error: "ML service timeout — model computation took too long" },
        { status: 504 }
      );
    }
    return NextResponse.json(
      {
        error: "ML service unavailable",
        detail:
          "No cached models found. Start the Python ML service: cd ml-service && uvicorn app.main:app --port 8000",
      },
      { status: 503 }
    );
  }
}
