import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { tickerSchema, clampInt } from "@/lib/validation";
import { secureJsonResponse, safeErrorResponse } from "@/lib/security";
import { findOptimalWindow, calculateStdChannel } from "@/lib/std-channel";

export const dynamic = "force-dynamic";

type RawRow = {
  date: unknown;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
};

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toISODate(d: unknown): string {
  const s = String(d);
  if (s.length >= 10 && s[4] === "-" && s[7] === "-") return s.slice(0, 10);
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return s.slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

/**
 * GET /api/std-channel/[ticker]
 *
 * Calculate standard deviation channel for a stock's price history.
 * Finds optimal lookback window (255-1530 bars) that maximizes R² correlation.
 * Projects the STD channel across the entire dataset.
 *
 * Query parameters:
 * - k1: First standard deviation multiplier (default: 1.0)
 * - k2: Second standard deviation multiplier (default: 2.0)
 * - minWindow: Minimum window size for optimization (default: 255, ~1 year)
 * - maxWindow: Maximum window size for optimization (default: 1530, ~6 years)
 * - step: Step size for window scanning (default: 20)
 * - limit: Maximum number of historical data points (default: 1600, max: 5000)
 * - windowSize: Fixed window size (skips optimization if provided)
 *
 * Security measures:
 * - Rate limiting (200 req/min per IP)
 * - Ticker validation (alphanumeric only, max 10 chars)
 * - Parameter bounds checking
 * - Parameterized SQL queries
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ ticker: string }> }) {
  // Rate limiting
  const rateLimitResult = rateLimit(req, 'read');
  if (rateLimitResult) return rateLimitResult;

  try {
    const { ticker: rawTicker } = await ctx.params;

    // Validate ticker parameter
    const tickerResult = tickerSchema.safeParse(rawTicker);
    if (!tickerResult.success) {
      return secureJsonResponse(
        { error: 'Invalid ticker format' },
        { status: 400 }
      );
    }
    const ticker = tickerResult.data;

    const url = new URL(req.url);

    // Parse and validate query parameters
    const k1 = clampInt(
      parseFloat(url.searchParams.get("k1") || "1.0"),
      0.1,
      10.0
    );

    const k2 = clampInt(
      parseFloat(url.searchParams.get("k2") || "2.0"),
      0.1,
      10.0
    );

    const minWindow = clampInt(
      parseInt(url.searchParams.get("minWindow") || "255", 10),
      50,
      2000
    );

    const maxWindow = clampInt(
      parseInt(url.searchParams.get("maxWindow") || "1530", 10),
      minWindow,
      3000
    );

    const step = clampInt(
      parseInt(url.searchParams.get("step") || "20", 10),
      1,
      100
    );

    const limit = clampInt(
      parseInt(url.searchParams.get("limit") || "1600", 10),
      1,
      5000
    );

    const fixedWindow = url.searchParams.get("windowSize");
    const windowSize = fixedWindow ? clampInt(parseInt(fixedWindow, 10), 2, 3000) : null;

    // Fetch historical price data with OHLC
    const q = sql`
      select
        date::date as date,
        open,
        high,
        low,
        close
      from public.prices_daily
      where upper(ticker) = upper(${ticker})
        and close is not null
      order by date desc
      limit ${limit}
    `;

    let res;
    try {
      res = await db.execute(q);
    } catch (dbError: any) {
      console.error('[DB Query Error]', {
        ticker,
        limit,
        error: dbError?.message || String(dbError),
        code: dbError?.code,
        detail: dbError?.detail,
      });
      throw dbError;
    }
    const rows = (((res as any)?.rows ?? []) as RawRow[]);

    if (rows.length < 2) {
      return secureJsonResponse({
        error: 'Insufficient data for standard deviation channel calculation',
        ticker: ticker.toUpperCase(),
        count: rows.length,
      }, { status: 404 });
    }

    // Reverse to ascending order (oldest first)
    const ordered = rows.slice().reverse();

    // Extract OHLC data
    const dates = ordered.map(r => toISODate(r.date));
    let opens = ordered.map(r => toNum(r.open));
    let highs = ordered.map(r => toNum(r.high));
    let lows = ordered.map(r => toNum(r.low));
    let closes = ordered.map(r => toNum(r.close)).filter((c): c is number => c !== null);

    // Aggressive outlier filtering: Remove bad lows/highs that create spikes
    for (let i = 0; i < closes.length; i++) {
      const c = closes[i];
      const o = opens[i];
      const h = highs[i];
      const l = lows[i];

      if (c <= 0) continue;

      // Fix bad lows - multiple checks to catch different types of errors
      if (l !== null) {
        const lowToCloseRatio = l / c;
        const avgPrice = (c + (o || c) + (h || c)) / 3;

        // Bad low if: less than 75% of close, OR less than 60% of average price
        if (lowToCloseRatio < 0.75 || l < avgPrice * 0.6) {
          lows[i] = Math.min(c, o || c);
        }

        // Additional check: if low is way below open/high/close, it's bad
        const minValidPrice = Math.min(c, o || c, h || c) * 0.90; // Allow 10% below min
        if (l < minValidPrice) {
          lows[i] = Math.min(c, o || c);
        }
      }

      // Fix bad highs - multiple checks
      if (h !== null) {
        const highToCloseRatio = h / c;
        const avgPrice = (c + (o || c) + (l || c)) / 3;

        // Bad high if: more than 125% of close, OR more than 150% of average price
        if (highToCloseRatio > 1.25 || h > avgPrice * 1.5) {
          highs[i] = Math.max(c, o || c);
        }

        // Additional check: if high is way above open/low/close, it's bad
        const maxValidPrice = Math.max(c, o || c, l || c) * 1.10; // Allow 10% above max
        if (h > maxValidPrice) {
          highs[i] = Math.max(c, o || c);
        }
      }

      // Fix bad opens
      if (o !== null) {
        const ratio = Math.abs((o - c) / c);
        if (ratio > 0.3) { // More aggressive: 30% instead of 50%
          opens[i] = c;
        }
      }
    }

    if (closes.length < 2) {
      return secureJsonResponse({
        error: 'Insufficient valid close prices',
        ticker: ticker.toUpperCase(),
      }, { status: 404 });
    }

    let optimalWindow;
    let score;
    let baseChannel;

    if (windowSize) {
      // Use fixed window size
      const window = closes.slice(-Math.min(windowSize, closes.length));
      baseChannel = calculateStdChannel(window, 1.0); // Base channel for slope/intercept
      optimalWindow = window.length;
      score = baseChannel.r2;
    } else {
      // Find optimal window that maximizes R²
      const result = findOptimalWindow(closes, minWindow, maxWindow, step, k2);
      baseChannel = result.channel;
      optimalWindow = result.windowSize;
      score = result.score; // This is now R² (not R²/sigma)
    }

    // Return ONLY the optimal window period (zoom to where channel fits best)
    // Slice all arrays to show only the last optimalWindow bars
    const windowDates = dates.slice(-optimalWindow);
    const windowOpens = opens.slice(-optimalWindow);
    const windowHighs = highs.slice(-optimalWindow);
    const windowLows = lows.slice(-optimalWindow);
    const windowCloses = closes.slice(-optimalWindow);

    // Recalculate bands with k1 and k2 for the optimal window
    const window = closes.slice(-optimalWindow);
    const channel1 = calculateStdChannel(window, k1);
    const channel2 = calculateStdChannel(window, k2);

    const data = windowDates.map((date, i) => ({
      date,
      open: windowOpens[i],
      high: windowHighs[i],
      low: windowLows[i],
      close: windowCloses[i],
      midLine: baseChannel.midLine[i],
      upperBand1: channel1.upperBand[i],
      lowerBand1: channel1.lowerBand[i],
      upperBand2: channel2.upperBand[i],
      lowerBand2: channel2.lowerBand[i],
    }));

    // REQUIREMENT: Verify STD channels actually rendered
    const hasChannelData = data.some(d =>
      d.midLine !== null ||
      d.upperBand1 !== null ||
      d.lowerBand1 !== null ||
      d.upperBand2 !== null ||
      d.lowerBand2 !== null
    );

    if (!hasChannelData) {
      return secureJsonResponse({
        error: 'Unable to calculate STD channels - insufficient data or window too large',
        ticker: ticker.toUpperCase(),
        count: data.length,
        requestedWindow: { min: minWindow, max: maxWindow },
      }, { status: 404 });
    }

    return secureJsonResponse({
      ticker: ticker.toUpperCase(),
      count: data.length,
      metadata: {
        windowSize: optimalWindow,
        k1,
        k2,
        slope: baseChannel.slope,
        intercept: baseChannel.intercept,
        sigma: baseChannel.sigma,
        r: baseChannel.r,
        r2: baseChannel.r2,
        score,
      },
      data,
    });
  } catch (e: unknown) {
    return safeErrorResponse(e, 'Failed to calculate standard deviation channel');
  }
}
