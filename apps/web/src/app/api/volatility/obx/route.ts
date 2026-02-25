/**
 * OBX Index-Level Volatility Dashboard API
 *
 * GET /api/volatility/obx?limit=504
 *
 * Returns:
 *   - OBX index volatility (full metrics + regime)
 *   - All OSE constituent volatility snapshots
 *   - Cross-constituent average pairwise correlation
 *   - Volatility cone (percentile bands at multiple windows)
 */

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getPriceTable } from "@/lib/price-data-adapter";
import {
  computeVolatilityMeasures,
  currentVolatilityPercentile,
  calculateRegimeDuration,
  type RegimePoint,
} from "@/lib/volatility";
import { computeReturns } from "@/lib/metrics";
import {
  classifyRegime,
  determineVolatilityTrend,
  getRegimeInterpretation,
  getRegimeColor,
} from "@/lib/regimeClassification";

export const dynamic = "force-dynamic";

type PriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

function sanitizeNumber(n: number | undefined): number | null {
  if (n === undefined || isNaN(n) || !isFinite(n)) return null;
  return n;
}

// --- Fetch all OSE equity tickers ---
async function fetchOseEquities(): Promise<string[]> {
  const tableName = await getPriceTable();
  const q = `
    SELECT DISTINCT upper(s.ticker) as ticker
    FROM stocks s
    INNER JOIN ${tableName} p ON upper(s.ticker) = upper(p.ticker)
    WHERE s.is_active = true
      AND (s.asset_type = 'equity' OR s.asset_type IS NULL)
      AND p.close IS NOT NULL AND p.close > 0
    GROUP BY upper(s.ticker)
    HAVING COUNT(*) >= 100
    ORDER BY upper(s.ticker)
  `;
  const result = await pool.query(q);
  return result.rows.map((r: { ticker: string }) => r.ticker).filter((t: string) => t !== "OBX");
}

// --- Fetch price bars for a single ticker ---
async function fetchBars(ticker: string, limit: number): Promise<PriceBar[]> {
  const tableName = await getPriceTable();
  const q = `
    SELECT date::date as date, open, high, low, close, adj_close
    FROM ${tableName}
    WHERE upper(ticker) = upper($1) AND close IS NOT NULL AND close > 0
    ORDER BY date DESC
    LIMIT $2
  `;
  const result = await pool.query(q, [ticker, limit]);
  return result.rows
    .map((r: any) => ({
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.adj_close || r.close),
    }))
    .reverse();
}

// --- Bulk fetch price bars for ALL tickers in one query ---
async function fetchAllConstituentBars(
  tickers: string[],
  limit: number
): Promise<Map<string, PriceBar[]>> {
  if (tickers.length === 0) return new Map();
  const tableName = await getPriceTable();

  // Use window function to get latest N bars per ticker in a single query
  const q = `
    SELECT ticker_upper, date, open, high, low, close FROM (
      SELECT
        upper(p.ticker) AS ticker_upper,
        p.date::date AS date,
        p.open, p.high, p.low,
        COALESCE(p.adj_close, p.close) AS close,
        ROW_NUMBER() OVER (PARTITION BY upper(p.ticker) ORDER BY p.date DESC) AS rn
      FROM ${tableName} p
      WHERE upper(p.ticker) = ANY($1)
        AND p.close IS NOT NULL AND p.close > 0
    ) sub
    WHERE rn <= $2
    ORDER BY ticker_upper, date ASC
  `;

  const result = await pool.query(q, [tickers, limit]);

  const barsByTicker = new Map<string, PriceBar[]>();
  for (const r of result.rows) {
    const t = r.ticker_upper;
    if (!barsByTicker.has(t)) barsByTicker.set(t, []);
    barsByTicker.get(t)!.push({
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
    });
  }

  return barsByTicker;
}

