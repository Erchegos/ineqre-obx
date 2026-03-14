/**
 * Calculate FX Multi-Currency Regressions
 *
 * Rolling multi-currency regression pipeline:
 *   R_stock = α + β_mkt×R_OBX + β_usd×R_USDNOK + β_eur×R_EURNOK + β_gbp×R_GBPNOK + β_sek×R_SEKNOK + ε
 *
 * Usage:
 *   npx tsx scripts/calculate-fx-regressions.ts [--ticker=EQNR] [--window=252] [--dry-run]
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../../../.env") });

import { pool } from "../src/lib/db";
import { multiCurrencyRegression } from "../src/lib/fxTerminal";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tickerArg = args.find(a => a.startsWith("--ticker="))?.split("=")[1]?.toUpperCase();
const windowArg = args.find(a => a.startsWith("--window="))?.split("=")[1];
const WINDOW_SIZES = windowArg ? [parseInt(windowArg)] : [252];
const STEP_SIZE = 21; // 1-month rolling step
const MIN_OBS = 60;

// Skip non-equity tickers
const SKIP = new Set(["OBX", "OSEBX", "SPY", "QQQ", "BZ=F", "CL=F", "NG=F", "ALI=F", "GC=F", "SI=F"]);

async function main() {
  const startTime = Date.now();

  console.log("═══════════════════════════════════════════════════════");
  console.log("  FX Multi-Currency Regression Pipeline");
  console.log("═══════════════════════════════════════════════════════\n");

  if (dryRun) console.log("(DRY RUN — no database writes)\n");

  // 1. Fetch market index returns (OBX) — deduplicate: prefer OBX over OSEBX
  console.log("  Loading OBX returns...");
  const obxResult = await pool.query<{ date: string; close: string }>(
    `SELECT DISTINCT ON (date) date::text, close FROM prices_daily
     WHERE ticker IN ('OBX', 'OSEBX') AND close IS NOT NULL AND close > 0
     ORDER BY date ASC, ticker ASC`
  );
  if (obxResult.rows.length < MIN_OBS) {
    console.error("  ERROR: Insufficient OBX data");
    await pool.end();
    return;
  }
  const obxPrices = obxResult.rows.map(r => ({ date: r.date, price: parseFloat(r.close) }));
  console.log(`  OBX: ${obxPrices.length} data points (deduped)\n`);

  // 2. Fetch FX rates
  console.log("  Loading FX rates...");
  const fxPairs = ["NOKUSD", "NOKEUR", "NOKGBP", "NOKSEK"];
  const fxData: Record<string, { date: string; rate: number }[]> = {};

  for (const pair of fxPairs) {
    // Deduplicate: prefer 'norgesbank' source over legacy 'norges_bank'
    const result = await pool.query<{ date: string; spot_rate: string }>(
      `SELECT DISTINCT ON (date) date::text, spot_rate FROM fx_spot_rates
       WHERE currency_pair = $1 AND spot_rate > 0
       ORDER BY date ASC, CASE WHEN source = 'norgesbank' THEN 0 ELSE 1 END`,
      [pair]
    );
    fxData[pair] = result.rows.map(r => ({ date: r.date, rate: parseFloat(r.spot_rate) }));
    console.log(`  ${pair}: ${fxData[pair].length} data points (deduped)`);
  }

  // Check we have FX data
  const minFxLen = Math.min(...Object.values(fxData).map(d => d.length));
  if (minFxLen < MIN_OBS) {
    console.error("\n  ERROR: Insufficient FX data. Run fetch-fx-norgesbank.ts first.");
    await pool.end();
    return;
  }

  // 3. Get stock tickers
  let tickers: string[];
  if (tickerArg) {
    tickers = [tickerArg];
  } else {
    const result = await pool.query<{ ticker: string }>(
      `SELECT DISTINCT ticker FROM prices_daily
       WHERE close IS NOT NULL AND close > 0
       GROUP BY ticker HAVING COUNT(*) > $1
       ORDER BY ticker`,
      [MIN_OBS]
    );
    tickers = result.rows.map(r => r.ticker).filter(t => !SKIP.has(t));
  }

  console.log(`\n  Processing ${tickers.length} tickers...\n`);

  // Build date-aligned data structures
  // Create a date index from OBX dates
  const obxDateMap = new Map(obxPrices.map(r => [r.date, r.price]));
  const fxDateMaps: Record<string, Map<string, number>> = {};
  for (const pair of fxPairs) {
    fxDateMaps[pair] = new Map(fxData[pair].map(r => [r.date, r.rate]));
  }

  let totalInserted = 0;
  let totalErrors = 0;

  for (const ticker of tickers) {
    // Fetch stock prices
    const stockResult = await pool.query<{ date: string; close: string }>(
      `SELECT date::text, close FROM prices_daily
       WHERE ticker = $1 AND close IS NOT NULL AND close > 0
       ORDER BY date ASC`,
      [ticker]
    );

    if (stockResult.rows.length < MIN_OBS) continue;

    const stockPrices = stockResult.rows.map(r => ({ date: r.date, price: parseFloat(r.close) }));

    // Align all series by date
    const commonDates: string[] = [];
    for (const sp of stockPrices) {
      if (
        obxDateMap.has(sp.date) &&
        fxDateMaps["NOKUSD"]?.has(sp.date) &&
        fxDateMaps["NOKEUR"]?.has(sp.date) &&
        fxDateMaps["NOKGBP"]?.has(sp.date) &&
        fxDateMaps["NOKSEK"]?.has(sp.date)
      ) {
        commonDates.push(sp.date);
      }
    }

    if (commonDates.length < MIN_OBS) continue;

    // Build aligned price arrays
    const stockClose = commonDates.map(d => stockPrices.find(s => s.date === d)!.price);
    const obxClose = commonDates.map(d => obxDateMap.get(d)!);
    const usdClose = commonDates.map(d => fxDateMaps["NOKUSD"].get(d)!);
    const eurClose = commonDates.map(d => fxDateMaps["NOKEUR"].get(d)!);
    const gbpClose = commonDates.map(d => fxDateMaps["NOKGBP"].get(d)!);
    const sekClose = commonDates.map(d => fxDateMaps["NOKSEK"].get(d)!);

    // Calculate log returns
    const toReturns = (prices: number[]): number[] => {
      const ret: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        ret.push(Math.log(prices[i] / prices[i - 1]) * 100);
      }
      return ret;
    };

    const stockRet = toReturns(stockClose);
    const obxRet = toReturns(obxClose);
    const usdRet = toReturns(usdClose);
    const eurRet = toReturns(eurClose);
    const gbpRet = toReturns(gbpClose);
    const sekRet = toReturns(sekClose);

    const returnDates = commonDates.slice(1); // dates after first (no return for first day)
    let tickerInserted = 0;

    for (const windowSize of WINDOW_SIZES) {
      if (stockRet.length < windowSize) continue;

      // Rolling regression with step
      for (let end = windowSize; end <= stockRet.length; end += STEP_SIZE) {
        const start = end - windowSize;
        const windowEnd = returnDates[end - 1];

        const result = multiCurrencyRegression(
          stockRet.slice(start, end),
          obxRet.slice(start, end),
          {
            usd: usdRet.slice(start, end),
            eur: eurRet.slice(start, end),
            gbp: gbpRet.slice(start, end),
            sek: sekRet.slice(start, end),
          },
          windowSize
        );

        if (dryRun) {
          if (tickerInserted === 0) {
            console.log(`  ${ticker}: β_mkt=${result.betaMarket.toFixed(3)}, β_usd=${result.betaUsd.toFixed(3)}, β_eur=${result.betaEur.toFixed(3)}, R²=${result.rSquared.toFixed(3)}`);
          }
          tickerInserted++;
          continue;
        }

        try {
          await pool.query(
            `INSERT INTO fx_regression_results (
              ticker, window_end, window_days,
              beta_market, tstat_market,
              beta_usd, tstat_usd, beta_eur, tstat_eur,
              beta_gbp, tstat_gbp, beta_sek, tstat_sek,
              r_squared, r_squared_fx_only, residual_vol, observations
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
            ON CONFLICT (ticker, window_end, window_days) DO UPDATE SET
              beta_market = EXCLUDED.beta_market, tstat_market = EXCLUDED.tstat_market,
              beta_usd = EXCLUDED.beta_usd, tstat_usd = EXCLUDED.tstat_usd,
              beta_eur = EXCLUDED.beta_eur, tstat_eur = EXCLUDED.tstat_eur,
              beta_gbp = EXCLUDED.beta_gbp, tstat_gbp = EXCLUDED.tstat_gbp,
              beta_sek = EXCLUDED.beta_sek, tstat_sek = EXCLUDED.tstat_sek,
              r_squared = EXCLUDED.r_squared, r_squared_fx_only = EXCLUDED.r_squared_fx_only,
              residual_vol = EXCLUDED.residual_vol, observations = EXCLUDED.observations,
              calculated_at = NOW()`,
            [
              ticker, windowEnd, windowSize,
              result.betaMarket, result.tstatMarket,
              result.betaUsd, result.tstatUsd,
              result.betaEur, result.tstatEur,
              result.betaGbp, result.tstatGbp,
              result.betaSek, result.tstatSek,
              result.rSquared, result.rSquaredFxOnly,
              result.residualVol, result.observations,
            ]
          );
          tickerInserted++;
        } catch (err: any) {
          totalErrors++;
          if (totalErrors <= 5) console.error(`  ${ticker} ${windowEnd}: ${err.message}`);
        }
      }
    }

    if (tickerInserted > 0) {
      totalInserted += tickerInserted;
      if (!dryRun) {
        process.stdout.write(`  ${ticker}: ${tickerInserted} windows\n`);
      }
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  COMPLETE: ${totalInserted} rows, ${totalErrors} errors, ${duration}s`);
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
