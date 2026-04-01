/**
 * Backtest Orderflow Analytics Pipeline
 *
 * Reads synthetic ticks from DB, runs the full analytics stack, and validates
 * that injected patterns are detected correctly.
 *
 * Steps per ticker per day:
 *   1. Aggregate ticks into 1-min, 5-min time bars + volume bars
 *   2. Run BVC classification
 *   3. Compute rolling VPIN
 *   4. Compute Kyle's Lambda
 *   5. Compute cumulative OFI from depth snapshots
 *   6. Run iceberg detector
 *   7. Classify regime
 *   8. Write bars → orderflow_bars
 *   9. Write signals → orderflow_signals
 *  10. Write icebergs → orderflow_iceberg_detections
 *
 * Usage:
 *   pnpm run flow:backtest          — run & insert
 *   DRYRUN=1 pnpm run flow:backtest — run & print only
 */

import { config } from "dotenv";
import { resolve } from "path";
import { Client } from "pg";
import {
  aggregateTimeBars,
  aggregateVolumeBars,
  classifyBarsVolume,
  computeVPIN,
  computeKyleLambda,
  computeOFI,
  computeCumulativeOFI,
  detectIcebergs,
  classifyFlowRegime,
  classifySpreadRegime,
  computeToxicityScore,
  computeFlowFeatures,
  type Tick,
  type DepthSnapshot,
  type FlowBar,
} from "../src/lib/orderflow";

config({ path: resolve(__dirname, "../.env.local") });

