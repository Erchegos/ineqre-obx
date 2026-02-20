import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getPriceTable } from '@/lib/price-data-adapter';
import { requireAuth } from '@/lib/security';
import {
  optimizePortfolio,
  OptimizationMode,
  CovarianceMethod,
  OptimizationConstraints,
} from '@/lib/portfolioOptimizer';

export const dynamic = 'force-dynamic';

const DEFAULT_CONSTRAINTS: OptimizationConstraints = {
  maxPositionSize: 0.10,
  minPositionSize: 0.01,
  maxSectorExposure: 0.30,
  excludeTickers: [],
};

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const {
      tickers,
      mode = 'min_variance',
      constraints = {},
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

    // 5. Fetch ML predictions for expected returns (Max Sharpe mode)
    let expectedReturns: number[] | undefined;
    if (mode === 'max_sharpe') {
      const predQuery = `
        SELECT DISTINCT ON (ticker) ticker, ensemble_prediction
        FROM ml_predictions
        WHERE ticker = ANY($1)
        ORDER BY ticker, prediction_date DESC
      `;
      const predResult = await pool.query(predQuery, [tickers]);
      const predMap = new Map(
        predResult.rows.map((r: { ticker: string; ensemble_prediction: string }) => [r.ticker, Number(r.ensemble_prediction)])
      );

      // Annualize monthly predictions: multiply by 12
      expectedReturns = tickers.map((t: string) => {
        const pred = predMap.get(t);
        return pred !== undefined ? pred * 12 : 0;
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

    // 7. Run optimization
    const result = optimizePortfolio({
      tickers,
      returns,
      expectedReturns,
      sectors,
      mode: mode as OptimizationMode,
      constraints: mergedConstraints,
      riskFreeRate,
      covarianceMethod: covarianceMethod as CovarianceMethod,
    });

    // 8. Compute beta to OBX
    let betaToOBX = 0;
    let trackingError = 0;
    if (rawData['OBX'] && rawData['OBX'].length > 30) {
      const obxMap = new Map(rawData['OBX'].map(p => [p.date, p.price]));
      const obxPrices = trimmedDates.map(d => obxMap.get(d)).filter(p => p && p > 0) as number[];

      if (obxPrices.length > 30) {
        const obxRets: number[] = [];
        for (let i = 1; i < obxPrices.length; i++) {
          obxRets.push(Math.log(obxPrices[i] / obxPrices[i - 1]));
        }

        // Portfolio daily returns
        const minLen = Math.min(obxRets.length, returns[0].length);
        const portDailyRets = [];
        for (let t = 0; t < minLen; t++) {
          let pr = 0;
          for (let i = 0; i < tickers.length; i++) {
            pr += result.weights[i] * returns[i][t];
          }
          portDailyRets.push(pr);
        }

        const obxSlice = obxRets.slice(0, minLen);

        // Beta = Cov(Rp, Rm) / Var(Rm)
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

        // Tracking error = std(Rp - Rm)
        const activeReturns = portDailyRets.map((r, i) => r - obxSlice[i]);
        const meanActive = activeReturns.reduce((a, b) => a + b, 0) / minLen;
        const teVar = activeReturns.reduce((sum, r) => sum + (r - meanActive) ** 2, 0) / (minLen - 1);
        trackingError = Math.sqrt(teVar * 252);
      }
    }

    // 9. Fetch FX exposure
    const fxQuery = `
      SELECT ticker, usd_revenue_pct, eur_revenue_pct, gbp_revenue_pct, nok_revenue_pct, other_revenue_pct
      FROM stock_fx_exposure
      WHERE ticker = ANY($1)
    `;
    let fxExposure: { currency: string; weightedExposure: number }[] = [];
    try {
      const fxResult = await pool.query(fxQuery, [tickers]);
      const fxMap = new Map(fxResult.rows.map((r: Record<string, unknown>) => [r.ticker as string, r]));

      const currencies = ['USD', 'EUR', 'GBP', 'NOK', 'Other'];
      const fxFields = ['usd_revenue_pct', 'eur_revenue_pct', 'gbp_revenue_pct', 'nok_revenue_pct', 'other_revenue_pct'];

      fxExposure = currencies.map((cur, ci) => {
        let weighted = 0;
        for (let i = 0; i < tickers.length; i++) {
          const fx = fxMap.get(tickers[i]) as Record<string, unknown> | undefined;
          const pct = fx ? Number(fx[fxFields[ci]] || 0) : (cur === 'NOK' ? 100 : 0);
          weighted += result.weights[i] * pct;
        }
        return { currency: cur, weightedExposure: weighted };
      });
    } catch {
      // FX data may not exist for all tickers
      fxExposure = [{ currency: 'NOK', weightedExposure: 100 }];
    }

    // 10. Fetch current regime for each holding
    const holdingRegimes: { ticker: string; regime: string; volatility: number; percentile: number }[] = [];
    // We'll compute a simple vol percentile from available data
    for (let i = 0; i < tickers.length; i++) {
      const rets = returns[i];
      const vol20 = Math.sqrt(rets.slice(-20).reduce((s, r) => s + r * r, 0) / 20) * Math.sqrt(252);
      const vol252 = Math.sqrt(rets.reduce((s, r) => s + r * r, 0) / rets.length) * Math.sqrt(252);

      // Simple percentile: where does current 20d vol sit vs all 20d rolling windows
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

      holdingRegimes.push({
        ticker: tickers[i],
        regime,
        volatility: vol20,
        percentile,
      });
    }

    // 11. Sector allocation
    const sectorWeights: Record<string, number> = {};
    for (let i = 0; i < tickers.length; i++) {
      const s = sectors[i];
      sectorWeights[s] = (sectorWeights[s] || 0) + result.weights[i];
    }
    const sectorAllocation = Object.entries(sectorWeights)
      .map(([sector, weight]) => ({ sector, weight }))
      .sort((a, b) => b.weight - a.weight);

    // 12. Build response
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
      },
      stressScenarios: result.stressScenarios,
      meta: {
        lookbackDays,
        covarianceMethod,
        mode,
        riskFreeRate,
        portfolioValueNOK,
        commonDates: trimmedDates.length,
        shrinkageIntensity: result.shrinkageIntensity,
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
