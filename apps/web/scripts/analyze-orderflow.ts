/**
 * analyze-orderflow.ts — Phase 3 Comprehensive Orderflow Intelligence Report
 *
 * Runs all microstructure models on real tick data and prints a detailed
 * terminal report. Works from tick data alone (no order book required).
 *
 * Models run:
 *   1. Bar aggregation + BVC classification
 *   2. VPIN (informed trading probability)
 *   3. Kyle's Lambda (price impact / information asymmetry)
 *   4. Amihud illiquidity series
 *   5. Trade informativeness (signed volume → future return)
 *   6. Intraday regime sequence
 *   7. TWAP execution windows
 *   8. VWAP execution windows
 *   9. Stealth accumulation/distribution
 *  10. Momentum ignition events
 *  11. Algo fingerprints (round-lot, uniform size, regular intervals, price pinning)
 *  12. Enhanced iceberg detection
 *  13. Rolling OFI proxy (from BVC-classified bars)
 *
 * Usage:
 *   pnpm run flow:analyze                           — EQNR, today
 *   pnpm run flow:analyze -- --ticker EQNR          — specific ticker
 *   pnpm run flow:analyze -- --date 2026-04-01      — specific date
 */

import { config } from "dotenv";
import { resolve } from "path";
import { Pool } from "pg";
import {
  aggregateTimeBars,
  aggregateVolumeBars,
  classifyBarsVolume,
  computeVPIN,
  computeKyleLambda,
  detectIcebergs,
  computeAmihud,
  computeTradeInformativeness,
  detectTWAP,
  detectVWAPExecution,
  detectStealthAccumulation,
  detectMomentumIgnition,
  computeIntradayRegime,
  detectAlgoFingerprints,
  type Tick,
  type FlowBar,
  type IntradayRegime,
} from "../src/lib/orderflow";

config({ path: resolve(__dirname, "../.env.local") });

const DATABASE_URL = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const TICKER = getArg("ticker") || "EQNR";
const DATE   = getArg("date")   || new Date().toISOString().slice(0, 10);

// ── Formatting helpers ──────────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  blue:   "\x1b[34m",
  cyan:   "\x1b[36m",
  white:  "\x1b[37m",
  gray:   "\x1b[90m",
  bgRed:  "\x1b[41m",
  bgGreen:"\x1b[42m",
};