// --- Compute quick vol snapshot for a constituent ---
function computeConstituentSnapshot(bars: PriceBar[], ticker: string) {
  if (bars.length < 30) return null;
  const closes = bars.map((b) => b.close);
  const returns = computeReturns(closes);
  if (returns.length < 20) return null;

  const vol = computeVolatilityMeasures(bars);
  const lastVol = vol[vol.length - 1];
  if (!lastVol) return null;

  const yangZhang = lastVol.yangZhang ?? lastVol.rolling20 ?? 0;
  const rolling20 = lastVol.rolling20 ?? 0;
  const rolling60 = lastVol.rolling60 ?? 0;

  const allYZ = vol.map((v) => v.yangZhang ?? v.rolling20 ?? null);
  const percentile = currentVolatilityPercentile(yangZhang, allYZ);
  const trend = determineVolatilityTrend(rolling20, rolling60);
  const volRatio = rolling60 > 0 ? rolling20 / rolling60 : undefined;
  const regime = classifyRegime(percentile ?? 50, trend, volRatio);

  return {
    ticker,
    regime,
    regimeColor: getRegimeColor(regime),
    vol: sanitizeNumber(yangZhang),
    rolling20: sanitizeNumber(rolling20),
    rolling60: sanitizeNumber(rolling60),
    percentile: sanitizeNumber(percentile),
    trend,
    lastClose: bars[bars.length - 1]?.close ?? null,
    lastDate: bars[bars.length - 1]?.date ?? null,
    dataPoints: bars.length,
  };
}

// --- Volatility cone: compute percentile bands at multiple windows ---
function computeVolCone(bars: PriceBar[]) {
  const closes = bars.map((b) => b.close);
  const returns = computeReturns(closes);
  if (returns.length < 252) return null;

  const windows = [5, 10, 20, 60, 120, 252];
  const cone: Array<{
    window: number;
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
    current: number;
  }> = [];

  for (const w of windows) {
    if (returns.length < w + 20) continue;
    const vols: number[] = [];
    for (let i = w - 1; i < returns.length; i++) {
      const windowReturns = returns.slice(i - w + 1, i + 1);
      const mean = windowReturns.reduce((a, b) => a + b, 0) / windowReturns.length;
      const variance =
        windowReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (windowReturns.length - 1);
      vols.push(Math.sqrt(variance * 252));
    }
    if (vols.length < 10) continue;

    const sorted = [...vols].sort((a, b) => a - b);
    const pctile = (p: number) => sorted[Math.floor(sorted.length * p)] ?? 0;

    cone.push({
      window: w,
      p5: pctile(0.05),
      p25: pctile(0.25),
      p50: pctile(0.5),
      p75: pctile(0.75),
      p95: pctile(0.95),
      current: vols[vols.length - 1] ?? 0,
    });
  }

  return cone;
}