const DATABASE_URL = (process.env.DATABASE_URL || "")
  .replace(/['"]/g, "")
  .replace(/[?&]sslmode=\w+/g, "");
const DRY_RUN = process.env.DRYRUN === "1" || process.argv.includes("--dry-run");

const TICKERS = ["EQNR", "DNB", "MOWI", "YAR", "TEL"];

// Expected injections (for validation)
const EXPECTED_INJECTIONS = [
  { ticker: "EQNR", dayIndex: 15, type: "iceberg_buy" },
  { ticker: "DNB", dayIndex: 30, type: "informed_selling" },
  { ticker: "MOWI", dayIndex: 45, type: "high_toxicity" },
];

// ============================================================================
// CONNECTION MANAGEMENT (module-level so all helpers share it)
// ============================================================================

const sslOpt = DATABASE_URL.includes("localhost")
  ? false
  : { rejectUnauthorized: false };
let db: Client;

async function reconnect() {
  try { await db.end(); } catch {}
  db = new Client({ connectionString: DATABASE_URL, ssl: sslOpt });
  db.on("error", () => {});
  await db.connect();
  console.log("  (reconnected)");
}

async function safeQuery(text: string, params?: any[]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.query(text, params);
    } catch (e: any) {
      if (
        e.code === "ETIMEDOUT" ||
        e.code === "ECONNRESET" ||
        e.message?.includes("ETIMEDOUT") ||
        e.message?.includes("Connection terminated")
      ) {
        console.log(`  (connection lost, reconnecting attempt ${attempt + 1}...)`);
        await reconnect();
        continue;
      }
      throw e;
    }
  }
  throw new Error("Failed after 3 reconnection attempts");
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadTicksForDay(
  ticker: string,
  date: string
): Promise<Tick[]> {
  const { rows } = await safeQuery(
    `SELECT ts, price::float, size, side
     FROM orderflow_ticks
     WHERE ticker = $1 AND ts::date = $2::date
     ORDER BY ts ASC`,
    [ticker, date]
  );
  return rows.map((r: any) => ({
    ts: new Date(r.ts),
    price: r.price,
    size: r.size,
    side: r.side || 0,
  }));
}

async function loadDepthForDay(
  ticker: string,
  date: string
): Promise<DepthSnapshot[]> {
  const { rows } = await safeQuery(
    `SELECT ts, bid_prices, bid_sizes, ask_prices, ask_sizes,
            spread_bps::float, mid_price::float, book_imbalance::float
     FROM orderflow_depth_snapshots
     WHERE ticker = $1 AND ts::date = $2::date
     ORDER BY ts ASC`,
    [ticker, date]
  );
  return rows.map((r: any) => ({
    ts: new Date(r.ts),
    bidPrices: r.bid_prices || [],
    bidSizes: r.bid_sizes || [],
    askPrices: r.ask_prices || [],
    askSizes: r.ask_sizes || [],
    spreadBps: r.spread_bps || 0,
    midPrice: r.mid_price || 0,
    bookImbalance: r.book_imbalance || 0,
  }));
}

async function getTradingDays(
  ticker: string
): Promise<string[]> {
  const { rows } = await safeQuery(
    `SELECT DISTINCT ts::date::text AS date
     FROM orderflow_ticks
     WHERE ticker = $1
     ORDER BY date ASC`,
    [ticker]
  );
  return rows.map((r: any) => r.date);
}

async function getADV(ticker: string): Promise<number> {
  const { rows } = await safeQuery(
    `SELECT AVG(daily_vol)::float AS adv FROM (
       SELECT ts::date, SUM(size) AS daily_vol
       FROM orderflow_ticks WHERE ticker = $1
       GROUP BY ts::date
     ) sub`,
    [ticker]
  );
  return rows[0]?.adv || 100000;
}

// ============================================================================
// BAR + SIGNAL INSERTION
// ============================================================================

async function insertBars(ticker: string, bars: FlowBar[]) {
  if (bars.length === 0) return;

  // Batch insert for performance
  const COLS = 19;
  const values: any[] = [];
  const placeholders: string[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const off = i * COLS;
    placeholders.push(
      `(${Array.from({ length: COLS }, (_, j) => `$${off + j + 1}`).join(",")})`
    );
    values.push(
      ticker,
      bar.barType,
      bar.barOpenTs.toISOString(),
      bar.barCloseTs.toISOString(),
      bar.open,
      bar.high,
      bar.low,
      bar.close,
      Math.round(bar.volume),
      bar.turnover || 0,
      Math.round(bar.tradeCount),
      bar.vwap,
      Math.round(bar.buyVolume || 0),
      Math.round(bar.sellVolume || 0),
      bar.ofi || null,
      bar.vpin || null,
      bar.kyleLambda || null,
      bar.spreadMeanBps || null,
      bar.depthImbalanceMean || null,
    );
  }

  await safeQuery(
    `INSERT INTO orderflow_bars
     (ticker, bar_type, bar_open_ts, bar_close_ts, open, high, low, close,
      volume, turnover, trade_count, vwap, buy_volume, sell_volume,
      ofi, vpin, kyle_lambda, spread_mean_bps, depth_imbalance_mean)
     VALUES ${placeholders.join(",")}`,
    values
  );
}

interface SignalRow {
  ticker: string;
  ts: Date;
  vpin50: number;
  vpinPercentile: number;
  kyleLambda60m: number;
  ofiCumulative: number;
  ofi5m: number;
  toxicityScore: number;
  regime: string;
  spreadRegime: string;
}

async function insertSignal(signal: SignalRow) {
  await safeQuery(
    `INSERT INTO orderflow_signals
     (ticker, ts, vpin_50, vpin_percentile, kyle_lambda_60m,
      ofi_cumulative, ofi_5m, toxicity_score, regime, spread_regime)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (ticker, ts) DO UPDATE SET
       vpin_50 = EXCLUDED.vpin_50,
       toxicity_score = EXCLUDED.toxicity_score,
       regime = EXCLUDED.regime`,
    [
      signal.ticker,
      signal.ts.toISOString(),
      signal.vpin50,
      signal.vpinPercentile,
      signal.kyleLambda60m,
      signal.ofiCumulative,
      signal.ofi5m,
      signal.toxicityScore,
      signal.regime,
      signal.spreadRegime,
    ]
  );
}

async function insertIcebergs(
  ticker: string,
  detections: ReturnType<typeof detectIcebergs>
) {
  for (const d of detections) {
    await safeQuery(
      `INSERT INTO orderflow_iceberg_detections
       (ticker, detected_at, start_ts, end_ts, direction, total_volume, trade_count,
        avg_trade_size, median_trade_size, price_range_bps, vwap, est_block_pct,
        detection_method, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        ticker,
        new Date().toISOString(),
        d.startTs.toISOString(),
        d.endTs.toISOString(),
        d.direction,
        Math.round(d.totalVolume),
        Math.round(d.tradeCount),
        d.avgTradeSize,
        Math.round(d.medianTradeSize),
        d.priceRangeBps,
        d.vwap,
        d.estBlockPct,
        d.method,
        d.confidence,
      ]
    );
  }
}

// ============================================================================
// MAIN BACKTEST
// ============================================================================

interface ValidationResult {
  ticker: string;
  dayIndex: number;
  date: string;
  expectedType: string;
  vpinMax: number;
  vpinSpike: boolean;
  icebergsFound: number;
  regimeDetected: string;
  passed: boolean;
}

async function main() {
  console.log(`\n=== ORDERFLOW BACKTEST PIPELINE ===`);
  console.log(`Tickers: ${TICKERS.join(", ")}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  if (!DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  db = new Client({ connectionString: DATABASE_URL, ssl: sslOpt });
  db.on("error", () => {});
  await db.connect();
  console.log("Connected to DB\n");

  // Clean previous backtest results
  if (!DRY_RUN) {
    await safeQuery("DELETE FROM orderflow_bars");
    await safeQuery("DELETE FROM orderflow_signals");
    await safeQuery("DELETE FROM orderflow_iceberg_detections");
    console.log("Cleaned previous backtest data\n");
  }

  const validationResults: ValidationResult[] = [];
  let totalBars = 0;
  let totalSignals = 0;
  let totalIcebergs = 0;

  // Accumulate VPIN history across days for percentile calculation
  const vpinHistory: Record<string, number[]> = {};

  for (const ticker of TICKERS) {
    console.log(`\n--- ${ticker} ---`);
    vpinHistory[ticker] = [];

    const tradingDays = await getTradingDays(ticker);
    if (tradingDays.length === 0) {
      console.log(`  No tick data found, skipping`);
      continue;
    }
    console.log(`  Trading days: ${tradingDays.length}`);

    const adv = await getADV(ticker);
    const vbs = Math.max(1000, Math.round(adv / 50));
    console.log(`  ADV: ${Math.round(adv).toLocaleString()}, VBS: ${vbs.toLocaleString()}`);

    // Baseline stats (will accumulate over first 10 days)
    const spreadHistory: number[] = [];
    const volumeRateHistory: number[] = [];
    const lambdaHistory: number[] = [];

    for (let dayIdx = 0; dayIdx < tradingDays.length; dayIdx++) {
      const date = tradingDays[dayIdx];
      const ticks = await loadTicksForDay(ticker, date);
      const depthSnapshots = await loadDepthForDay(ticker, date);

      if (ticks.length < 10) continue;

      // 1. Aggregate into time bars (1-min and 5-min)
      const bars1m = aggregateTimeBars(ticks, 60_000, "time_1m");
      const bars5m = aggregateTimeBars(ticks, 300_000, "time_5m");
      const volumeBars = aggregateVolumeBars(ticks, vbs);

      // 2. BVC classification
      const classified1m = classifyBarsVolume(bars1m);
      const classified5m = classifyBarsVolume(bars5m);
      const classifiedVol = classifyBarsVolume(volumeBars);

      // 3. VPIN (on volume bars, preferred)
      const vpinBars = classifiedVol.length > 0 ? classifiedVol : classified5m;
      const vpinResult = computeVPIN(vpinBars, vbs, 50, vpinHistory[ticker]);
      vpinHistory[ticker].push(vpinResult.vpin);

      // 4. Kyle's Lambda (on 5-min bars)
      const lambda = computeKyleLambda(classified5m, 12);

      // 5. OFI from depth snapshots
      let ofiCumulative = 0;
      let ofi5m = 0;
      if (depthSnapshots.length > 1) {
        const ofiSeries = computeCumulativeOFI(depthSnapshots);
        ofiCumulative = ofiSeries[ofiSeries.length - 1] || 0;
        // Last ~60 snapshots ≈ 5 min
        const recent = ofiSeries.slice(-60);
        ofi5m = recent.length > 0 ? recent[recent.length - 1] - recent[0] : 0;
      }

      // 6. Iceberg detection
      const icebergs = detectIcebergs(ticks, adv, 60_000, 5);
      for (const ice of icebergs) ice.ticker = ticker;

      // 7. Regime classification
      const baselineReady = dayIdx >= 10;
      const baseline = {
        meanSpreadBps: spreadHistory.length > 0 ? spreadHistory.reduce((a, b) => a + b) / spreadHistory.length : 5,
        stdSpreadBps: stddevCalc(spreadHistory) || 2,
        meanVolumeRate: volumeRateHistory.length > 0 ? volumeRateHistory.reduce((a, b) => a + b) / volumeRateHistory.length : 50,
        stdVolumeRate: stddevCalc(volumeRateHistory) || 20,
        meanLambda: lambdaHistory.length > 0 ? lambdaHistory.reduce((a, b) => a + b) / lambdaHistory.length : 0,
        stdLambda: stddevCalc(lambdaHistory) || 0.001,
      };

      let regime = "neutral";
      let spreadRegime = "normal";
      let toxicity = 0;

      if (baselineReady && classified5m.length > 0) {
        const features = computeFlowFeatures(classified5m, depthSnapshots, baseline);
        regime = classifyFlowRegime(features);
        spreadRegime = classifySpreadRegime(features.spreadZScore);
        const tox = computeToxicityScore(
          features.vpin,
          features.kyleLambdaZScore,
          Math.abs(ofi5m) / (adv * 0.01 || 1),
          features.spreadZScore
        );
        toxicity = tox.score;
      }

      // Update baseline accumulators
      if (depthSnapshots.length > 0) {
        const daySpread = depthSnapshots.reduce((s, d) => s + d.spreadBps, 0) / depthSnapshots.length;
        spreadHistory.push(daySpread);
      }
      if (classified5m.length > 0) {
        volumeRateHistory.push(
          classified5m.reduce((s, b) => s + b.tradeCount, 0) / classified5m.length
        );
      }
      lambdaHistory.push(lambda.lambda);

      // Write results
      if (!DRY_RUN) {
        try { await insertBars(ticker, classified1m); } catch(e:any) { throw new Error(`insertBars(1m) day ${dayIdx}: ${e.message}`); }
        try { await insertBars(ticker, classified5m); } catch(e:any) { throw new Error(`insertBars(5m) day ${dayIdx}: ${e.message}`); }
        try { await insertBars(ticker, classifiedVol); } catch(e:any) { throw new Error(`insertBars(vol) day ${dayIdx}: ${e.message}`); }

        const signalTs = ticks[ticks.length - 1].ts;
        try { await insertSignal({
          ticker,
          ts: signalTs,
          vpin50: vpinResult.vpin,
          vpinPercentile: vpinResult.percentile,
          kyleLambda60m: lambda.lambda,
          ofiCumulative,
          ofi5m,
          toxicityScore: toxicity,
          regime,
          spreadRegime,
        }); } catch(e:any) { throw new Error(`insertSignal day ${dayIdx}: ${e.message}`); }

        if (icebergs.length > 0) {
          try { await insertIcebergs(ticker, icebergs); } catch(e:any) { throw new Error(`insertIcebergs day ${dayIdx}: ${e.message}`); }
        }
      }

      totalBars += classified1m.length + classified5m.length + classifiedVol.length;
      totalSignals += 1;
      totalIcebergs += icebergs.length;

      // Validation check for injection days
      const expected = EXPECTED_INJECTIONS.find(
        (e) => e.ticker === ticker && e.dayIndex === dayIdx
      );
      if (expected) {
        const vpinMax = vpinResult.vpin;
        const vpinSpike = vpinMax > 0.5;
        const regimeInformed = regime.startsWith("informed");

        const passed =
          (expected.type === "iceberg_buy" && icebergs.length > 0) ||
          (expected.type === "informed_selling" && (vpinSpike || regimeInformed)) ||
          (expected.type === "high_toxicity" && (vpinSpike || toxicity > 50));

        validationResults.push({
          ticker,
          dayIndex: dayIdx,
          date,
          expectedType: expected.type,
          vpinMax,
          vpinSpike,
          icebergsFound: icebergs.length,
          regimeDetected: regime,
          passed,
        });

        const icon = passed ? "✓" : "✗";
        console.log(
          `  ${icon} Day ${dayIdx} (${date}): ${expected.type} — VPIN=${vpinMax.toFixed(3)}, icebergs=${icebergs.length}, regime=${regime}`
        );
      }

      // Progress indicator
      if (dayIdx % 10 === 0 && !expected) {
        process.stdout.write(`  Day ${dayIdx}/${tradingDays.length}...\r`);
      }
    }

    console.log(`  Processed ${tradingDays.length} days`);
  }

  // ============================================================================
  // VALIDATION REPORT
  // ============================================================================

  console.log(`\n\n${"=".repeat(60)}`);
  console.log(`BACKTEST SUMMARY`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Total bars written:     ${totalBars.toLocaleString()}`);
  console.log(`Total signals written:  ${totalSignals}`);
  console.log(`Total icebergs found:   ${totalIcebergs}`);
  console.log(`Dry run:                ${DRY_RUN}`);

  console.log(`\n--- INJECTION VALIDATION ---`);
  let allPassed = true;
  for (const v of validationResults) {
    const icon = v.passed ? "✓ PASS" : "✗ FAIL";
    console.log(
      `  ${icon}: ${v.ticker} day ${v.dayIndex} (${v.date})`
    );
    console.log(
      `         Expected: ${v.expectedType}`
    );
    console.log(
      `         VPIN=${v.vpinMax.toFixed(3)} (spike=${v.vpinSpike}), icebergs=${v.icebergsFound}, regime=${v.regimeDetected}`
    );
    if (!v.passed) allPassed = false;
  }

  if (validationResults.length === 0) {
    console.log("  No injection days found in data (need >= 45 days of daily bars)");
  }

  console.log(`\nOverall: ${allPassed ? "ALL VALIDATIONS PASSED" : "SOME VALIDATIONS FAILED"}`);

  // VPIN distribution per ticker
  console.log(`\n--- VPIN DISTRIBUTION ---`);
  for (const ticker of TICKERS) {
    const hist = vpinHistory[ticker];
    if (hist.length === 0) continue;
    const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
    const max = Math.max(...hist);
    const min = Math.min(...hist);
    console.log(
      `  ${ticker}: mean=${avg.toFixed(3)}, min=${min.toFixed(3)}, max=${max.toFixed(3)}, days=${hist.length}`
    );
  }

  await db.end();
  console.log("\nDone.\n");
}

// Helper: standard deviation
function stddevCalc(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
