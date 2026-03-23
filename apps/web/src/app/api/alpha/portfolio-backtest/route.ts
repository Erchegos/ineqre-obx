import { NextRequest } from 'next/server';
import { pool } from '@/lib/db';
import { requireAuth, safeErrorResponse, secureJsonResponse } from '@/lib/security';

// ── Cross-sectional rank → [-1, +1] ──
function crossRank(items: { ticker: string; value: number | null }[]): Map<string, number> {
  const valid = items.filter(v => v.value != null && isFinite(v.value!));
  if (valid.length < 3) return new Map();
  valid.sort((a, b) => a.value! - b.value!);
  const n = valid.length;
  const result = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    result.set(valid[i].ticker, n > 1 ? 2 * i / (n - 1) - 1 : 0);
  }
  return result;
}

// Winsorize at p1/p99
function winsorize(values: number[], lo = 0.01, hi = 0.99): number[] {
  const sorted = [...values].filter(v => isFinite(v)).sort((a, b) => a - b);
  if (sorted.length < 5) return values;
  const pLo = sorted[Math.floor(sorted.length * lo)];
  const pHi = sorted[Math.floor(sorted.length * hi)];
  return values.map(v => Math.max(pLo, Math.min(pHi, v)));
}

// Pearson correlation between two arrays
function rankCorrelation(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length < 5) return 0;
  const n = a.length;
  // Spearman: rank both, then Pearson on ranks
  const rankArr = (arr: number[]) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    for (let i = 0; i < n; i++) ranks[sorted[i].i] = i;
    return ranks;
  };
  const ra = rankArr(a);
  const rb = rankArr(b);
  const meanA = ra.reduce((s, v) => s + v, 0) / n;
  const meanB = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i] - meanA, db = rb[i] - meanB;
    num += da * db; denA += da * da; denB += db * db;
  }
  return denA > 0 && denB > 0 ? num / Math.sqrt(denA * denB) : 0;
}

interface MonthData {
  month: string; // YYYY-MM
  tickers: Map<string, {
    close: number;
    sector: string;
    name: string;
    factors: Record<string, number | null>;
    mlPred: number | null;
  }>;
}

