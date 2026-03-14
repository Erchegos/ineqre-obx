import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getPriceTable } from '@/lib/price-data-adapter';
import {
  optimizePortfolio,
  OptimizationMode,
  CovarianceMethod,
  OptimizationConstraints,
  OptimizationInput,
  buildCovarianceMatrix,
  computePortfolioReturn,
  computeSortino,
  computeVaR,
  computeMaxDrawdown,
  computeRiskDecomposition,
  portfolioVol,
} from '@/lib/portfolioOptimizer';

export const dynamic = 'force-dynamic';

const ALL_MODES: OptimizationMode[] = [
  'equal', 'min_variance', 'max_sharpe', 'risk_parity', 'max_diversification',
];

const DEFAULT_CONSTRAINTS: OptimizationConstraints = {
  maxPositionSize: 0.40,
  minPositionSize: 0.00,
  maxSectorExposure: 0.50,
  excludeTickers: [],
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      tickers,
      weights: userWeights,
      lookbackDays = 504,
      portfolioValueNOK = 10_000_000,
      riskFreeRate = 0.045,
      covarianceMethod = 'shrinkage',
    } = body;

    // Validate inputs
    if (!tickers || !Array.isArray(tickers) || tickers.length < 2) {
      return NextResponse.json({ error: 'At least 2 tickers required' }, { status: 400 });
    }
    if (tickers.length > 60) {
      return NextResponse.json({ error: 'Maximum 60 tickers supported' }, { status: 400 });
    }
    if (!userWeights || !Array.isArray(userWeights) || userWeights.length !== tickers.length) {
      return NextResponse.json({ error: 'Weights array must match tickers length' }, { status: 400 });
    }
    const validTickers = tickers.every((t: string) => /^[A-Z0-9.]+$/.test(t));
    if (!validTickers) {
      return NextResponse.json({ error: 'Invalid ticker format' }, { status: 400 });
    }

    // Normalize weights to sum to 1
    const rawWeights = userWeights.map((w: number) => Math.max(0, Number(w) || 0));
    const weightSum = rawWeights.reduce((a: number, b: number) => a + b, 0);
    if (weightSum <= 0) {
      return NextResponse.json({ error: 'Weights must sum to a positive value' }, { status: 400 });
    }
    const weights: number[] = rawWeights.map((w: number) => w / weightSum);

    const tableName = await getPriceTable();

    // 1. Fetch prices for all tickers + OBX benchmark
    const allTickers = [...new Set([...tickers, 'OBX'])];
    const lookbackBuffer = Math.floor(lookbackDays * 1.4);

    const priceQuery = `
      SELECT ticker, date::text as date, adj_close, close
      FROM ${tableName}
      WHERE ticker = ANY($1)
        AND date >= CURRENT_DATE - ($2 || ' days')::INTERVAL
        AND close IS NOT NULL AND close > 0
      ORDER BY date ASC
    `;
    const priceResult = await pool.query(priceQuery, [allTickers, lookbackBuffer]);

    // 2. Group by ticker
    const rawData: Record<string, { date: string; price: number }[]> = {};
    for (const row of priceResult.rows) {
      if (!rawData[row.ticker]) rawData[row.ticker] = [];
      const price = row.adj_close ? Number(row.adj_close) : Number(row.close);
      rawData[row.ticker].push({ date: row.date, price });
    }

    const missingTickers = tickers.filter((t: string) => !rawData[t] || rawData[t].length < 30);
    if (missingTickers.length > 0) {
      return NextResponse.json({ error: `Insufficient data for: ${missingTickers.join(', ')}` }, { status: 400 });
    }

    // 3. Find common dates
    const dateCounts: Record<string, number> = {};
    for (const t of tickers) {
      for (const p of rawData[t]) {
        dateCounts[p.date] = (dateCounts[p.date] || 0) + 1;
      }
    }
    const commonDates = Object.keys(dateCounts)
      .filter(d => dateCounts[d] === tickers.length)
      .sort();

    if (commonDates.length < 60) {
      return NextResponse.json(
        { error: `Only ${commonDates.length} overlapping trading days. Need at least 60.` },
        { status: 400 }
      );
    }

    const trimmedDates = commonDates.slice(-lookbackDays);

    // 4. Build aligned price series and compute log returns
    const returns: number[][] = [];
    const lastPrices: number[] = [];
    const priceSeriesPerTicker: Record<string, number[]> = {};

    for (const t of tickers) {
      const priceMap = new Map(rawData[t].map(p => [p.date, p.price]));
      const prices = trimmedDates.map(d => priceMap.get(d) || 0).filter(p => p > 0);

      const rets: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        rets.push(Math.log(prices[i] / prices[i - 1]));
      }
      returns.push(rets);
      lastPrices.push(prices[prices.length - 1]);
      priceSeriesPerTicker[t] = prices;
    }

    // 5. Compute portfolio daily returns with user weights
    const { annualizedReturn, dailyReturns } = computePortfolioReturn(weights, returns);

    // 6. Build cumulative return time series
    const returnDates = trimmedDates.slice(1); // first date is consumed by log return
    const cumulativePortfolio: number[] = [];
    let cumPort = 1;
    for (const r of dailyReturns) {
      cumPort *= (1 + r);
      cumulativePortfolio.push((cumPort - 1) * 100); // as percentage
    }

    // Per-stock weighted cumulative returns
    const cumulativeStocks: Record<string, number[]> = {};
    for (let i = 0; i < tickers.length; i++) {
      const rets = returns[i];
      let cum = 1;
      const cumArr: number[] = [];
      for (const r of rets) {
        cum *= (1 + r * weights[i]); // weighted contribution
        cumArr.push((cum - 1) * 100);
      }
      cumulativeStocks[tickers[i]] = cumArr;
    }

    // OBX benchmark cumulative
    const cumulativeBenchmark: number[] = [];
    const obxDailyRets: number[] = [];
    if (rawData['OBX'] && rawData['OBX'].length > 30) {
      const obxMap = new Map(rawData['OBX'].map(p => [p.date, p.price]));
      const obxPrices = trimmedDates.map(d => obxMap.get(d)).filter(p => p && p > 0) as number[];

      for (let i = 1; i < obxPrices.length; i++) {
        obxDailyRets.push(Math.log(obxPrices[i] / obxPrices[i - 1]));
      }

      let cumOBX = 1;
      for (const r of obxDailyRets) {
        cumOBX *= (1 + r);
        cumulativeBenchmark.push((cumOBX - 1) * 100);
      }
    }

    // 7. Build covariance matrix and compute risk metrics
    const { matrix: cov } = buildCovarianceMatrix(returns, covarianceMethod as CovarianceMethod);
    const annualizedVol = portfolioVol(weights, cov) * Math.sqrt(252);
    const sharpeRatio = annualizedVol > 0 ? (annualizedReturn - riskFreeRate) / annualizedVol : 0;
    const sortinoRatio = computeSortino(dailyReturns, riskFreeRate);
    const { var: var95, cvar: cvar95 } = computeVaR(dailyReturns, 0.95);
    const { var: var99, cvar: cvar99 } = computeVaR(dailyReturns, 0.99);
    const maxDrawdown = computeMaxDrawdown(dailyReturns);
    const riskDecomposition = computeRiskDecomposition(weights, cov, tickers);
    const herfindahlIndex = weights.reduce((sum, w) => sum + w * w, 0);
    const effectivePositions = herfindahlIndex > 0 ? 1 / herfindahlIndex : tickers.length;

    // Diversification ratio
    const individualVols = returns.map(r => {
      const v = Math.sqrt(r.reduce((s, x) => s + x * x, 0) / r.length) * Math.sqrt(252);
      return v;
    });
    const weightedVolSum = weights.reduce((sum, w, i) => sum + w * individualVols[i], 0);
    const diversificationRatio = annualizedVol > 0 ? weightedVolSum / annualizedVol : 1;

    // 8. Compute beta to OBX and tracking error
    let betaToOBX = 0;
    let trackingError = 0;
    if (obxDailyRets.length > 30) {
      const minLen = Math.min(obxDailyRets.length, dailyReturns.length);
      const portSlice = dailyReturns.slice(0, minLen);
      const obxSlice = obxDailyRets.slice(0, minLen);

      const meanP = portSlice.reduce((a, b) => a + b, 0) / minLen;
      const meanM = obxSlice.reduce((a, b) => a + b, 0) / minLen;
      let covPM = 0, varM = 0;
      for (let t = 0; t < minLen; t++) {
        covPM += (portSlice[t] - meanP) * (obxSlice[t] - meanM);
        varM += (obxSlice[t] - meanM) ** 2;
      }
      covPM /= (minLen - 1);
      varM /= (minLen - 1);
      betaToOBX = varM > 0 ? covPM / varM : 0;

      const activeReturns = portSlice.map((r, i) => r - obxSlice[i]);
      const meanActive = activeReturns.reduce((a, b) => a + b, 0) / minLen;
      const teVar = activeReturns.reduce((sum, r) => sum + (r - meanActive) ** 2, 0) / (minLen - 1);
      trackingError = Math.sqrt(teVar * 252);
    }

    // 9. Fetch stock metadata
    const metaQuery = `SELECT ticker, name, sector, currency FROM stocks WHERE ticker = ANY($1)`;
    const metaResult = await pool.query(metaQuery, [tickers]);
    const metaMap = new Map(
      metaResult.rows.map((r: { ticker: string; name: string; sector: string; currency: string }) => [r.ticker, r])
    );
    const sectors = tickers.map((t: string) => metaMap.get(t)?.sector || 'Unknown');

    // 10. Fetch ML predictions
    const predQuery = `
      SELECT DISTINCT ON (ticker) ticker, ensemble_prediction, gb_prediction, rf_prediction,
             p05, p25, p50, p75, p95, confidence_score, prediction_date::text as prediction_date
      FROM ml_predictions
      WHERE ticker = ANY($1)
      ORDER BY ticker, prediction_date DESC
    `;
    const predResult = await pool.query(predQuery, [tickers]);
    type PredRow = {
      ticker: string; ensemble_prediction: string; gb_prediction: string;
      rf_prediction: string; p05: string; p25: string; p50: string;
      p75: string; p95: string; confidence_score: string; prediction_date: string;
    };
    const predMap = new Map(
      predResult.rows.map((r: PredRow) => [r.ticker, {
        ensemble: Number(r.ensemble_prediction),
        gb: Number(r.gb_prediction),
        rf: Number(r.rf_prediction),
        p05: Number(r.p05), p25: Number(r.p25), p50: Number(r.p50),
        p75: Number(r.p75), p95: Number(r.p95),
        confidence: Number(r.confidence_score || 0),
        date: r.prediction_date,
      }])
    );

    // Compute weighted portfolio ML forecast
    let portfolioExpectedReturn = 0;
    let portfolioP05 = 0, portfolioP25 = 0, portfolioP50 = 0, portfolioP75 = 0, portfolioP95 = 0;
    const perHoldingML: { ticker: string; prediction: number; weight: number; signal: string }[] = [];
    for (let i = 0; i < tickers.length; i++) {
      const pred = predMap.get(tickers[i]);
      if (pred) {
        portfolioExpectedReturn += weights[i] * pred.ensemble;
        portfolioP05 += weights[i] * pred.p05;
        portfolioP25 += weights[i] * pred.p25;
        portfolioP50 += weights[i] * pred.p50;
        portfolioP75 += weights[i] * pred.p75;
        portfolioP95 += weights[i] * pred.p95;
        let signal = 'Hold';
        if (pred.ensemble > 0.04) signal = 'Strong Buy';
        else if (pred.ensemble > 0.015) signal = 'Buy';
        else if (pred.ensemble > -0.015) signal = 'Hold';
        else if (pred.ensemble > -0.04) signal = 'Sell';
        else signal = 'Strong Sell';
        perHoldingML.push({ ticker: tickers[i], prediction: pred.ensemble, weight: weights[i], signal });
      } else {
        perHoldingML.push({ ticker: tickers[i], prediction: 0, weight: weights[i], signal: 'N/A' });
      }
    }

    // 11. Fetch factor data
    let factorMap: Map<string, Record<string, number>> = new Map();
    try {
      const factorQuery = `
        SELECT DISTINCT ON (ft.ticker)
          ft.ticker, ft.mom1m, ft.mom6m, ft.mom11m, ft.mom36m, ft.vol1m, ft.vol3m, ft.beta, ft.ivol,
          ff.bm, ff.ep, ff.dy, ff.sp, ff.mktcap, ff.ev_ebitda
        FROM factor_technical ft
        LEFT JOIN (
          SELECT DISTINCT ON (ticker) ticker, bm, ep, dy, sp, mktcap, ev_ebitda
          FROM factor_fundamentals
          ORDER BY ticker, date DESC
        ) ff ON ft.ticker = ff.ticker
        WHERE ft.ticker = ANY($1)
        ORDER BY ft.ticker, ft.date DESC
      `;
      const factorResult = await pool.query(factorQuery, [tickers]);
      factorMap = new Map(
        factorResult.rows.map((r: Record<string, unknown>) => [r.ticker as string, {
          mom1m: Number(r.mom1m || 0), mom6m: Number(r.mom6m || 0),
          mom11m: Number(r.mom11m || 0), mom36m: Number(r.mom36m || 0),
          vol1m: Number(r.vol1m || 0), vol3m: Number(r.vol3m || 0),
          beta: Number(r.beta || 0), ivol: Number(r.ivol || 0),
          bm: Number(r.bm || 0), ep: Number(r.ep || 0),
          dy: Number(r.dy || 0), sp: Number(r.sp || 0), mktcap: Number(r.mktcap || 0),
          ev_ebitda: Number(r.ev_ebitda || 0),
        }])
      );
    } catch { /* factor tables may not exist */ }

    // 12. Run all 5 optimizer modes for comparison
    const mlReturnsAnnualized = tickers.map((t: string) => {
      const pred = predMap.get(t);
      return pred ? pred.ensemble * 12 : 0;
    });

    const modeComparison: Record<string, {
      weights: number[];
      metrics: {
        expectedReturn: number; volatility: number; sharpeRatio: number;
        sortinoRatio: number; maxDrawdown: number; var95: number;
        effectivePositions: number; diversificationRatio: number;
        mlExpectedReturn: number; mlSharpe: number;
      };
      topHoldings: { ticker: string; weight: number }[];
    }> = {};

    for (const m of ALL_MODES) {
      const modeInput: OptimizationInput = {
        tickers, returns, sectors,
        mode: m,
        expectedReturns: m === 'max_sharpe'
          ? tickers.map((t: string) => {
              const pred = predMap.get(t);
              return pred ? pred.ensemble * 12 : 0;
            })
          : undefined,
        constraints: DEFAULT_CONSTRAINTS,
        riskFreeRate,
        covarianceMethod: covarianceMethod as CovarianceMethod,
      };
      const modeResult = optimizePortfolio(modeInput);

      const mlExpRet = modeResult.weights.reduce((sum, w, i) => sum + w * mlReturnsAnnualized[i], 0);
      const mlSharpe = modeResult.portfolioVolatility > 0
        ? (mlExpRet - riskFreeRate) / modeResult.portfolioVolatility
        : 0;

      modeComparison[m] = {
        weights: modeResult.weights,
        metrics: {
          expectedReturn: modeResult.portfolioReturn,
          volatility: modeResult.portfolioVolatility,
          sharpeRatio: modeResult.sharpeRatio,
          sortinoRatio: modeResult.sortinoRatio,
          maxDrawdown: modeResult.maxDrawdown,
          var95: modeResult.var95,
          effectivePositions: modeResult.effectivePositions,
          diversificationRatio: modeResult.diversificationRatio,
          mlExpectedReturn: mlExpRet,
          mlSharpe,
        },
        topHoldings: modeResult.weights
          .map((w, i) => ({ ticker: tickers[i], weight: w }))
          .filter(h => h.weight > 0.01)
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 5),
      };
    }

    // 13. Compute per-holding regime
    const holdingRegimes: { ticker: string; regime: string; volatility: number; percentile: number }[] = [];
    for (let i = 0; i < tickers.length; i++) {
      const rets = returns[i];
      const vol20 = Math.sqrt(rets.slice(-20).reduce((s, r) => s + r * r, 0) / 20) * Math.sqrt(252);
      const allVols: number[] = [];
      for (let t = 20; t <= rets.length; t++) {
        const window = rets.slice(t - 20, t);
        allVols.push(Math.sqrt(window.reduce((s, r) => s + r * r, 0) / 20) * Math.sqrt(252));
      }
      const percentile = allVols.filter(v => v <= vol20).length / allVols.length * 100;
      let regime = 'Normal';
      if (percentile > 95) regime = 'Crisis';
      else if (percentile > 85) regime = 'Extreme High';
      else if (percentile > 65) regime = 'Elevated';
      else if (percentile > 30) regime = 'Normal';
      else regime = 'Low & Stable';
      holdingRegimes.push({ ticker: tickers[i], regime, volatility: vol20, percentile });
    }

    // 14. Build per-holding signals
    const holdingBetas: Map<string, number> = new Map();
    if (obxDailyRets.length > 30) {
      const minLen = Math.min(obxDailyRets.length, returns[0].length);
      const obxSlice = obxDailyRets.slice(0, minLen);
      const meanM = obxSlice.reduce((a, b) => a + b, 0) / minLen;
      const varM = obxSlice.reduce((sum, r) => sum + (r - meanM) ** 2, 0) / (minLen - 1);
      for (let i = 0; i < tickers.length; i++) {
        const rets = returns[i].slice(0, minLen);
        const meanI = rets.reduce((a, b) => a + b, 0) / minLen;
        let covIM = 0;
        for (let t = 0; t < minLen; t++) {
          covIM += (rets[t] - meanI) * (obxSlice[t] - meanM);
        }
        covIM /= (minLen - 1);
        holdingBetas.set(tickers[i], varM > 0 ? covIM / varM : 0);
      }
    }

    const holdingSignals = tickers.map((t: string, i: number) => {
      const pred = predMap.get(t);
      const factors = factorMap.get(t);
      const regime = holdingRegimes[i];
      const beta = holdingBetas.get(t) ?? 0;
      const rets = returns[i];

      let mlSignal = 'N/A';
      if (pred) {
        if (pred.ensemble > 0.04) mlSignal = 'Strong Buy';
        else if (pred.ensemble > 0.015) mlSignal = 'Buy';
        else if (pred.ensemble > -0.015) mlSignal = 'Hold';
        else if (pred.ensemble > -0.04) mlSignal = 'Sell';
        else mlSignal = 'Strong Sell';
      }

      let momentumSignal = 'Neutral';
      if (factors) {
        const momScore = (factors.mom1m > 0 ? 1 : -1) + (factors.mom6m > 0 ? 1 : -1) + (factors.mom11m > 0 ? 1 : -1);
        if (momScore >= 2) momentumSignal = 'Bullish';
        else if (momScore <= -2) momentumSignal = 'Bearish';
      }

      // Drawdown
      let peak = 1, cumVal = 1, curDD = 0;
      for (const r of rets.slice(-126)) {
        cumVal *= (1 + r);
        if (cumVal > peak) peak = cumVal;
        curDD = (peak - cumVal) / peak;
      }

      const alerts: string[] = [];
      if (regime.percentile > 85) alerts.push('High volatility regime');
      if (curDD > 0.15) alerts.push(`In ${(curDD * 100).toFixed(0)}% drawdown`);
      if (beta > 1.5) alerts.push(`High beta (${beta.toFixed(1)})`);
      if (pred && pred.ensemble < -0.03) alerts.push('Negative ML prediction');

      return {
        ticker: t,
        mlSignal,
        mlReturn: pred?.ensemble ?? 0,
        mlPercentiles: pred ? { p05: pred.p05, p25: pred.p25, p50: pred.p50, p75: pred.p75, p95: pred.p95 } : null,
        momentumSignal,
        momentum: { mom1m: factors?.mom1m ?? null, mom6m: factors?.mom6m ?? null },
        beta,
        currentDrawdown: curDD,
        regime: regime.regime,
        regimePercentile: regime.percentile,
        alerts,
      };
    });

    // 15. Correlation matrix
    const n = tickers.length;
    const corrMatrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (cov[i][i] > 0 && cov[j][j] > 0) {
          corrMatrix[i][j] = cov[i][j] / Math.sqrt(cov[i][i] * cov[j][j]);
        } else {
          corrMatrix[i][j] = i === j ? 1 : 0;
        }
      }
    }

    // 16. Sector allocation
    const sectorWeights: Record<string, number> = {};
    for (let i = 0; i < tickers.length; i++) {
      const s = sectors[i];
      sectorWeights[s] = (sectorWeights[s] || 0) + weights[i];
    }
    const sectorAllocation = Object.entries(sectorWeights)
      .map(([sector, weight]) => ({ sector, weight }))
      .sort((a, b) => b.weight - a.weight);

    // 17. Risk alerts
    const riskAlerts: { level: 'info' | 'warning' | 'critical'; message: string }[] = [];
    if (herfindahlIndex > 0.15) {
      riskAlerts.push({ level: 'warning', message: `High concentration (HHI ${(herfindahlIndex * 100).toFixed(0)}%). Consider diversifying.` });
    }
    const crisisCount = holdingRegimes.filter(h => h.regime === 'Crisis' || h.regime === 'Extreme High').length;
    if (crisisCount > tickers.length * 0.3) {
      riskAlerts.push({ level: 'critical', message: `${crisisCount}/${tickers.length} holdings in high-volatility regime.` });
    }
    const topSectorWeight = Math.max(...Object.values(sectorWeights) as number[]);
    if (topSectorWeight > 0.4) {
      riskAlerts.push({ level: 'warning', message: `Top sector weight ${(topSectorWeight * 100).toFixed(0)}% exceeds 40%.` });
    }
    if (maxDrawdown > 0.2) {
      riskAlerts.push({ level: 'warning', message: `Historical max drawdown ${(maxDrawdown * 100).toFixed(0)}% is significant.` });
    }
    if (betaToOBX > 1.3) {
      riskAlerts.push({ level: 'info', message: `Portfolio beta ${betaToOBX.toFixed(2)} — amplified market exposure.` });
    }

    // 18. Build response
    const response = {
      manualMetrics: {
        expectedReturn: annualizedReturn,
        volatility: annualizedVol,
        sharpeRatio,
        sortinoRatio,
        var95,
        var99,
        cvar95,
        cvar99,
        maxDrawdown,
        betaToOBX,
        trackingError,
        herfindahlIndex,
        effectivePositions,
        diversificationRatio,
      },
      historicalSeries: {
        dates: returnDates,
        portfolio: cumulativePortfolio,
        benchmark: cumulativeBenchmark,
        stocks: cumulativeStocks,
      },
      riskDecomposition,
      correlationMatrix: { tickers, values: corrMatrix },
      sectorAllocation,
      modeComparison,
      mlForecast: {
        portfolioExpectedReturn,
        p05: portfolioP05,
        p25: portfolioP25,
        p50: portfolioP50,
        p75: portfolioP75,
        p95: portfolioP95,
        perHolding: perHoldingML,
      },
      holdingSignals,
      riskAlerts,
      weights: tickers.map((t: string, i: number) => {
        const meta = metaMap.get(t);
        const valueNOK = weights[i] * portfolioValueNOK;
        const sharesApprox = lastPrices[i] > 0 ? Math.floor(valueNOK / lastPrices[i]) : 0;
        return {
          ticker: t,
          name: meta?.name || t,
          sector: sectors[i],
          currency: meta?.currency || 'NOK',
          weight: weights[i],
          sharesApprox,
          valueNOK,
          lastPrice: lastPrices[i],
        };
      }),
      meta: {
        lookbackDays,
        covarianceMethod,
        portfolioValueNOK,
        commonDates: trimmedDates.length,
      },
    };

    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error('Portfolio analysis error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}