// --- Average pairwise correlation (date-aligned) ---
// constituentReturns: Map<ticker, Map<date, logReturn>>
// obxDates: ordered array of trading dates from OBX
function computeAvgPairwiseCorrelation(
  constituentReturns: Map<string, Map<string, number>>,
  obxDates: string[],
  window: number = 60
): Array<{ date: string; avgCorrelation: number }> {
  const tickers = Array.from(constituentReturns.keys());
  if (tickers.length < 3) return [];

  const n = obxDates.length;
  const result: Array<{ date: string; avgCorrelation: number }> = [];

  // Only compute every 5 days for efficiency
  for (let t = window; t < n; t += 5) {
    const windowDates = obxDates.slice(t - window, t);
    let totalCorr = 0;
    let pairs = 0;

    for (let i = 0; i < tickers.length; i++) {
      for (let j = i + 1; j < tickers.length; j++) {
        const mapA = constituentReturns.get(tickers[i])!;
        const mapB = constituentReturns.get(tickers[j])!;

        // Collect paired returns where BOTH stocks have data on the same date
        const pairsA: number[] = [];
        const pairsB: number[] = [];
        for (const d of windowDates) {
          const rA = mapA.get(d);
          const rB = mapB.get(d);
          if (rA !== undefined && rB !== undefined) {
            pairsA.push(rA);
            pairsB.push(rB);
          }
        }

        // Need at least 30 overlapping observations
        if (pairsA.length < 30) continue;

        const len = pairsA.length;
        const meanA = pairsA.reduce((a, b) => a + b, 0) / len;
        const meanB = pairsB.reduce((a, b) => a + b, 0) / len;
        let covAB = 0, varA = 0, varB = 0;
        for (let k = 0; k < len; k++) {
          const dA = pairsA[k] - meanA;
          const dB = pairsB[k] - meanB;
          covAB += dA * dB;
          varA += dA * dA;
          varB += dB * dB;
        }
        if (varA > 0 && varB > 0) {
          totalCorr += covAB / Math.sqrt(varA * varB);
          pairs++;
        }
      }
    }

    if (pairs > 0) {
      result.push({
        date: obxDates[t],
        avgCorrelation: totalCorr / pairs,
      });
    }
  }

  return result;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "504", 10), 100), 2000);

  try {
    // 1. Fetch OBX index bars + OSE constituents list in parallel
    const [obxBars, tickers] = await Promise.all([fetchBars("OBX", limit), fetchOseEquities()]);

    if (obxBars.length < 30) {
      return NextResponse.json({ error: "Insufficient OBX data" }, { status: 404 });
    }

    // 2. Compute OBX index volatility (full metrics)
    const obxVol = computeVolatilityMeasures(obxBars);
    const obxLast = obxVol[obxVol.length - 1];

    // OBX regime
    const obxYZ = obxLast?.yangZhang ?? obxLast?.rolling20 ?? 0;
    const obxR20 = obxLast?.rolling20 ?? 0;
    const obxR60 = obxLast?.rolling60 ?? 0;
    const obxAllYZ = obxVol.map((v) => v.yangZhang ?? v.rolling20 ?? null);
    const obxPercentile = currentVolatilityPercentile(obxYZ, obxAllYZ) ?? 50;
    const obxTrend = determineVolatilityTrend(obxR20, obxR60);
    const obxVolRatio = obxR60 > 0 ? obxR20 / obxR60 : undefined;
    const obxRegime = classifyRegime(obxPercentile, obxTrend, obxVolRatio);
    const obxInterpretation = getRegimeInterpretation(obxRegime, obxPercentile, obxTrend, null, "OBX");

    // Regime history for OBX (uses extended type with close for the chart)
    const barDateMap = new Map(obxBars.map((b) => [b.date, b.close]));
    const sortedAllYZ = obxVol.map((v) => v.yangZhang ?? v.rolling20 ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
    const regimeHistory: Array<{ date: string; regime: string; volatility: number; close: number }> = obxVol.map((v) => {
      const vol = v.yangZhang ?? v.rolling20 ?? 0;
      const pct = sortedAllYZ.length > 0
        ? (sortedAllYZ.filter((sv) => sv <= vol).length / sortedAllYZ.length) * 100
        : 50;
      return {
        date: v.date,
        regime: classifyRegime(pct, obxTrend),
        volatility: vol,
        close: barDateMap.get(v.date) ?? 0,
      };
    });
    // For regime duration, convert to RegimePoint (no close)
    const regimePoints: RegimePoint[] = regimeHistory.map((rh) => ({
      date: rh.date,
      regime: rh.regime,
      volatility: rh.volatility,
    }));
    const regimeDuration = calculateRegimeDuration(regimePoints);

    // Vol cone
    const volCone = computeVolCone(obxBars);

    // 3. Fetch ALL constituent bars in a single bulk query
    const allBarsByTicker = await fetchAllConstituentBars(tickers, limit);
    const constituentSnapshots: any[] = [];
    const constituentReturnByDate = new Map<string, Map<string, number>>();

    // OBX ordered dates for correlation grid (skip first bar — no return for it)
    const obxDates = obxBars.slice(1).map((b) => b.date);
    const obxDateSet = new Set(obxDates);

    for (const ticker of tickers) {
      const bars = allBarsByTicker.get(ticker);
      if (!bars || bars.length < 30) continue;

      const snapshot = computeConstituentSnapshot(bars, ticker);
      if (snapshot) {
        constituentSnapshots.push(snapshot);

        // Build date-keyed return map for correlation
        const returnMap = new Map<string, number>();
        for (let k = 1; k < bars.length; k++) {
          const d = bars[k].date;
          if (obxDateSet.has(d)) {
            returnMap.set(d, Math.log(bars[k].close / bars[k - 1].close));
          }
        }
        if (returnMap.size > 60) {
          constituentReturnByDate.set(ticker, returnMap);
        }
      }
    }

    // Sort by vol descending
    constituentSnapshots.sort((a, b) => (b.vol ?? 0) - (a.vol ?? 0));

    // 4. Average pairwise correlation (use top 15 most volatile tickers)
    const topTickers = constituentSnapshots.slice(0, 15).map((s) => s.ticker);
    const topReturns = new Map<string, Map<string, number>>();
    for (const t of topTickers) {
      const m = constituentReturnByDate.get(t);
      if (m) topReturns.set(t, m);
    }
    const avgCorrelation = computeAvgPairwiseCorrelation(topReturns, obxDates, 60);

    // 5. Regime distribution of constituents
    const regimeCounts: Record<string, number> = {};
    for (const s of constituentSnapshots) {
      regimeCounts[s.regime] = (regimeCounts[s.regime] || 0) + 1;
    }

    // 6. Summary stats
    const constituentVols = constituentSnapshots.map((s) => s.vol).filter((v: any) => v != null) as number[];
    const avgConstituentVol = constituentVols.length > 0
      ? constituentVols.reduce((a, b) => a + b, 0) / constituentVols.length
      : 0;
    const volDispersion = constituentVols.length > 1
      ? Math.sqrt(
          constituentVols.reduce((s, v) => s + (v - avgConstituentVol) ** 2, 0) /
            (constituentVols.length - 1)
        )
      : 0;

    return NextResponse.json({
      ticker: "OBX",
      count: obxBars.length,
      dateRange: {
        start: obxBars[0]?.date,
        end: obxBars[obxBars.length - 1]?.date,
      },

      // OBX index metrics
      index: {
        regime: obxRegime,
        regimeColor: getRegimeColor(obxRegime),
        annualizedVol: sanitizeNumber(obxYZ),
        percentile: sanitizeNumber(obxPercentile),
        trend: obxTrend,
        interpretation: obxInterpretation,
        rolling20: sanitizeNumber(obxR20),
        rolling60: sanitizeNumber(obxR60),
        rolling120: sanitizeNumber(obxLast?.rolling120),
        ewma94: sanitizeNumber(obxLast?.ewma94),
        yangZhang: sanitizeNumber(obxLast?.yangZhang),
        regimeDuration: regimeDuration.currentDuration,
        lastClose: obxBars[obxBars.length - 1]?.close,
        lastDate: obxBars[obxBars.length - 1]?.date,
      },

      // Regime history for chart
      regimeHistory: regimeHistory.slice(-252),

      // Vol cone
      volCone,

      // Constituent data
      constituents: constituentSnapshots,
      constituentCount: constituentSnapshots.length,

      // Systemic risk
      avgPairwiseCorrelation: avgCorrelation,
      currentAvgCorrelation: avgCorrelation.length > 0
        ? avgCorrelation[avgCorrelation.length - 1].avgCorrelation
        : null,

      // Summary
      summary: {
        avgConstituentVol: sanitizeNumber(avgConstituentVol),
        volDispersion: sanitizeNumber(volDispersion),
        regimeDistribution: regimeCounts,
        highVolCount: constituentSnapshots.filter((s) => ["Crisis", "Extreme High"].includes(s.regime)).length,
        lowVolCount: constituentSnapshots.filter((s) => ["Low & Stable", "Low & Contracting"].includes(s.regime)).length,
      },
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (e: any) {
    console.error("OBX volatility API error:", e);
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
