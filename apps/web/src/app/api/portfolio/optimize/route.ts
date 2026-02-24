import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getPriceTable } from '@/lib/price-data-adapter';
import { requireAuth } from '@/lib/security';
import {
  optimizePortfolio,
  OptimizationMode,
  CovarianceMethod,
  OptimizationConstraints,
  OptimizationInput,
} from '@/lib/portfolioOptimizer';

export const dynamic = 'force-dynamic';

const DEFAULT_CONSTRAINTS: OptimizationConstraints = {
  maxPositionSize: 0.10,
  minPositionSize: 0.01,
  maxSectorExposure: 0.30,
  excludeTickers: [],
};

const ALL_MODES: OptimizationMode[] = [
  'equal', 'min_variance', 'max_sharpe', 'risk_parity', 'max_diversification',
];

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const {
      tickers,
      mode = 'min_variance',
      constraints = {},
      forceIncludeAll = true,
      lookbackDays = 504,
      portfolioValueNOK = 10_000_000,
      riskFreeRate = 0.045,
      covarianceMethod = 'shrinkage',
    } = body;

    if (!tickers || !Array.isArray(tickers) || tickers.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 tickers required' },
        { status: 400 }
      );
    }

    if (tickers.length > 60) {
      return NextResponse.json(
        { error: 'Maximum 60 tickers supported' },
        { status: 400 }
      );
    }

    // Validate tickers (alphanumeric + dots only)
    const validTickers = tickers.every((t: string) => /^[A-Z0-9.]+$/.test(t));
    if (!validTickers) {
      return NextResponse.json(
        { error: 'Invalid ticker format' },
        { status: 400 }
      );
    }

    const mergedConstraints: OptimizationConstraints = {
      ...DEFAULT_CONSTRAINTS,
      ...constraints,
    };

    // Auto-adjust maxPositionSize if infeasible for fully-invested portfolio
    // With N tickers and minPos > 0, need N × maxPos >= 1
    let constraintAdjusted = false;
    let originalMaxPosition = mergedConstraints.maxPositionSize;
    const minFullWeight = 1 / tickers.length;
    if (mergedConstraints.minPositionSize > 0 && mergedConstraints.maxPositionSize < minFullWeight) {
      // Give ~5% room above equal-weight for optimizer to differentiate
      mergedConstraints.maxPositionSize = Math.min(1, minFullWeight + 0.05);
      constraintAdjusted = true;
    }

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

    // Check all tickers have data
    const missingTickers = tickers.filter((t: string) => !rawData[t] || rawData[t].length < 30);
    if (missingTickers.length > 0) {
      return NextResponse.json(
        { error: `Insufficient data for: ${missingTickers.join(', ')}` },
        { status: 400 }
      );
    }

    // 3. Find common dates (intersection)
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

    // Trim to requested lookback
    const trimmedDates = commonDates.slice(-lookbackDays);

    // 4. Build aligned price series and compute log returns
    const returns: number[][] = [];
    const lastPrices: number[] = [];

    for (const t of tickers) {
      const priceMap = new Map(rawData[t].map(p => [p.date, p.price]));
      const prices = trimmedDates.map(d => priceMap.get(d) || 0).filter(p => p > 0);

      const rets: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        rets.push(Math.log(prices[i] / prices[i - 1]));
      }
      returns.push(rets);
      lastPrices.push(prices[prices.length - 1]);
    }

    // 5. Fetch ML predictions for ALL holdings (always, not just max_sharpe)
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

    // Annualize for max_sharpe mode
    let expectedReturns: number[] | undefined;
    if (mode === 'max_sharpe') {
      expectedReturns = tickers.map((t: string) => {
        const pred = predMap.get(t);
        return pred ? pred.ensemble * 12 : 0;
      });
    }

    // 6. Fetch stock metadata (sectors, names)
    const metaQuery = `
      SELECT ticker, name, sector, currency
      FROM stocks
      WHERE ticker = ANY($1)
    `;
    const metaResult = await pool.query(metaQuery, [tickers]);
    const metaMap = new Map(
      metaResult.rows.map((r: { ticker: string; name: string; sector: string; currency: string }) => [r.ticker, r])
    );
    const sectors = tickers.map((t: string) => metaMap.get(t)?.sector || 'Unknown');

    // 7. Fetch factor data (momentum + fundamentals)
    let factorMap: Map<string, Record<string, number>> = new Map();
    try {
      const factorQuery = `
        SELECT DISTINCT ON (ft.ticker)
          ft.ticker, ft.mom1m, ft.mom6m, ft.mom11m, ft.mom36m, ft.vol1m, ft.vol3m, ft.beta, ft.ivol,
          ff.bm, ff.ep, ff.dy, ff.mktcap
        FROM factor_technical ft
        LEFT JOIN (
          SELECT DISTINCT ON (ticker) ticker, bm, ep, dy, mktcap
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
          dy: Number(r.dy || 0), mktcap: Number(r.mktcap || 0),
        }])
      );
    } catch { /* factor tables may not exist */ }

    // 8. Fetch recent research document count and latest date per holding
    let researchMap: Map<string, { count: number; latestDate: string }> = new Map();
    try {
      const researchQuery = `
        SELECT ticker, COUNT(*) as cnt, MAX(received_at)::text as latest
        FROM research_documents
        WHERE ticker = ANY($1)
          AND received_at >= NOW() - INTERVAL '90 days'
        GROUP BY ticker
      `;
      const researchResult = await pool.query(researchQuery, [tickers]);
      researchMap = new Map(
        researchResult.rows.map((r: { ticker: string; cnt: string; latest: string }) =>
          [r.ticker, { count: Number(r.cnt), latestDate: r.latest }]
        )
      );
    } catch { /* research tables may not exist */ }

    // 9. Run primary optimization
    const baseInput: OptimizationInput = {
      tickers, returns, expectedReturns, sectors,
      mode: mode as OptimizationMode,
      constraints: mergedConstraints,
      riskFreeRate,
      covarianceMethod: covarianceMethod as CovarianceMethod,
    };
    const result = optimizePortfolio(baseInput);

    // 10. Run all modes for comparison
    const mlReturnsAnnualized = tickers.map((t: string) => {
      const pred = predMap.get(t);
      return pred ? pred.ensemble * 12 : 0;
    });

    const modeComparison: Record<string, {
      expectedReturn: number; volatility: number; sharpeRatio: number;
      sortinoRatio: number; maxDrawdown: number; var95: number;
      effectivePositions: number; diversificationRatio: number;
      mlExpectedReturn: number; mlSharpe: number;
      topHoldings: { ticker: string; weight: number }[];
    }> = {};

    for (const m of ALL_MODES) {
      const modeInput: OptimizationInput = {
        ...baseInput,
        mode: m,
        expectedReturns: m === 'max_sharpe'
          ? tickers.map((t: string) => {
              const pred = predMap.get(t);
              return pred ? pred.ensemble * 12 : 0;
            })
          : undefined,
      };
      const modeResult = optimizePortfolio(modeInput);

      // Compute ML-based expected return for this mode's weights
      const mlExpRet = modeResult.weights.reduce((sum, w, i) => sum + w * mlReturnsAnnualized[i], 0);
      const mlSharpe = modeResult.portfolioVolatility > 0
        ? (mlExpRet - riskFreeRate) / modeResult.portfolioVolatility
        : 0;

      modeComparison[m] = {
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
        topHoldings: modeResult.weights
          .map((w, i) => ({ ticker: tickers[i], weight: w }))
          .filter(h => h.weight > 0.01)
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 5),
      };
    }

    // 11. Compute beta to OBX
    let betaToOBX = 0;
    let trackingError = 0;
    const obxDailyRets: number[] = [];
    if (rawData['OBX'] && rawData['OBX'].length > 30) {
      const obxMap = new Map(rawData['OBX'].map(p => [p.date, p.price]));
      const obxPrices = trimmedDates.map(d => obxMap.get(d)).filter(p => p && p > 0) as number[];

      if (obxPrices.length > 30) {
        for (let i = 1; i < obxPrices.length; i++) {
          obxDailyRets.push(Math.log(obxPrices[i] / obxPrices[i - 1]));
        }

        const minLen = Math.min(obxDailyRets.length, returns[0].length);
        const portDailyRets = [];
        for (let t = 0; t < minLen; t++) {
          let pr = 0;
          for (let i = 0; i < tickers.length; i++) {
            pr += result.weights[i] * returns[i][t];
          }
          portDailyRets.push(pr);
        }

        const obxSlice = obxDailyRets.slice(0, minLen);

        const meanP = portDailyRets.reduce((a, b) => a + b, 0) / minLen;
        const meanM = obxSlice.reduce((a, b) => a + b, 0) / minLen;
        let covPM = 0, varM = 0;
        for (let t = 0; t < minLen; t++) {
          covPM += (portDailyRets[t] - meanP) * (obxSlice[t] - meanM);
          varM += (obxSlice[t] - meanM) ** 2;
        }
        covPM /= (minLen - 1);
        varM /= (minLen - 1);
        betaToOBX = varM > 0 ? covPM / varM : 0;

        const activeReturns = portDailyRets.map((r, i) => r - obxSlice[i]);
        const meanActive = activeReturns.reduce((a, b) => a + b, 0) / minLen;
        const teVar = activeReturns.reduce((sum, r) => sum + (r - meanActive) ** 2, 0) / (minLen - 1);
        trackingError = Math.sqrt(teVar * 252);
      }
    }

    // 12. Compute per-holding beta to OBX
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

    // 13. Fetch FX exposure
    const fxQuery = `
      SELECT ticker, usd_revenue_pct, eur_revenue_pct, gbp_revenue_pct, nok_revenue_pct, other_revenue_pct
      FROM stock_fx_exposure
      WHERE ticker = ANY($1)
    `;
    let fxExposure: { currency: string; weightedExposure: number }[] = [];
    const fxDataMap: Map<string, Record<string, number>> = new Map();
    try {
      const fxResult = await pool.query(fxQuery, [tickers]);
      for (const r of fxResult.rows) {
        fxDataMap.set(r.ticker as string, {
          USD: Number(r.usd_revenue_pct || 0),
          EUR: Number(r.eur_revenue_pct || 0),
          GBP: Number(r.gbp_revenue_pct || 0),
          NOK: Number(r.nok_revenue_pct || 0),
          Other: Number(r.other_revenue_pct || 0),
        });
      }

      const currencies = ['USD', 'EUR', 'GBP', 'NOK', 'Other'];
      fxExposure = currencies.map(cur => {
        let weighted = 0;
        for (let i = 0; i < tickers.length; i++) {
          const fx = fxDataMap.get(tickers[i]);
          const pct = fx ? fx[cur] : (cur === 'NOK' ? 100 : 0);
          weighted += result.weights[i] * pct;
        }
        return { currency: cur, weightedExposure: weighted };
      });
    } catch {
      fxExposure = [{ currency: 'NOK', weightedExposure: 100 }];
    }

    // 13b. Fetch multivariate portfolio regime from ML service (non-blocking)
    type RegimeState = {
      current_state: number;
      current_state_label: string;
      current_probs: number[];
      state_labels: string[];
      transition_matrix: number[][];
      state_stats: {
        label: string;
        mean_return: number;
        annualized_vol: number;
        avg_correlation: number;
        expected_duration_days: number;
        frequency: number;
        n_observations: number;
        per_asset_returns: Record<string, number>;
      }[];
      regime_history: {
        state: number;
        label: string;
        probs: number[];
        date?: string;
      }[];
      regime_conditional_returns: Record<string, Record<string, number>>;
      bic: number;
      n_observations: number;
    };
    let portfolioRegime: RegimeState | null = null;
    try {
      const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://localhost:8000';
      const regimeResponse = await fetch(`${mlServiceUrl}/regime/multivariate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, benchmark: 'OBX', n_states: 3 }),
        signal: AbortSignal.timeout(15000),
      });
      if (regimeResponse.ok) {
        portfolioRegime = await regimeResponse.json();
      }
    } catch {
      // ML service not available — continue with per-holding regime only
    }

    // 13c. Fetch spectral clustering from ML service (non-blocking)
    type ClusterAssignment = {
      cluster_id: number;
      z_score: number;
      half_life: number | null;
      signal: string;
    };
    type ClusterInfo = {
      id: number;
      tickers: string[];
      n_members: number;
      half_life: number | null;
      z_score: number;
      ou_mu: number;
      ou_sigma: number;
      ou_phi: number;
      intra_cluster_correlation: number;
      mean_reversion_signal: string;
    };
    let clusterData: {
      n_clusters: number;
      clusters: ClusterInfo[];
      assignments: Record<string, ClusterAssignment>;
      silhouette_score: number;
    } | null = null;
    try {
      const mlServiceUrl2 = process.env.ML_SERVICE_URL || 'http://localhost:8000';
      const clusterResponse = await fetch(`${mlServiceUrl2}/clustering/spectral`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, lookback_days: lookbackDays, benchmark: 'OBX' }),
        signal: AbortSignal.timeout(15000),
      });
      if (clusterResponse.ok) {
        clusterData = await clusterResponse.json();
      }
    } catch {
      // ML service not available — continue without clustering
    }

    // 13d. Fetch CNN signals from ML service (non-blocking)
    let cnnSignals: Record<string, number> | null = null;
    try {
      const mlServiceUrl3 = process.env.ML_SERVICE_URL || 'http://localhost:8000';
      const cnnResponse = await fetch(`${mlServiceUrl3}/signals/cnn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, lookback_days: 504, epochs: 20, window: 60 }),
        signal: AbortSignal.timeout(90000), // CNN training takes ~30-60s with 20 epochs
      });
      if (cnnResponse.ok) {
        const cnnResult = await cnnResponse.json();
        if (cnnResult.signals) {
          cnnSignals = cnnResult.signals;
        }
      }
    } catch {
      // ML service not available — CNN signals will be null
    }

    // 13e. Fetch combined signals from ML service (non-blocking)
    type CombinedSignal = {
      ticker: string;
      combined_signal: number;
      classification: string;
      component_signals: Record<string, number>;
      weights_used: Record<string, number>;
      regime_adjusted: boolean;
    };
    let combinedSignals: CombinedSignal[] | null = null;
    try {
      const mlServiceUrl4 = process.env.ML_SERVICE_URL || 'http://localhost:8000';
      // Build signal combine request from data we already have
      const mlPreds: Record<string, number> = {};
      const momData: Record<string, Record<string, number>> = {};
      const valData: Record<string, Record<string, number>> = {};
      for (const t of tickers) {
        const pred = predMap.get(t);
        if (pred) mlPreds[t] = pred.ensemble;
        const factors = factorMap.get(t);
        if (factors) {
          momData[t] = { mom1m: factors.mom1m, mom6m: factors.mom6m, mom11m: factors.mom11m };
          valData[t] = { ep: factors.ep, bm: factors.bm, dy: factors.dy };
        }
      }
      const combineResponse = await fetch(`${mlServiceUrl4}/signals/combine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tickers,
          ml_predictions: Object.keys(mlPreds).length > 0 ? mlPreds : null,
          cnn_signals: cnnSignals,
          momentum_data: Object.keys(momData).length > 0 ? momData : null,
          valuation_data: Object.keys(valData).length > 0 ? valData : null,
          cluster_assignments: clusterData?.assignments ?? null,
          regime_label: portfolioRegime?.current_state_label ?? null,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (combineResponse.ok) {
        const combineResult = await combineResponse.json();
        combinedSignals = combineResult.signals;
      }
    } catch {
      // ML service not available
    }

    // 14. Compute regime + vol metrics for each holding
    const holdingRegimes: {
      ticker: string; regime: string; volatility: number; percentile: number;
    }[] = [];
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

    // 15. Build per-holding intelligence signals
    const holdingSignals = tickers.map((t: string, i: number) => {
      const pred = predMap.get(t);
      const factors = factorMap.get(t);
      const research = researchMap.get(t);
      const regime = holdingRegimes[i];
      const beta = holdingBetas.get(t) ?? 0;
      const rets = returns[i];

      // Compute return metrics
      const ret1m = rets.slice(-21).reduce((a, b) => a + b, 0);
      const ret3m = rets.slice(-63).reduce((a, b) => a + b, 0);
      const ret6m = rets.slice(-126).reduce((a, b) => a + b, 0);

      // Compute drawdown from peak
      let peak = 1, cumVal = 1, curDD = 0;
      for (const r of rets.slice(-126)) {
        cumVal *= (1 + r);
        if (cumVal > peak) peak = cumVal;
        curDD = (peak - cumVal) / peak;
      }

      // ML signal classification
      let mlSignal: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell' | 'N/A' = 'N/A';
      let mlReturn = 0;
      if (pred) {
        mlReturn = pred.ensemble;
        if (pred.ensemble > 0.04) mlSignal = 'Strong Buy';
        else if (pred.ensemble > 0.015) mlSignal = 'Buy';
        else if (pred.ensemble > -0.015) mlSignal = 'Hold';
        else if (pred.ensemble > -0.04) mlSignal = 'Sell';
        else mlSignal = 'Strong Sell';
      }

      // Momentum signal
      let momentumSignal: 'Bullish' | 'Neutral' | 'Bearish' = 'Neutral';
      if (factors) {
        const momScore = (factors.mom1m > 0 ? 1 : -1) + (factors.mom6m > 0 ? 1 : -1) + (factors.mom11m > 0 ? 1 : -1);
        if (momScore >= 2) momentumSignal = 'Bullish';
        else if (momScore <= -2) momentumSignal = 'Bearish';
      }

      // Valuation signal
      let valuationSignal: 'Cheap' | 'Fair' | 'Expensive' | 'N/A' = 'N/A';
      if (factors && factors.ep > 0) {
        if (factors.ep > 0.08) valuationSignal = 'Cheap';
        else if (factors.ep > 0.04) valuationSignal = 'Fair';
        else valuationSignal = 'Expensive';
      }

      // Composite conviction: weighted score from ML, momentum, valuation, regime
      let conviction = 0;
      let convictionFactors = 0;
      if (pred) {
        conviction += pred.ensemble > 0 ? 1 : -1;
        conviction += Math.min(1, Math.max(-1, pred.ensemble * 10)); // scale
        convictionFactors += 2;
      }
      if (momentumSignal === 'Bullish') { conviction += 1; convictionFactors += 1; }
      else if (momentumSignal === 'Bearish') { conviction -= 1; convictionFactors += 1; }
      if (valuationSignal === 'Cheap') { conviction += 0.5; convictionFactors += 1; }
      else if (valuationSignal === 'Expensive') { conviction -= 0.5; convictionFactors += 1; }
      if (regime.regime === 'Low & Stable') { conviction += 0.3; convictionFactors += 1; }
      else if (regime.regime === 'Crisis' || regime.regime === 'Extreme High') { conviction -= 0.5; convictionFactors += 1; }

      const normalizedConviction = convictionFactors > 0 ? conviction / convictionFactors : 0;

      // Risk alerts for this holding
      const alerts: string[] = [];
      if (regime.percentile > 85) alerts.push('High volatility regime');
      if (curDD > 0.15) alerts.push(`In ${(curDD * 100).toFixed(0)}% drawdown`);
      if (beta > 1.5) alerts.push(`High beta (${beta.toFixed(1)})`);
      if (pred && pred.ensemble < -0.03) alerts.push('Negative ML prediction');
      if (factors && factors.vol1m > factors.vol3m * 1.5) alerts.push('Vol expanding');

      return {
        ticker: t,
        mlSignal,
        mlReturn,
        mlConfidence: pred?.confidence ?? 0,
        mlPercentiles: pred ? { p05: pred.p05, p25: pred.p25, p50: pred.p50, p75: pred.p75, p95: pred.p95 } : null,
        momentumSignal,
        momentum: {
          ret1m: ret1m, ret3m: ret3m, ret6m: ret6m,
          mom1m: factors?.mom1m ?? null,
          mom6m: factors?.mom6m ?? null,
        },
        valuationSignal,
        valuation: {
          ep: factors?.ep ?? null,
          bm: factors?.bm ?? null,
          dy: factors?.dy ?? null,
          mktcap: factors?.mktcap ?? null,
        },
        beta,
        currentDrawdown: curDD,
        conviction: normalizedConviction,
        researchCount: research?.count ?? 0,
        researchLatest: research?.latestDate ?? null,
        alerts,
        cluster: clusterData?.assignments?.[t] ?? null,
        combinedSignal: combinedSignals?.find(s => s.ticker === t) ?? null,
      };
    });

    // 16. Generate portfolio-level risk alerts
    const riskAlerts: { level: 'info' | 'warning' | 'critical'; message: string }[] = [];

    // Concentration
    if (result.herfindahlIndex > 0.15) {
      riskAlerts.push({ level: 'warning', message: `High concentration (HHI ${(result.herfindahlIndex * 100).toFixed(0)}%). Consider diversifying.` });
    }
    // Regime
    const crisisCount = holdingRegimes.filter(h => h.regime === 'Crisis' || h.regime === 'Extreme High').length;
    if (crisisCount > tickers.length * 0.3) {
      riskAlerts.push({ level: 'critical', message: `${crisisCount}/${tickers.length} holdings in high-volatility regime. Consider de-risking.` });
    }
    // Sector concentration
    const sectorWts: Record<string, number> = {};
    for (let i = 0; i < tickers.length; i++) {
      const s = sectors[i];
      sectorWts[s] = (sectorWts[s] || 0) + result.weights[i];
    }
    const topSectorWeight = Math.max(...Object.values(sectorWts) as number[]);
    if (topSectorWeight > 0.4) {
      riskAlerts.push({ level: 'warning', message: `Top sector weight ${(topSectorWeight * 100).toFixed(0)}% exceeds 40%. Sector risk elevated.` });
    }
    // Drawdown
    if (result.maxDrawdown > 0.2) {
      riskAlerts.push({ level: 'warning', message: `Historical max drawdown ${(result.maxDrawdown * 100).toFixed(0)}% is significant.` });
    }
    // Negative ML on large positions
    const negMlLargePos = holdingSignals.filter(
      (s, i) => s.mlSignal === 'Sell' || s.mlSignal === 'Strong Sell' ? result.weights[i] > 0.05 : false
    );
    if (negMlLargePos.length > 0) {
      riskAlerts.push({
        level: 'warning',
        message: `Negative ML signal on ${negMlLargePos.map(s => s.ticker).join(', ')} (>5% weight). Review positions.`,
      });
    }
    // Beta
    if (betaToOBX > 1.3) {
      riskAlerts.push({ level: 'info', message: `Portfolio beta ${betaToOBX.toFixed(2)} — amplified market exposure.` });
    }

    // 17. Sector allocation
    const sectorWeights: Record<string, number> = {};
    for (let i = 0; i < tickers.length; i++) {
      const s = sectors[i];
      sectorWeights[s] = (sectorWeights[s] || 0) + result.weights[i];
    }
    const sectorAllocation = Object.entries(sectorWeights)
      .map(([sector, weight]) => ({ sector, weight }))
      .sort((a, b) => b.weight - a.weight);

    // 18. Build response
    const response = {
      weights: tickers.map((t: string, i: number) => {
        const meta = metaMap.get(t);
        const valueNOK = result.weights[i] * portfolioValueNOK;
        const sharesApprox = lastPrices[i] > 0 ? Math.floor(valueNOK / lastPrices[i]) : 0;
        return {
          ticker: t,
          name: meta?.name || t,
          sector: sectors[i],
          currency: meta?.currency || 'NOK',
          weight: result.weights[i],
          sharesApprox,
          valueNOK,
          lastPrice: lastPrices[i],
        };
      }),
      metrics: {
        expectedReturn: result.portfolioReturn,
        volatility: result.portfolioVolatility,
        sharpeRatio: result.sharpeRatio,
        sortinoRatio: result.sortinoRatio,
        var95: result.var95,
        var99: result.var99,
        cvar95: result.cvar95,
        cvar99: result.cvar99,
        maxDrawdown: result.maxDrawdown,
        betaToOBX,
        trackingError,
        herfindahlIndex: result.herfindahlIndex,
        effectivePositions: result.effectivePositions,
        diversificationRatio: result.diversificationRatio,
      },
      riskDecomposition: result.riskDecomposition,
      efficientFrontier: result.efficientFrontier,
      assetPoints: result.assetPoints,
      correlationMatrix: {
        tickers,
        values: result.correlationMatrix,
      },
      sectorAllocation,
      fxExposure,
      regimeContext: {
        holdingRegimes,
        portfolioRegime,
      },
      clusterAnalysis: clusterData,
      stressScenarios: result.stressScenarios,
      holdingSignals,
      riskAlerts,
      modeComparison,
      meta: {
        lookbackDays,
        covarianceMethod,
        mode,
        riskFreeRate,
        portfolioValueNOK,
        commonDates: trimmedDates.length,
        shrinkageIntensity: result.shrinkageIntensity,
        constraintAdjusted,
        originalMaxPosition: constraintAdjusted ? originalMaxPosition : undefined,
        effectiveMaxPosition: mergedConstraints.maxPositionSize,
      },
    };

    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error('Portfolio optimization error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Optimization failed' },
      { status: 500 }
    );
  }
}