const CACHE_KEY = 'portfolio_backtest_v7';
const CACHE_MAX_AGE_H = 25;

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    // ── Serve from DB cache if fresh (pre-computed by nightly warmup) ──────────
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS alpha_result_cache (
        cache_key TEXT PRIMARY KEY, result JSONB NOT NULL, computed_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const cached = await pool.query(
        `SELECT result FROM alpha_result_cache
         WHERE cache_key = $1 AND computed_at > NOW() - INTERVAL '${CACHE_MAX_AGE_H} hours'`,
        [CACHE_KEY]
      );
      if (cached.rows.length > 0) return secureJsonResponse(cached.rows[0].result);
    } catch { /* table may not exist yet — fall through to compute */ }

    const body = await req.json().catch(() => ({}));
    const costBps = body.costBps ?? 10;
    const maxSingleStock = body.maxSingleStock ?? 0.15;
    const maxSectorWeight = body.maxSectorWeight ?? 0.45;

    const alphaWeights = {
      ml: 0.55,        // ML prediction — primary edge, highest IC empirically
      momentum: 0.25,  // Vol-adjusted momentum (12m-1m skip) — strongest return factor on OSE
      value: 0.10,     // Sector-relative E/P value
      lowVol: 0.05,    // Minimal low-vol tilt — just enough for quality filtering
      liquidity: 0.05, // Liquidity gate — excludes illiquid stocks
    };

    // ── 1. Fetch month-end prices ──
    const priceRes = await pool.query(`
      SELECT DISTINCT ON (p.ticker, date_trunc('month', p.date))
        p.ticker, p.date::text as date, p.close::float,
        date_trunc('month', p.date)::date::text as month,
        s.sector, s.name
      FROM prices_daily p
      JOIN stocks s ON p.ticker = s.ticker
      WHERE (s.asset_type = 'equity' OR s.asset_type IS NULL)
        AND (s.currency = 'NOK' OR s.currency IS NULL)
        AND p.ticker NOT LIKE '%.%'
        AND p.close > 1
        AND p.date >= NOW() - INTERVAL '72 months'
      ORDER BY p.ticker, date_trunc('month', p.date), p.date DESC
    `);

    // ── 2. Fetch factor data ──
    const factorRes = await pool.query(`
      SELECT DISTINCT ON (ft.ticker, date_trunc('month', ft.date))
        ft.ticker, date_trunc('month', ft.date)::date::text as month,
        ft.mom1m::float, ft.mom6m::float, ft.mom11m::float, ft.mom36m::float,
        ft.vol1m::float, ft.vol3m::float, ft.vol12m::float,
        ft.beta::float, ft.ivol::float, ft.maxret::float,
        ff.bm::float, ff.ep::float, ff.dy::float, ff.sp::float,
        ff.mktcap::float, ff.nokvol::float
      FROM factor_technical ft
      LEFT JOIN factor_fundamentals ff ON ft.ticker = ff.ticker
        AND date_trunc('month', ft.date) = date_trunc('month', ff.date)
      WHERE ft.date >= NOW() - INTERVAL '72 months'
      ORDER BY ft.ticker, date_trunc('month', ft.date), ft.date DESC
    `);

    // ── 3. Fetch ML predictions ──
    const mlRes = await pool.query(`
      SELECT DISTINCT ON (ticker, date_trunc('month', prediction_date))
        ticker, date_trunc('month', prediction_date)::date::text as month,
        ensemble_prediction::float
      FROM ml_predictions
      WHERE prediction_date >= NOW() - INTERVAL '72 months'
        AND ensemble_prediction IS NOT NULL
      ORDER BY ticker, date_trunc('month', prediction_date), prediction_date DESC
    `);

    // ── 4. Fetch commodity prices for regime ──
    const commodRes = await pool.query(`
      SELECT DISTINCT ON (symbol, date_trunc('month', date))
        symbol, date_trunc('month', date)::date::text as month, close::float
      FROM commodity_prices
      WHERE symbol IN ('BZ=F', 'CL=F')
        AND date >= NOW() - INTERVAL '72 months'
        AND close > 0
      ORDER BY symbol, date_trunc('month', date), date DESC
    `);

    // ── Build data structures ──

    // Month-end prices: month → ticker → { close, sector, name }
    const priceMap = new Map<string, Map<string, { close: number; sector: string; name: string }>>();
    for (const row of priceRes.rows) {
      const m = row.month.slice(0, 7);
      if (!priceMap.has(m)) priceMap.set(m, new Map());
      priceMap.get(m)!.set(row.ticker, { close: row.close, sector: row.sector || 'Other', name: row.name || row.ticker });
    }

    // Factor data: month → ticker → factors
    const factorMap = new Map<string, Map<string, Record<string, number | null>>>();
    for (const row of factorRes.rows) {
      const m = row.month.slice(0, 7);
      if (!factorMap.has(m)) factorMap.set(m, new Map());
      factorMap.get(m)!.set(row.ticker, {
        mom1m: row.mom1m, mom6m: row.mom6m, mom11m: row.mom11m, mom36m: row.mom36m,
        vol1m: row.vol1m, vol3m: row.vol3m, vol12m: row.vol12m,
        beta: row.beta, ivol: row.ivol, maxret: row.maxret,
        bm: row.bm, ep: row.ep, dy: row.dy, sp: row.sp,
        mktcap: row.mktcap, nokvol: row.nokvol,
      });
    }

    // ML predictions: month → ticker → prediction
    const mlMap = new Map<string, Map<string, number>>();
    for (const row of mlRes.rows) {
      const m = row.month.slice(0, 7);
      if (!mlMap.has(m)) mlMap.set(m, new Map());
      mlMap.get(m)!.set(row.ticker, row.ensemble_prediction);
    }

    // Commodity prices: month → symbol → close
    const commodMap = new Map<string, Map<string, number>>();
    for (const row of commodRes.rows) {
      const m = row.month.slice(0, 7);
      if (!commodMap.has(m)) commodMap.set(m, new Map());
      commodMap.get(m)!.set(row.symbol, row.close);
    }

    // Get sorted list of months
    const allMonths = [...priceMap.keys()].sort();
    if (allMonths.length < 12) {
      return secureJsonResponse({ error: 'Not enough data' }, { status: 400 });
    }

    // ── 5. Monthly rebalancing backtest ──
    const equityCurve: { date: string; portfolio: number; benchmark: number }[] = [];
    const monthlyReturns: { date: string; portfolio: number; benchmark: number; excess: number; ic: number; turnover: number; positions: number }[] = [];

    let portfolioValue = 100;
    let benchmarkValue = 100;
    let prevWeights = new Map<string, number>();
    const costFraction = costBps / 10000;

    // Need at least 12 months of history for factors, start from month 12
    const startIdx = Math.max(12, Math.floor(allMonths.length * 0.15)); // Skip first 15% for factor warmup
    equityCurve.push({ date: allMonths[startIdx], portfolio: 100, benchmark: 100 });

    // Track current portfolio for frontend
    let latestHoldings: { ticker: string; name: string; sector: string; weight: number; alphaScore: number; rank: number; components: Record<string, number> }[] = [];

    for (let mi = startIdx; mi < allMonths.length - 1; mi++) {
      const month = allMonths[mi];
      const nextMonth = allMonths[mi + 1];

      const prices = priceMap.get(month);
      const nextPrices = priceMap.get(nextMonth);
      if (!prices || !nextPrices) continue;

      const factors = factorMap.get(month);
      const mlPreds = mlMap.get(month);

      // Get tickers that exist in both this month and next (for return calc)
      const tickers = [...prices.keys()].filter(t => nextPrices.has(t) && (nextPrices.get(t)!.close > 1));
      if (tickers.length < 10) continue;

      // ── Compute alpha components ──

      // A) ML Alpha (30%) — cross-sectional rank of ML predictions
      let mlRanks = new Map<string, number>();
      const hasML = mlPreds && mlPreds.size >= 5;
      if (hasML) {
        mlRanks = crossRank(tickers.map(t => ({ ticker: t, value: mlPreds!.get(t) ?? null })));
      }

      // B) Low Volatility (25%) — inverted ivol rank
      let lowVolRanks = new Map<string, number>();
      if (factors) {
        lowVolRanks = crossRank(tickers.map(t => {
          const f = factors.get(t);
          const ivol = f?.ivol ?? f?.vol3m ?? null;
          return { ticker: t, value: ivol != null ? -ivol : null }; // Negate: low vol = high rank
        }));
      }

      // C) Liquidity (15%) — inverted volume rank (lower turnover = higher score)
      let liqRanks = new Map<string, number>();
      if (factors) {
        const volumes = tickers.map(t => {
          const f = factors.get(t);
          return { ticker: t, value: f?.nokvol ?? null };
        }).filter(v => v.value != null && v.value! > 0);

        if (volumes.length >= 5) {
          // Only consider stocks above minimum liquidity floor (1M NOK)
          const tradeable = volumes.filter(v => v.value! > 1_000_000);
          // Invert: lower volume (but still liquid) = higher score
          liqRanks = crossRank(tradeable.map(v => ({ ticker: v.ticker, value: -v.value! })));
        }
      }

      // D) Momentum 6m (10%) — direct rank
      let momRanks = new Map<string, number>();
      if (factors) {
        momRanks = crossRank(tickers.map(t => {
          const f = factors.get(t);
          return { ticker: t, value: f?.mom6m ?? null };
        }));
      }

      // E) Vol-Adjusted Momentum (12m skip 1m) — classic Jegadeesh-Titman implementation
      let volMomRanks = new Map<string, number>();
      if (factors) {
        volMomRanks = crossRank(tickers.map(t => {
          const f = factors.get(t);
          // 12m momentum minus last month (skip), normalized by vol → better risk-adjusted signal
          const mom12skip1 = (f?.mom11m != null && f?.mom1m != null) ? f.mom11m - f.mom1m : f?.mom11m ?? null;
          const vol = f?.vol3m ?? f?.vol12m ?? null;
          if (mom12skip1 == null || vol == null || vol <= 0) return { ticker: t, value: null };
          return { ticker: t, value: mom12skip1 / vol }; // Vol-adjusted = better Sharpe signal
        }));
      }

      // F) Sector-relative Value (10%) — E/P ranked within sector
      let valRanks = new Map<string, number>();
      if (factors) {
        const bySector = new Map<string, { ticker: string; value: number | null }[]>();
        for (const t of tickers) {
          const sector = prices.get(t)?.sector || 'Other';
          const f = factors.get(t);
          if (!bySector.has(sector)) bySector.set(sector, []);
          bySector.get(sector)!.push({ ticker: t, value: f?.ep ?? null });
        }
        for (const [, stocks] of bySector) {
          const ranked = crossRank(stocks);
          for (const [t, r] of ranked) valRanks.set(t, r);
        }
      }

      // ── Composite alpha score ──
      const alphaScores = new Map<string, { score: number; components: Record<string, number> }>();

      // Redistribute ML weight if no ML data this month
      const effectiveWeights = { ...alphaWeights };
      if (!hasML || mlRanks.size < 5) {
        effectiveWeights.ml = 0;
        effectiveWeights.lowVol += 0.15;
        effectiveWeights.momentum += 0.15;
        effectiveWeights.value += 0.10;
      }

      for (const t of tickers) {
        const ml = mlRanks.get(t) ?? 0;
        const lv = lowVolRanks.get(t) ?? 0;
        const liq = liqRanks.get(t) ?? 0;
        const mom = momRanks.get(t) ?? 0;
        const vmom = volMomRanks.get(t) ?? 0;
        const val = valRanks.get(t) ?? 0;

        const score = effectiveWeights.ml * ml
          + effectiveWeights.lowVol * lv
          + effectiveWeights.liquidity * liq
          + effectiveWeights.momentum * ((mom + vmom) / 2)  // Blend raw + vol-adjusted momentum
          + effectiveWeights.value * val;

        alphaScores.set(t, { score, components: { ml, lowVol: lv, liquidity: liq, momentum: (mom + vmom) / 2, value: val } });
      }

      // ── Portfolio construction — concentrated high-conviction ──
      // Hold only top 20 stocks by alpha score. Alpha-score weighted (higher score = larger bet).
      const sorted = [...alphaScores.entries()].sort((a, b) => b[1].score - a[1].score);

      const TOP_N = 10; // Max positions — concentrated high-conviction portfolio
      const selected = sorted.slice(0, Math.min(TOP_N, sorted.length));

      const weights = new Map<string, number>();

      // Volatility-scaled alpha weighting: w_i ∝ alpha_score_i / vol_i
      // This directly targets higher Sharpe by sizing down high-vol positions
      const minScore = selected[selected.length - 1]?.[1].score ?? 0;
      const scoreShift = minScore < 0 ? -minScore + 0.01 : 0.01;

      let totalRawWeight = 0;
      const rawWeights = new Map<string, number>();
      for (const [ticker, alpha] of selected) {
        const f = factors?.get(ticker);
        const vol = f?.vol3m ?? f?.vol1m ?? f?.ivol ?? 0.20; // fallback 20% vol
        const safeVol = Math.max(vol, 0.05); // floor at 5% to avoid extreme leverage
        const raw = (alpha.score + scoreShift) / safeVol;
        rawWeights.set(ticker, raw);
        totalRawWeight += raw;
      }

      for (const [ticker, raw] of rawWeights) {
        weights.set(ticker, totalRawWeight > 0 ? raw / totalRawWeight : 1 / selected.length);
      }

      // Apply sector caps
      const sectorWeights = new Map<string, number>();
      for (const [ticker, weight] of weights) {
        const sector = prices.get(ticker)?.sector || 'Other';
        sectorWeights.set(sector, (sectorWeights.get(sector) || 0) + weight);
      }

      for (const [sector, totalWeight] of sectorWeights) {
        if (totalWeight > maxSectorWeight) {
          const scale = maxSectorWeight / totalWeight;
          for (const [ticker, weight] of weights) {
            if ((prices.get(ticker)?.sector || 'Other') === sector) {
              weights.set(ticker, weight * scale);
            }
          }
        }
      }

      // Apply single stock cap
      for (const [ticker, weight] of weights) {
        if (weight > maxSingleStock) {
          weights.set(ticker, maxSingleStock);
        }
      }

      // Normalize to sum to 1
      const totalWeight = [...weights.values()].reduce((s, w) => s + w, 0);
      if (totalWeight > 0) {
        for (const [ticker, weight] of weights) {
          weights.set(ticker, weight / totalWeight);
        }
      }

      // ── Compute turnover ──
      let turnover = 0;
      const allTickerSet = new Set([...weights.keys(), ...prevWeights.keys()]);
      for (const t of allTickerSet) {
        turnover += Math.abs((weights.get(t) || 0) - (prevWeights.get(t) || 0));
      }
      turnover /= 2; // One-way turnover

      // ── Compute returns ──
      let portfolioReturn = 0;
      let posCount = 0;
      const stockReturns: { ticker: string; weight: number; ret: number }[] = [];

      for (const [ticker, weight] of weights) {
        if (weight <= 0) continue;
        const p0 = prices.get(ticker)?.close;
        const p1 = nextPrices.get(ticker)?.close;
        if (!p0 || !p1) continue;

        const ret = (p1 - p0) / p0;
        portfolioReturn += weight * ret;
        posCount++;
        stockReturns.push({ ticker, weight, ret });
      }

      // Subtract transaction costs (proportional to turnover)
      portfolioReturn -= turnover * costFraction;

      // Benchmark: equal-weight all stocks
      let benchmarkReturn = 0;
      let bmCount = 0;
      for (const t of tickers) {
        const p0 = prices.get(t)?.close;
        const p1 = nextPrices.get(t)?.close;
        if (!p0 || !p1) continue;
        benchmarkReturn += (p1 - p0) / p0;
        bmCount++;
      }
      benchmarkReturn = bmCount > 0 ? benchmarkReturn / bmCount : 0;

      // ── Information Coefficient (rank correlation) ──
      const alphaArr: number[] = [];
      const retArr: number[] = [];
      for (const t of tickers) {
        const alpha = alphaScores.get(t);
        const p0 = prices.get(t)?.close;
        const p1 = nextPrices.get(t)?.close;
        if (!alpha || !p0 || !p1) continue;
        alphaArr.push(alpha.score);
        retArr.push((p1 - p0) / p0);
      }
      const ic = rankCorrelation(alphaArr, retArr);

      // Update equity
      portfolioValue *= (1 + portfolioReturn);
      benchmarkValue *= (1 + benchmarkReturn);

      equityCurve.push({
        date: nextMonth,
        portfolio: Math.round(portfolioValue * 100) / 100,
        benchmark: Math.round(benchmarkValue * 100) / 100,
      });

      monthlyReturns.push({
        date: nextMonth,
        portfolio: Math.round(portfolioReturn * 10000) / 10000,
        benchmark: Math.round(benchmarkReturn * 10000) / 10000,
        excess: Math.round((portfolioReturn - benchmarkReturn) * 10000) / 10000,
        ic: Math.round(ic * 1000) / 1000,
        turnover: Math.round(turnover * 1000) / 1000,
        positions: posCount,
      });

      // Save latest holdings (last iteration)
      if (mi === allMonths.length - 2) {
        latestHoldings = sorted
          .filter(([t]) => (weights.get(t) || 0) > 0.001)
          .map(([t, alpha], idx) => ({
            ticker: t,
            name: prices.get(t)?.name || t,
            sector: prices.get(t)?.sector || 'Other',
            weight: Math.round((weights.get(t) || 0) * 1000) / 10,
            alphaScore: Math.round(alpha.score * 1000) / 1000,
            rank: idx + 1,
            components: Object.fromEntries(
              Object.entries(alpha.components).map(([k, v]) => [k, Math.round(v * 100) / 100])
            ),
          }));
      }

      prevWeights = weights;
    }

    // ── 6. Compute summary stats ──
    if (monthlyReturns.length < 3) {
      return secureJsonResponse({ error: 'Not enough data for backtest' }, { status: 400 });
    }

    const portReturns = monthlyReturns.map(m => m.portfolio);
    const bmReturns = monthlyReturns.map(m => m.benchmark);
    const excessReturns = monthlyReturns.map(m => m.excess);

    const totalPortReturn = (portfolioValue - 100) / 100;
    const totalBmReturn = (benchmarkValue - 100) / 100;
    const nYears = monthlyReturns.length / 12;

    const annPort = nYears > 0.5 ? Math.pow(1 + totalPortReturn, 1 / nYears) - 1 : totalPortReturn;
    const annBm = nYears > 0.5 ? Math.pow(1 + totalBmReturn, 1 / nYears) - 1 : totalBmReturn;

    const avgMonthly = portReturns.reduce((s, r) => s + r, 0) / portReturns.length;
    const stdMonthly = Math.sqrt(portReturns.reduce((s, r) => s + (r - avgMonthly) ** 2, 0) / Math.max(portReturns.length - 1, 1));
    const sharpe = stdMonthly > 0 ? (avgMonthly / stdMonthly) * Math.sqrt(12) : 0;

    const avgBmMonthly = bmReturns.reduce((s, r) => s + r, 0) / bmReturns.length;
    const stdBmMonthly = Math.sqrt(bmReturns.reduce((s, r) => s + (r - avgBmMonthly) ** 2, 0) / Math.max(bmReturns.length - 1, 1));
    const bmSharpe = stdBmMonthly > 0 ? (avgBmMonthly / stdBmMonthly) * Math.sqrt(12) : 0;

    // Max drawdown
    let peak = 100, maxDD = 0;
    for (const pt of equityCurve) {
      if (pt.portfolio > peak) peak = pt.portfolio;
      const dd = (peak - pt.portfolio) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    let bmPeak = 100, bmMaxDD = 0;
    for (const pt of equityCurve) {
      if (pt.benchmark > bmPeak) bmPeak = pt.benchmark;
      const dd = (bmPeak - pt.benchmark) / bmPeak;
      if (dd > bmMaxDD) bmMaxDD = dd;
    }

    const avgIC = monthlyReturns.reduce((s, m) => s + m.ic, 0) / monthlyReturns.length;
    const avgTurnover = monthlyReturns.reduce((s, m) => s + m.turnover, 0) / monthlyReturns.length;
    const winRate = excessReturns.filter(r => r > 0).length / excessReturns.length;
    const avgPositions = monthlyReturns.reduce((s, m) => s + m.positions, 0) / monthlyReturns.length;

    // Sector allocation from latest portfolio
    const sectorAlloc = new Map<string, number>();
    const sectorColors: Record<string, string> = {
      Energy: '#ef4444', Seafood: '#22c55e', Shipping: '#3b82f6', Materials: '#f59e0b',
      Banks: '#8b5cf6', Finance: '#7c3aed', Telecom: '#06b6d4', Consumer: '#ec4899',
      Industrial: '#f97316', Industrials: '#fb923c', Technology: '#14b8a6', Tech: '#a855f7',
      Investment: '#e879f9', 'Renewable Energy': '#4ade80', Healthcare: '#f43f5e',
      Other: '#64748b',
    };
    for (const h of latestHoldings) {
      sectorAlloc.set(h.sector, (sectorAlloc.get(h.sector) || 0) + h.weight);
    }

    const result = {
      config: {
        weights: alphaWeights,
        maxSingleStock,
        maxSectorWeight,
        costBps,
        rebalance: 'Monthly',
      },
      summary: {
        months: monthlyReturns.length,
        totalReturn: Math.round(totalPortReturn * 10000) / 100,
        annualizedReturn: Math.round(annPort * 10000) / 100,
        benchmarkAnnReturn: Math.round(annBm * 10000) / 100,
        excessReturn: Math.round((annPort - annBm) * 10000) / 100,
        sharpe: Math.round(sharpe * 100) / 100,
        benchmarkSharpe: Math.round(bmSharpe * 100) / 100,
        maxDrawdown: Math.round(maxDD * 10000) / 100,
        benchmarkMaxDD: Math.round(bmMaxDD * 10000) / 100,
        avgTurnover: Math.round(avgTurnover * 10000) / 100,
        avgIC: Math.round(avgIC * 1000) / 1000,
        winRate: Math.round(winRate * 1000) / 10,
        avgPositions: Math.round(avgPositions * 10) / 10,
      },
      equityCurve,
      monthlyReturns,
      currentPortfolio: {
        date: allMonths[allMonths.length - 1],
        holdings: latestHoldings,
      },
      sectorAllocation: [...sectorAlloc.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([sector, weight]) => ({
          sector,
          weight: Math.round(weight * 10) / 10,
          color: sectorColors[sector] || '#6b7280',
        })),
    };
    // Store in DB cache so next request is instant (warmup script + self-populating)
    try {
      await pool.query(
        `INSERT INTO alpha_result_cache (cache_key, result, computed_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (cache_key) DO UPDATE SET result = $2, computed_at = NOW()`,
        [CACHE_KEY, JSON.stringify(result)]
      );
    } catch { /* non-fatal */ }
    return secureJsonResponse(result);
  } catch (error) {
    return safeErrorResponse(error, 'Portfolio backtest failed');
  }
}

