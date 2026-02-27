import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ─── In-memory cache ──────────────────────────────────────────────
let cachedResult: unknown = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let computing = false;

const DEFAULT_CONFIG = {
  tickers: [
    "STB", "DNB", "ABG", "NONG", "PROT", "MING",
    "ATEA", "YAR", "FRO", "WWI", "AKER", "ORK",
  ],
  mode: "max_sharpe",
  constraints: {
    maxPositionSize: 0.20,
    minPositionSize: 0.01,
    maxSectorExposure: 0.30,
    excludeTickers: [],
  },
  forceIncludeAll: true,
  lookbackDays: 504,
  portfolioValueNOK: 10_000_000,
  riskFreeRate: 0.045,
  covarianceMethod: "shrinkage",
};

export async function GET() {
  const now = Date.now();

  // Serve from cache if fresh
  if (cachedResult && (now - cachedAt) < CACHE_TTL_MS) {
    return NextResponse.json(cachedResult, {
      headers: {
        'X-Cache': 'HIT',
        'X-Cache-Age': String(Math.round((now - cachedAt) / 1000)),
      },
    });
  }

  // Prevent thundering herd — if already computing, serve stale or wait
  if (computing && cachedResult) {
    return NextResponse.json(cachedResult, {
      headers: { 'X-Cache': 'STALE' },
    });
  }

  computing = true;
  try {
    // Call the optimize endpoint internally via fetch to localhost
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
      || process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`
      || 'http://localhost:3000';

    const res = await fetch(`${baseUrl}/api/portfolio/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DEFAULT_CONFIG),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Optimize failed' }));
      // If we have stale cache, serve it
      if (cachedResult) {
        return NextResponse.json(cachedResult, {
          headers: { 'X-Cache': 'STALE-ERROR' },
        });
      }
      return NextResponse.json(err, { status: res.status });
    }

    const data = await res.json();
    cachedResult = data;
    cachedAt = Date.now();

    return NextResponse.json(data, {
      headers: { 'X-Cache': 'MISS' },
    });
  } catch (error) {
    // Serve stale on error
    if (cachedResult) {
      return NextResponse.json(cachedResult, {
        headers: { 'X-Cache': 'STALE-ERROR' },
      });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Default portfolio failed' },
      { status: 500 }
    );
  } finally {
    computing = false;
  }
}