const fmt = {
  num: (n: number, dec = 0) => n.toLocaleString("en", { maximumFractionDigits: dec }),
  pct: (n: number, dec = 1) => (n * 100).toFixed(dec) + "%",
  bps: (n: number, dec = 1) => n.toFixed(dec) + " bps",
  ts:  (d: Date) => d.toLocaleTimeString("no-NO", { timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  conf:(n: number) => {
    const pct = (n * 100).toFixed(0) + "%";
    if (n >= 0.80) return C.green + pct + C.reset;
    if (n >= 0.60) return C.yellow + pct + C.reset;
    return C.gray + pct + C.reset;
  },
  dir: (d: 1 | -1) => d === 1
    ? C.green + "▲ BUY" + C.reset
    : C.red   + "▼ SELL" + C.reset,
  bar: (v: number, max: number, width = 20) => {
    const filled = Math.round((v / Math.max(max, 1)) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
  },
};

function section(title: string) {
  console.log(`\n${C.bold}${C.cyan}${"─".repeat(70)}${C.reset}`);
  console.log(`${C.bold}${C.white}  ${title}${C.reset}`);
  console.log(`${C.cyan}${"─".repeat(70)}${C.reset}`);
}

function subsection(title: string) {
  console.log(`\n${C.bold}${C.yellow}  ▶ ${title}${C.reset}`);
}

// ── Regime colors ───────────────────────────────────────────────────────────

const REGIME_COLOR: Record<IntradayRegime, string> = {
  opening_auction:            C.blue,
  price_discovery:            C.yellow,
  institutional_accumulation: C.green,
  retail_flow:                C.gray,
  closing_pressure:           C.red,
  low_activity:               C.dim,
};

const REGIME_LABEL: Record<IntradayRegime, string> = {
  opening_auction:            "OPEN AUCTION",
  price_discovery:            "PRICE DISC.",
  institutional_accumulation: "INST. ACCUM.",
  retail_flow:                "RETAIL FLOW",
  closing_pressure:           "CLOSE PRESS.",
  low_activity:               "LOW ACTIVITY",
};

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${C.bold}${C.white}${"═".repeat(70)}${C.reset}`);
  console.log(`${C.bold}${C.white}  ORDERFLOW INTELLIGENCE REPORT${C.reset}`);
  console.log(`${C.bold}${C.white}  ${TICKER}  ·  ${DATE}  ·  Oslo Stock Exchange${C.reset}`);
  console.log(`${C.bold}${C.white}${"═".repeat(70)}${C.reset}`);

  if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

  const db = new Pool({ connectionString: DATABASE_URL });

  // ── Load ticks ────────────────────────────────────────────────────────────
  console.log(`\n${C.dim}Loading ticks from DB...${C.reset}`);

  const { rows: rawTicks } = await db.query<{
    ts: Date; price: string; size: number; side: number;
  }>(
    `SELECT ts, price::text, size, COALESCE(side, 0) as side
     FROM orderflow_ticks
     WHERE ticker = $1
       AND ts BETWEEN $2::timestamptz AND ($2::date + interval '1 day')::timestamptz
     ORDER BY ts ASC`,
    [TICKER, DATE]
  );

  if (rawTicks.length === 0) {
    console.error(`\nNo tick data found for ${TICKER} on ${DATE}`);
    console.error("Run: pnpm run flow:fetch -- --ticker EQNR --date " + DATE);
    await db.end();
    process.exit(1);
  }

  const ticks: Tick[] = rawTicks.map(r => ({
    ts:    new Date(r.ts),
    price: parseFloat(r.price),
    size:  r.size,
    side:  r.side,
  }));

  const sessionStartTs = ticks[0].ts;
  const sessionEndTs   = ticks[ticks.length - 1].ts;
  const sessionMins    = (sessionEndTs.getTime() - sessionStartTs.getTime()) / 60_000;

  console.log(`  Loaded ${C.bold}${fmt.num(ticks.length)}${C.reset} ticks  ·  ` +
    `${fmt.ts(sessionStartTs)} → ${fmt.ts(sessionEndTs)}  ·  ${sessionMins.toFixed(0)} min`);

  // ── Session stats ─────────────────────────────────────────────────────────
  const totalVol   = ticks.reduce((s, t) => s + t.size, 0);
  const turnover   = ticks.reduce((s, t) => s + t.price * t.size, 0);
  const sessionVwap = totalVol > 0 ? turnover / totalVol : 0;
  const priceOpen  = ticks[0].price;
  const priceClose = ticks[ticks.length - 1].price;
  const priceHigh  = Math.max(...ticks.map(t => t.price));
  const priceLow   = Math.min(...ticks.map(t => t.price));
  const returnBps  = priceOpen > 0 ? ((priceClose - priceOpen) / priceOpen) * 10000 : 0;

  const buys    = ticks.filter(t => t.side === 1).length;
  const sells   = ticks.filter(t => t.side === -1).length;
  const unknown = ticks.filter(t => t.side === 0).length;

  section("SESSION OVERVIEW");
  console.log(`  Open   ${C.bold}${priceOpen.toFixed(2)}${C.reset}    High  ${C.green}${priceHigh.toFixed(2)}${C.reset}    Low   ${C.red}${priceLow.toFixed(2)}${C.reset}    Close ${C.bold}${priceClose.toFixed(2)}${C.reset}`);
  console.log(`  VWAP   ${C.bold}${sessionVwap.toFixed(2)}${C.reset}    Return ${returnBps >= 0 ? C.green : C.red}${returnBps.toFixed(1)} bps${C.reset}`);
  console.log(`  Volume ${C.bold}${fmt.num(totalVol)}${C.reset} shares    Turnover NOK ${C.bold}${fmt.num(turnover / 1e6, 1)}M${C.reset}`);
  console.log(`  Trades ${C.bold}${fmt.num(ticks.length)}${C.reset}    ${C.green}Buy ${buys}${C.reset} / ${C.red}Sell ${sells}${C.reset} / ${C.dim}Unknown ${unknown}${C.reset}`);
  console.log(`  Avg size ${C.bold}${(totalVol / ticks.length).toFixed(0)}${C.reset} shares/trade`);

  // Size distribution
  subsection("Trade size distribution");
  const sizeBuckets = [
    { label: "1",        min: 1,    max: 1    },
    { label: "2-9",      min: 2,    max: 9    },
    { label: "10-49",    min: 10,   max: 49   },
    { label: "50-99",    min: 50,   max: 99   },
    { label: "100-499",  min: 100,  max: 499  },
    { label: "500-999",  min: 500,  max: 999  },
    { label: "1000+",    min: 1000, max: Infinity },
  ];
  const maxBucketVol = Math.max(...sizeBuckets.map(b =>
    ticks.filter(t => t.size >= b.min && t.size <= b.max).reduce((s, t) => s + t.size, 0)
  ));
  for (const b of sizeBuckets) {
    const bTicks = ticks.filter(t => t.size >= b.min && t.size <= b.max);
    const bVol = bTicks.reduce((s, t) => s + t.size, 0);
    const bPct = totalVol > 0 ? bVol / totalVol : 0;
    console.log(
      `    ${b.label.padEnd(8)} ${fmt.bar(bVol, maxBucketVol, 25)} ` +
      `${fmt.num(bTicks.length).padStart(5)} trades  ${fmt.num(bVol).padStart(8)} shares  ${(bPct * 100).toFixed(1).padStart(5)}%`
    );
  }

  // ── Bar aggregation ───────────────────────────────────────────────────────
  section("BAR AGGREGATION + BVC CLASSIFICATION");

  const bars1m  = classifyBarsVolume(aggregateTimeBars(ticks, 60_000,   "time_1m"));
  const bars5m  = classifyBarsVolume(aggregateTimeBars(ticks, 300_000,  "time_5m"));
  const adv     = totalVol; // single day — use today's volume as proxy
  const vbs     = Math.max(500, Math.round(adv / 50));
  const barsVol = classifyBarsVolume(aggregateVolumeBars(ticks, vbs));

  console.log(`  1-min bars:   ${C.bold}${bars1m.length}${C.reset}`);
  console.log(`  5-min bars:   ${C.bold}${bars5m.length}${C.reset}`);
  console.log(`  Volume bars:  ${C.bold}${barsVol.length}${C.reset}  (VBS = ${fmt.num(vbs)} shares)`);

  // 5-min OHLCV table
  subsection("5-min OHLCV bars");
  console.log(`  ${"Time".padEnd(8)} ${"Open".padStart(7)} ${"High".padStart(7)} ${"Low".padStart(7)} ${"Close".padStart(7)} ${"Vol".padStart(9)} ${"Trades".padStart(7)} ${"Buy%".padStart(6)} ${"VWAP".padStart(7)}`);
  for (const b of bars5m) {
    const buyPct  = (b.buyVolume + b.sellVolume) > 0
      ? b.buyVolume / (b.buyVolume + b.sellVolume)
      : 0.5;
    const chg = b.close - b.open;
    const chgColor = chg >= 0 ? C.green : C.red;
    console.log(
      `  ${fmt.ts(b.barOpenTs).padEnd(8)} ` +
      `${b.open.toFixed(2).padStart(7)} ` +
      `${C.green}${b.high.toFixed(2).padStart(7)}${C.reset} ` +
      `${C.red}${b.low.toFixed(2).padStart(7)}${C.reset} ` +
      `${chgColor}${b.close.toFixed(2).padStart(7)}${C.reset} ` +
      `${fmt.num(b.volume).padStart(9)} ` +
      `${String(b.tradeCount).padStart(7)} ` +
      `${(buyPct * 100).toFixed(0).padStart(5)}% ` +
      `${b.vwap.toFixed(2).padStart(7)}`
    );
  }

  // ── VPIN ─────────────────────────────────────────────────────────────────
  section("VPIN — PROBABILITY OF INFORMED TRADING");

  const vpinResult = computeVPIN(barsVol, vbs, 50);
  const vpinColor  = vpinResult.vpin > 0.7 ? C.red
    : vpinResult.vpin > 0.5 ? C.yellow : C.green;

  console.log(`  VPIN:       ${vpinColor}${C.bold}${(vpinResult.vpin * 100).toFixed(1)}%${C.reset}  (regime: ${vpinColor}${vpinResult.regime.toUpperCase()}${C.reset})`);
  console.log(`  Buckets:    ${vpinResult.bucketImbalances.length} volume buckets  (VBS = ${fmt.num(vbs)})`);
  console.log(`  Imbalance:  min ${(Math.min(...vpinResult.bucketImbalances) * 100).toFixed(1)}%  ` +
    `max ${(Math.max(...vpinResult.bucketImbalances) * 100).toFixed(1)}%  ` +
    `mean ${(vpinResult.vpin * 100).toFixed(1)}%`);

  // Per-5min rolling VPIN
  subsection("Rolling VPIN (per 5-min window)");
  let vpinHist: number[] = [];
  for (let i = 0; i < bars5m.length; i++) {
    const windowBars = barsVol.slice(0, Math.floor((i + 1) * barsVol.length / bars5m.length));
    const r = computeVPIN(windowBars, vbs, 20, vpinHist);
    vpinHist.push(r.vpin);
    const bar5 = bars5m[i];
    const vpinPct = (r.vpin * 100).toFixed(1);
    const color   = r.vpin > 0.7 ? C.red : r.vpin > 0.5 ? C.yellow : C.green;
    console.log(
      `  ${fmt.ts(bar5.barOpenTs)}  VPIN ${color}${vpinPct.padStart(5)}%${C.reset}  ` +
      `${fmt.bar(r.vpin, 1.0, 20)}  ${color}${r.regime.toUpperCase()}${C.reset}`
    );
  }

  // ── Kyle's Lambda ─────────────────────────────────────────────────────────
  section("KYLE'S LAMBDA — PRICE IMPACT & INFORMATION ASYMMETRY");

  const lambda60m = computeKyleLambda(bars5m, 12);
  const lambda30m = computeKyleLambda(bars5m, 6);
  const lambdaAll = computeKyleLambda(bars5m, bars5m.length);

  console.log(`  Lambda (full session): ${C.bold}${lambdaAll.lambda.toExponential(3)}${C.reset}  t=${lambdaAll.tStat.toFixed(2)}  R²=${(lambdaAll.r2 * 100).toFixed(1)}%`);
  console.log(`  Lambda (last 60 min):  ${C.bold}${lambda60m.lambda.toExponential(3)}${C.reset}  t=${lambda60m.tStat.toFixed(2)}  R²=${(lambda60m.r2 * 100).toFixed(1)}%`);
  console.log(`  Lambda (last 30 min):  ${C.bold}${lambda30m.lambda.toExponential(3)}${C.reset}  t=${lambda30m.tStat.toFixed(2)}  R²=${(lambda30m.r2 * 100).toFixed(1)}%`);
  console.log(`\n  ${C.dim}Interpretation: λ = NOK price move per unit of signed volume imbalance.${C.reset}`);
  console.log(`  ${C.dim}Higher λ = less liquid market, larger price impact per trade.${C.reset}`);

  if (Math.abs(lambda60m.tStat) > 2.0) {
    const dir = lambda60m.lambda > 0 ? "POSITIVE — buy pressure moving price up" : "NEGATIVE — sell pressure moving price down";
    console.log(`\n  ${C.yellow}⚠  Lambda is statistically significant (|t|=${Math.abs(lambda60m.tStat).toFixed(2)} > 2).${C.reset}`);
    console.log(`     Direction: ${dir}`);
  }

  // ── Amihud Illiquidity ────────────────────────────────────────────────────
  section("AMIHUD ILLIQUIDITY — PRICE IMPACT PER UNIT VOLUME");

  const amihudBars = computeAmihud(bars1m, 20);
  const liquidBars  = amihudBars.filter(a => a.illiquidityRegime === "liquid").length;
  const illiqBars   = amihudBars.filter(a => a.illiquidityRegime === "illiquid").length;
  const crisisBars  = amihudBars.filter(a => a.illiquidityRegime === "crisis").length;

  const amihudVals  = amihudBars.map(a => a.amihud);
  const amihudMean  = amihudVals.reduce((a, b) => a + b, 0) / Math.max(amihudVals.length, 1);

  console.log(`  Mean Amihud: ${C.bold}${amihudMean.toFixed(4)}${C.reset}`);
  console.log(`  Liquid bars (low impact):   ${C.green}${liquidBars}${C.reset} / ${amihudBars.length}`);
  console.log(`  Illiquid bars (high impact):${C.yellow}${illiqBars}${C.reset} / ${amihudBars.length}`);
  console.log(`  Crisis bars (extreme):      ${C.red}${crisisBars}${C.reset} / ${amihudBars.length}`);

  if (crisisBars > 0 || illiqBars > 3) {
    subsection("High-impact bars (Amihud crisis/illiquid)");
    const flagged = amihudBars
      .filter(a => a.illiquidityRegime === "crisis" || a.illiquidityRegime === "illiquid")
      .sort((a, b) => b.amihud - a.amihud)
      .slice(0, 10);
    for (const a of flagged) {
      const color = a.illiquidityRegime === "crisis" ? C.red : C.yellow;
      console.log(
        `  ${fmt.ts(a.ts)}  ${color}${a.illiquidityRegime.toUpperCase().padEnd(9)}${C.reset}  ` +
        `return ${a.returnBps >= 0 ? C.green : C.red}${a.returnBps.toFixed(1)} bps${C.reset}  ` +
        `vol ${fmt.num(a.volume).padStart(8)}  Amihud ${a.amihud.toFixed(4)}`
      );
    }
  }

  // ── Trade Informativeness ─────────────────────────────────────────────────
  section("TRADE INFORMATIVENESS — SIGNED FLOW PREDICTING FUTURE RETURNS");

  const infoResults = computeTradeInformativeness(bars1m, 5);
  const informative  = infoResults.filter(r => r.informative).length;
  const infoRate     = infoResults.length > 0 ? informative / infoResults.length : 0;

  const infoColor = infoRate > 0.60 ? C.green : infoRate > 0.50 ? C.yellow : C.red;
  console.log(`  Informativeness rate: ${infoColor}${C.bold}${(infoRate * 100).toFixed(1)}%${C.reset} ` +
    `(${informative}/${infoResults.length} windows — 5-min horizon)`);
  console.log(`  ${C.dim}> 60% = order flow has predictive value for short-term price moves${C.reset}`);
  console.log(`  ${C.dim}~50% = random / no information content${C.reset}`);

  // Strongest signals
  if (infoResults.length > 0) {
    const strong = infoResults
      .filter(r => Math.abs(r.signedVolumeImbalance) > 0.2)
      .sort((a, b) => Math.abs(b.signedVolumeImbalance) - Math.abs(a.signedVolumeImbalance))
      .slice(0, 5);
    if (strong.length > 0) {
      subsection("Strongest signed imbalance windows");
      for (const r of strong) {
        const imb   = r.signedVolumeImbalance;
        const imbColor = imb > 0 ? C.green : C.red;
        const retColor = r.futureReturnBps >= 0 ? C.green : C.red;
        const correct  = r.informative ? C.green + "✓" + C.reset : C.red + "✗" + C.reset;
        console.log(
          `  ${fmt.ts(r.windowStartTs)}  imbalance ${imbColor}${(imb * 100).toFixed(1).padStart(6)}%${C.reset}  ` +
          `→ +5min return ${retColor}${r.futureReturnBps.toFixed(1)} bps${C.reset}  ${correct}`
        );
      }
    }
  }

  // ── Intraday Regime Sequence ──────────────────────────────────────────────
  section("INTRADAY REGIME SEQUENCE");

  const regimeWindows = computeIntradayRegime(bars1m, sessionStartTs, sessionEndTs);

  // Compress consecutive same-regime bars
  const regimeBlocks: { regime: IntradayRegime; startTs: Date; endTs: Date; count: number }[] = [];
  for (const rw of regimeWindows) {
    const last = regimeBlocks[regimeBlocks.length - 1];
    if (last && last.regime === rw.regime) {
      last.endTs = rw.endTs;
      last.count++;
    } else {
      regimeBlocks.push({ regime: rw.regime, startTs: rw.startTs, endTs: rw.endTs, count: 1 });
    }
  }

  // Regime distribution
  const regimeDist: Partial<Record<IntradayRegime, number>> = {};
  for (const rw of regimeWindows) {
    regimeDist[rw.regime] = (regimeDist[rw.regime] || 0) + 1;
  }

  console.log(`  Dominant regime: ${C.bold}${
    Object.entries(regimeDist).sort((a, b) => b[1] - a[1])[0]?.[0].replace(/_/g, " ").toUpperCase()
  }${C.reset}`);
  for (const [regime, count] of Object.entries(regimeDist).sort((a, b) => b[1] - a[1])) {
    const color = REGIME_COLOR[regime as IntradayRegime] || C.white;
    const label = REGIME_LABEL[regime as IntradayRegime] || regime;
    const pct = regimeWindows.length > 0 ? count / regimeWindows.length : 0;
    console.log(
      `    ${color}${label.padEnd(16)}${C.reset}  ` +
      `${fmt.bar(pct, 1.0, 25)}  ${(pct * 100).toFixed(1)}%  (${count} bars)`
    );
  }

  subsection("Regime timeline");
  for (const block of regimeBlocks) {
    const color = REGIME_COLOR[block.regime] || C.white;
    const label = REGIME_LABEL[block.regime] || block.regime;
    const durationMin = (block.endTs.getTime() - block.startTs.getTime()) / 60_000;
    console.log(
      `  ${fmt.ts(block.startTs)} → ${fmt.ts(block.endTs)}  ` +
      `${color}${label.padEnd(16)}${C.reset}  ${durationMin.toFixed(0).padStart(3)} min`
    );
  }

  // ── TWAP Detection ────────────────────────────────────────────────────────
  section("TWAP EXECUTION WINDOWS");

  const twapWindows = detectTWAP(bars1m, 4, 0.40);
  if (twapWindows.length === 0) {
    console.log(`  ${C.dim}No TWAP execution windows detected.${C.reset}`);
  } else {
    console.log(`  ${C.bold}${twapWindows.length} TWAP window(s) detected${C.reset}\n`);
    for (const w of twapWindows.sort((a, b) => b.confidence - a.confidence)) {
      const durationMin = (w.endTs.getTime() - w.startTs.getTime()) / 60_000;
      console.log(
        `  ${fmt.ts(w.startTs)} → ${fmt.ts(w.endTs)}  ${fmt.dir(w.direction)}  conf ${fmt.conf(w.confidence)}`
      );
      console.log(
        `    Slices: ${w.sliceCount}  Avg vol/slice: ${fmt.num(w.avgSliceVolume, 0)}  ` +
        `Vol CV: ${(w.sliceVolumeCV * 100).toFixed(1)}%  Duration: ${durationMin.toFixed(0)} min`
      );
      console.log(
        `    Total vol: ${fmt.num(w.totalVolume)}  VWAP: ${w.vwap.toFixed(2)}  ` +
        `Interval: ${(w.avgSliceIntervalMs / 1000).toFixed(0)}s avg`
      );
    }
  }

  // ── VWAP Execution ────────────────────────────────────────────────────────
  section("VWAP EXECUTION WINDOWS");

  const vwapWindows = detectVWAPExecution(bars1m, 6, 30);
  if (vwapWindows.length === 0) {
    console.log(`  ${C.dim}No VWAP execution windows detected.${C.reset}`);
  } else {
    console.log(`  ${C.bold}${vwapWindows.length} VWAP execution window(s)${C.reset}\n`);
    for (const w of vwapWindows.sort((a, b) => b.confidence - a.confidence)) {
      const durationMin = (w.endTs.getTime() - w.startTs.getTime()) / 60_000;
      console.log(
        `  ${fmt.ts(w.startTs)} → ${fmt.ts(w.endTs)}  ${fmt.dir(w.direction)}  conf ${fmt.conf(w.confidence)}`
      );
      console.log(
        `    VWAP dev: ${w.vwapDevBps.toFixed(1)} bps  Price range: ${w.priceRangeBps.toFixed(1)} bps  ` +
        `Duration: ${durationMin.toFixed(0)} min  Vol: ${fmt.num(w.cumulativeVolume)}`
      );
    }
  }

  // ── Stealth Accumulation ──────────────────────────────────────────────────
  section("STEALTH ACCUMULATION / DISTRIBUTION");

  const stealthEvents = detectStealthAccumulation(ticks, bars1m, adv, 30 * 60_000, 2.0, 100);
  if (stealthEvents.length === 0) {
    console.log(`  ${C.dim}No stealth accumulation/distribution detected.${C.reset}`);
  } else {
    console.log(`  ${C.bold}${stealthEvents.length} stealth event(s) detected${C.reset}\n`);
    for (const e of stealthEvents.sort((a, b) => b.confidence - a.confidence)) {
      const durationMin = (e.endTs.getTime() - e.startTs.getTime()) / 60_000;
      console.log(
        `  ${fmt.ts(e.startTs)} → ${fmt.ts(e.endTs)}  ${fmt.dir(e.direction)}  conf ${fmt.conf(e.confidence)}`
      );
      console.log(
        `    Volume: ${fmt.num(e.totalVolume)} (${e.pctAdv.toFixed(1)}% ADV)  ` +
        `Price range: ${e.priceRangeBps.toFixed(1)} bps  Amihud: ${e.amihudRatio.toFixed(4)}`
      );
      console.log(
        `    Trades: ${e.tradeCount}  Avg size: ${e.avgTradeSize.toFixed(0)}  ` +
        `Duration: ${durationMin.toFixed(0)} min  Peak vol at: ${fmt.ts(e.peakVolumeWindowTs)}`
      );
    }
  }

  // ── Momentum Ignition ─────────────────────────────────────────────────────
  section("MOMENTUM IGNITION EVENTS");

  const ignitionEvents = detectMomentumIgnition(bars1m, 20, 3);
  if (ignitionEvents.length === 0) {
    console.log(`  ${C.dim}No momentum ignition events detected.${C.reset}`);
  } else {
    console.log(`  ${C.bold}${ignitionEvents.length} potential ignition event(s)${C.reset}\n`);
    for (const e of ignitionEvents.sort((a, b) => b.confidence - a.confidence)) {
      console.log(
        `  ${fmt.ts(e.startTs)} → ${fmt.ts(e.endTs)}  ${fmt.dir(e.direction)}  conf ${fmt.conf(e.confidence)}`
      );
      console.log(
        `    Price move: ${C.bold}${e.priceMoveBps.toFixed(1)} bps${C.reset}  ` +
        `Volume: ${fmt.num(e.volumeInWindow)} (${e.tradeCount} trades)  ` +
        `vs prior: ${e.volumeVsPriorBps.toFixed(0)} bps`
      );
    }
  }

  // ── Algo Fingerprints ─────────────────────────────────────────────────────
  section("ALGORITHMIC TRADING FINGERPRINTS");

  const algoFingerprints = detectAlgoFingerprints(ticks, 30_000);
  const fpByPattern: Record<string, typeof algoFingerprints> = {};
  for (const fp of algoFingerprints) {
    (fpByPattern[fp.pattern] ||= []).push(fp);
  }

  if (algoFingerprints.length === 0) {
    console.log(`  ${C.dim}No algorithmic fingerprints detected.${C.reset}`);
  } else {
    console.log(`  ${C.bold}${algoFingerprints.length} fingerprint(s) detected${C.reset} across ${Object.keys(fpByPattern).length} pattern type(s)\n`);

    const PATTERN_DESC: Record<string, string> = {
      round_lot_clustering: "Round-lot clustering — algos preferring 100/500/1000 share units",
      size_uniformity:      "Size uniformity — iceberg orders sliced to equal child sizes",
      regular_intervals:    "Regular time intervals — TWAP / scheduled execution",
      price_pinning:        "Price pinning — repeated prints at same price (iceberg refill)",
    };

    for (const [pattern, fps] of Object.entries(fpByPattern)) {
      console.log(`  ${C.yellow}${PATTERN_DESC[pattern] || pattern}${C.reset}  (${fps.length} events)`);
      const topFps = fps.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
      for (const fp of topFps) {
        console.log(
          `    ${fmt.ts(fp.ts)}  conf ${fmt.conf(fp.confidence)}  ` +
          `${fp.tradeCount} trades  dom size ${fmt.num(fp.dominantSize)}  ` +
          `vol ${fmt.num(fp.totalVolume)}  range ${fp.priceRangeBps.toFixed(1)} bps`
        );
      }
      if (fps.length > 5) {
        console.log(`    ${C.dim}... and ${fps.length - 5} more${C.reset}`);
      }
      console.log();
    }
  }

  // ── Iceberg Detection ─────────────────────────────────────────────────────
  section("ICEBERG / FRAGMENTED BLOCK TRADE DETECTION");

  const icebergs = detectIcebergs(ticks, adv, 60_000, 5);
  if (icebergs.length === 0) {
    console.log(`  ${C.dim}No iceberg patterns detected.${C.reset}`);
  } else {
    console.log(`  ${C.bold}${icebergs.length} iceberg event(s) detected${C.reset}\n`);
    const sorted = icebergs.sort((a, b) => b.confidence - a.confidence);
    for (const ice of sorted.slice(0, 15)) {
      const durationMs = ice.endTs.getTime() - ice.startTs.getTime();
      console.log(
        `  ${fmt.ts(ice.startTs)} → ${fmt.ts(ice.endTs)}  ${fmt.dir(ice.direction)}  conf ${fmt.conf(ice.confidence)}`
      );
      console.log(
        `    Trades: ${ice.tradeCount}  Total vol: ${fmt.num(ice.totalVolume)}  ` +
        `(${ice.estBlockPct.toFixed(1)}% ADV)  VWAP: ${ice.vwap.toFixed(2)}`
      );
      console.log(
        `    Avg size: ${ice.avgTradeSize.toFixed(0)}  Median: ${ice.medianTradeSize}  ` +
        `Price range: ${ice.priceRangeBps.toFixed(1)} bps  Duration: ${(durationMs / 1000).toFixed(0)}s`
      );
    }
    if (sorted.length > 15) {
      console.log(`\n  ${C.dim}... and ${sorted.length - 15} more (lower confidence)${C.reset}`);
    }

    // Summary by direction
    const buyIce  = icebergs.filter(i => i.direction === 1);
    const sellIce = icebergs.filter(i => i.direction === -1);
    const buyVol  = buyIce.reduce((s, i) => s + i.totalVolume, 0);
    const sellVol = sellIce.reduce((s, i) => s + i.totalVolume, 0);
    subsection("Iceberg summary");
    console.log(`  Buy  icebergs: ${C.green}${buyIce.length}${C.reset}  vol ${C.green}${fmt.num(buyVol)}${C.reset}  (${(buyVol / totalVol * 100).toFixed(1)}% of total)`);
    console.log(`  Sell icebergs: ${C.red}${sellIce.length}${C.reset}  vol ${C.red}${fmt.num(sellVol)}${C.reset}  (${(sellVol / totalVol * 100).toFixed(1)}% of total)`);
  }

  // ── Rolling OFI Proxy ─────────────────────────────────────────────────────
  section("ORDER FLOW IMBALANCE (OFI PROXY FROM BVC)");
  console.log(`  ${C.dim}Without live order book, OFI is approximated from BVC-classified bars.${C.reset}`);
  console.log(`  ${C.dim}Positive = net buy pressure, Negative = net sell pressure.${C.reset}\n`);

  let cumOfi = 0;
  for (const b of bars5m) {
    const ofi = (b.buyVolume || 0) - (b.sellVolume || 0);
    cumOfi += ofi;
    const barColor = ofi >= 0 ? C.green : C.red;
    const cumColor = cumOfi >= 0 ? C.green : C.red;
    const barWidth = Math.min(20, Math.round(Math.abs(ofi) / Math.max(totalVol / bars5m.length / 20, 1)));
    const barStr = ofi >= 0
      ? " ".repeat(20) + C.green + "█".repeat(barWidth) + C.reset
      : C.red + "█".repeat(barWidth) + C.reset + " ".repeat(20 - barWidth);
    console.log(
      `  ${fmt.ts(b.barOpenTs)}  ${barStr}  ` +
      `${barColor}${ofi >= 0 ? "+" : ""}${fmt.num(ofi).padStart(8)}${C.reset}  ` +
      `cum ${cumColor}${cumOfi >= 0 ? "+" : ""}${fmt.num(cumOfi).padStart(10)}${C.reset}`
    );
  }

  // ── Final Intelligence Summary ────────────────────────────────────────────
  section("INTELLIGENCE SUMMARY");

  const netOfi = bars5m.reduce((s, b) => s + (b.buyVolume || 0) - (b.sellVolume || 0), 0);
  const netOfiPct = totalVol > 0 ? netOfi / totalVol : 0;
  const dominated = Math.abs(netOfiPct) > 0.05;
  const buyDominated = netOfiPct > 0;

  const highConfIcebergs = icebergs.filter(i => i.confidence >= 0.65);
  const buyIceVol  = highConfIcebergs.filter(i => i.direction === 1).reduce((s, i) => s + i.totalVolume, 0);
  const sellIceVol = highConfIcebergs.filter(i => i.direction === -1).reduce((s, i) => s + i.totalVolume, 0);

  console.log(`\n  ${C.bold}VPIN:${C.reset}             ${vpinResult.vpin > 0.7 ? C.red : vpinResult.vpin > 0.5 ? C.yellow : C.green}${(vpinResult.vpin * 100).toFixed(1)}% — ${vpinResult.regime.toUpperCase()}${C.reset}`);
  console.log(`  ${C.bold}Informed trading:${C.reset} ${infoColor}${(infoRate * 100).toFixed(1)}% of signed flow is predictive${C.reset}`);
  console.log(`  ${C.bold}Net OFI:${C.reset}          ${netOfi >= 0 ? C.green : C.red}${netOfi >= 0 ? "+" : ""}${(netOfiPct * 100).toFixed(1)}% (${netOfi >= 0 ? "net buying" : "net selling"} pressure)${C.reset}`);
  console.log(`  ${C.bold}Icebergs:${C.reset}         ${icebergs.length} detected  buy ${C.green}${fmt.num(buyIceVol)}${C.reset}  sell ${C.red}${fmt.num(sellIceVol)}${C.reset}`);
  console.log(`  ${C.bold}TWAP windows:${C.reset}     ${twapWindows.length}`);
  console.log(`  ${C.bold}Stealth events:${C.reset}   ${stealthEvents.length}`);
  console.log(`  ${C.bold}Ignition events:${C.reset}  ${ignitionEvents.length}`);
  console.log(`  ${C.bold}Algo fingerprints:${C.reset}${algoFingerprints.length} (${Object.keys(fpByPattern).join(", ")})`);

  console.log(`\n  ${C.bold}${C.white}── CONCLUSION ──${C.reset}`);

  if (vpinResult.vpin > 0.7) {
    console.log(`  ${C.red}⚠  HIGH VPIN: Elevated probability of informed trading. Adverse selection risk.${C.reset}`);
  }
  if (dominated) {
    console.log(`  ${buyDominated ? C.green : C.red}●  ${buyDominated ? "NET BUY" : "NET SELL"} PRESSURE: Sustained ${buyDominated ? "buying" : "selling"} imbalance throughout session.${C.reset}`);
  }
  if (buyIceVol > sellIceVol * 1.5) {
    console.log(`  ${C.green}●  HIDDEN BUYERS: Buy icebergs ${(buyIceVol / Math.max(sellIceVol, 1)).toFixed(1)}× larger than sell icebergs.${C.reset}`);
  } else if (sellIceVol > buyIceVol * 1.5) {
    console.log(`  ${C.red}●  HIDDEN SELLERS: Sell icebergs ${(sellIceVol / Math.max(buyIceVol, 1)).toFixed(1)}× larger than buy icebergs.${C.reset}`);
  }
  if (twapWindows.length > 0) {
    const dir = twapWindows[0].direction === 1 ? "buying" : "selling";
    console.log(`  ${C.yellow}●  INSTITUTIONAL ALGO: TWAP execution detected — systematic ${dir} program.${C.reset}`);
  }
  if (stealthEvents.length > 0) {
    const buyStl = stealthEvents.filter(e => e.direction === 1).length;
    const sellStl = stealthEvents.filter(e => e.direction === -1).length;
    if (buyStl > sellStl) {
      console.log(`  ${C.green}●  STEALTH ACCUMULATION: ${buyStl} window(s) of large volume with minimal price impact.${C.reset}`);
    } else {
      console.log(`  ${C.red}●  STEALTH DISTRIBUTION: ${sellStl} window(s) of large volume with minimal price impact.${C.reset}`);
    }
  }
  if (ignitionEvents.length > 0) {
    console.log(`  ${C.yellow}⚠  MOMENTUM IGNITION: ${ignitionEvents.length} event(s) of outsized price move on low volume.${C.reset}`);
  }
  if (infoRate < 0.50) {
    console.log(`  ${C.dim}●  LOW INFORMATIVENESS: Order flow imbalance not predictive — likely noise/retail-driven session.${C.reset}`);
  }

  console.log(`\n${C.bold}${C.white}${"═".repeat(70)}${C.reset}\n`);

  await db.end();
}

main().catch(e => {
  console.error(`${C.red}FATAL: ${e.message}${C.reset}`);
  console.error(e.stack);
  process.exit(1);
});
