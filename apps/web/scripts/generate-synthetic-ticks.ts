/**
 * Generate Synthetic Intraday Ticks from Daily OHLCV
 *
 * Creates realistic intraday tick + depth data for backtesting orderflow analytics.
 * Uses Brownian bridge interpolation and U-shaped volume profile.
 *
 * Injects known patterns for validation:
 *   Day 15: Iceberg buy on EQNR (uniform sizes, same direction, clustered)
 *   Day 30: Informed selling on DNB (VPIN should spike >0.7)
 *   Day 45: High-toxicity on MOWI (rapid drop + high volume)
 *
 * Usage:
 *   pnpm run flow:generate          — generate & insert
 *   DRYRUN=1 pnpm run flow:generate — generate & print stats only
 */

import { config } from "dotenv";
import { resolve } from "path";
import { Client } from "pg";

config({ path: resolve(__dirname, "../.env.local") });

const DATABASE_URL = (process.env.DATABASE_URL || "")
  .replace(/['"]/g, "")
  .replace(/[?&]sslmode=\w+/g, "")
  .replace(":6543/", ":5432/");
const DRY_RUN = process.env.DRYRUN === "1" || process.argv.includes("--dry-run");

const TICKERS = ["EQNR", "DNB", "MOWI", "YAR", "TEL"];
const DAYS = 60;
const TRADES_PER_DAY = 500; // ~500 trades/ticker/day is typical for OSE liquid names

// Oslo Børs market hours (minutes from midnight CET)
const MARKET_OPEN_MIN = 9 * 60;        // 09:00
const MARKET_CLOSE_MIN = 16 * 60 + 20; // 16:20
const SESSION_MINUTES = MARKET_CLOSE_MIN - MARKET_OPEN_MIN; // 440 min

// ============================================================================
// RANDOM GENERATORS
// ============================================================================

/** Box-Muller transform for normal random numbers */
function randn(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Log-normal random with given median and sigma */
function randLogNormal(medianVal: number, sigma: number): number {
  const mu = Math.log(medianVal);
  return Math.exp(mu + sigma * randn());
}

/** U-shaped intraday volume profile (higher at open/close, lower midday) */
function volumeProfile(minuteOfDay: number): number {
  // Normalize to [0, 1] within session
  const t = (minuteOfDay - MARKET_OPEN_MIN) / SESSION_MINUTES;
  // Bathtub curve: high at 0 and 1, low at 0.5
  return 1.0 + 1.5 * (4 * (t - 0.5) ** 2);
}

// ============================================================================
// BROWNIAN BRIDGE
// ============================================================================

/**
 * Generate a price path from open → close, constrained to touch high and low.
 * Uses a Brownian bridge with forced extremes.
 */
function generatePricePath(
  open: number,
  high: number,
  low: number,
  close: number,
  nSteps: number
): number[] {
  if (nSteps <= 1) return [open];

  const path: number[] = [open];
  const range = high - low;
  const stepSize = range > 0 ? range / Math.sqrt(nSteps) * 0.3 : open * 0.001;

  // Decide when high and low are hit (roughly)
  const highStep = Math.floor(Math.random() * nSteps * 0.4) + 1;
  const lowStep = Math.min(
    nSteps - 1,
    highStep + Math.floor(Math.random() * nSteps * 0.4) + 1
  );

  for (let i = 1; i < nSteps; i++) {
    let target: number;
    if (i <= highStep) {
      // Bridge: open → high
      const progress = i / highStep;
      target = open + (high - open) * progress;
    } else if (i <= lowStep) {
      // Bridge: high → low
      const progress = (i - highStep) / (lowStep - highStep);
      target = high + (low - high) * progress;
    } else {
      // Bridge: low → close
      const progress = (i - lowStep) / (nSteps - 1 - lowStep);
      target = low + (close - low) * progress;
    }

    // Add noise
    const noise = randn() * stepSize * 0.5;
    let price = target + noise;

    // Clamp to [low, high]
    price = Math.max(low, Math.min(high, price));
    path.push(Math.round(price * 10000) / 10000);
  }

  // Force last point = close
  path[path.length - 1] = close;
  return path;
}

// ============================================================================
// INJECTION PATTERNS
// ============================================================================

interface InjectionConfig {
  ticker: string;
  dayIndex: number;
  type: "iceberg_buy" | "informed_selling" | "high_toxicity";
}

const INJECTIONS: InjectionConfig[] = [
  { ticker: "EQNR", dayIndex: 15, type: "iceberg_buy" },
  { ticker: "DNB", dayIndex: 30, type: "informed_selling" },
  { ticker: "MOWI", dayIndex: 45, type: "high_toxicity" },
];

interface SyntheticTick {
  ticker: string;
  ts: Date;
  price: number;
  size: number;
  side: number; // 1=buy, -1=sell, 0=unknown
}

interface SyntheticDepth {
  ticker: string;
  ts: Date;
  bidPrices: number[];
  bidSizes: number[];
  bidOrders: number[];
  askPrices: number[];
  askSizes: number[];
  askOrders: number[];
  spreadBps: number;
  midPrice: number;
  bookImbalance: number;
}

function injectIcebergBuy(
  basePrice: number,
  baseDate: Date,
  ticker: string
): { ticks: SyntheticTick[]; depths: SyntheticDepth[] } {
  // 50 trades, uniform 200-share sizes, all buys, within 90 seconds
  // Starting at 10:30
  const startMin = 10 * 60 + 30;
  const ticks: SyntheticTick[] = [];
  const depths: SyntheticDepth[] = [];

  let price = basePrice;
  for (let i = 0; i < 50; i++) {
    const offsetSec = Math.floor((i / 50) * 90) + Math.floor(Math.random() * 2);
    const ts = new Date(baseDate);
    ts.setHours(0, 0, 0, 0);
    ts.setMinutes(startMin, offsetSec, Math.floor(Math.random() * 1000));

    // Small price drift upward (minimal impact = iceberg signature)
    price += (Math.random() - 0.3) * 0.05;
    price = Math.round(price * 100) / 100;

    ticks.push({
      ticker,
      ts,
      price,
      size: 200 + Math.floor(Math.random() * 20) - 10, // ~200 ± 10 (low CV)
      side: 1, // all buys
    });
  }

  return { ticks, depths };
}

function injectInformedSelling(
  basePrice: number,
  baseDate: Date,
  ticker: string
): { ticks: SyntheticTick[]; depths: SyntheticDepth[] } {
  // Heavy directional selling over 2 hours (11:00-13:00)
  // Large sells mixed with small buys → high VPIN
  const ticks: SyntheticTick[] = [];
  const depths: SyntheticDepth[] = [];

  let price = basePrice;
  for (let i = 0; i < 200; i++) {
    const offsetMin = Math.floor((i / 200) * 120);
    const ts = new Date(baseDate);
    ts.setHours(0, 0, 0, 0);
    ts.setMinutes(11 * 60 + offsetMin, Math.floor(Math.random() * 60), Math.floor(Math.random() * 1000));

    const isSell = Math.random() < 0.8; // 80% sells
    const size = isSell
      ? Math.floor(randLogNormal(800, 0.3)) // Large sells
      : Math.floor(randLogNormal(100, 0.5)); // Small buys

    price += isSell ? -Math.random() * 0.15 : Math.random() * 0.05;
    price = Math.round(Math.max(price * 0.95, price) * 100) / 100;

    ticks.push({
      ticker,
      ts,
      price,
      size,
      side: isSell ? -1 : 1,
    });
  }

  return { ticks, depths };
}

function injectHighToxicity(
  basePrice: number,
  baseDate: Date,
  ticker: string
): { ticks: SyntheticTick[]; depths: SyntheticDepth[] } {
  // Sudden price drop with very high volume in 15 minutes (14:00-14:15)
  const ticks: SyntheticTick[] = [];
  const depths: SyntheticDepth[] = [];

  let price = basePrice;
  for (let i = 0; i < 150; i++) {
    const offsetSec = Math.floor((i / 150) * 900); // 15 min = 900 sec
    const ts = new Date(baseDate);
    ts.setHours(0, 0, 0, 0);
    ts.setMinutes(14 * 60, offsetSec, Math.floor(Math.random() * 1000));

    const isSell = Math.random() < 0.85;
    const size = Math.floor(randLogNormal(1500, 0.5)); // Very large trades
    price -= Math.random() * 0.3 * (isSell ? 1 : -0.3);
    price = Math.round(Math.max(basePrice * 0.92, price) * 100) / 100;

    ticks.push({
      ticker,
      ts,
      price,
      size,
      side: isSell ? -1 : 1,
    });
  }

  return { ticks, depths };
}

// ============================================================================
// MAIN GENERATION
// ============================================================================

function generateDepthFromPrice(
  ticker: string,
  ts: Date,
  midPrice: number,
  spreadBps: number,
  imbalanceBias: number // -1 to 1
): SyntheticDepth {
  const halfSpread = (midPrice * spreadBps) / 20000;
  const bid1 = Math.round((midPrice - halfSpread) * 100) / 100;
  const ask1 = Math.round((midPrice + halfSpread) * 100) / 100;

  const bidPrices: number[] = [];
  const bidSizes: number[] = [];
  const bidOrders: number[] = [];
  const askPrices: number[] = [];
  const askSizes: number[] = [];
  const askOrders: number[] = [];

  for (let level = 0; level < 5; level++) {
    const tickSize = midPrice > 100 ? 0.5 : midPrice > 10 ? 0.1 : 0.01;
    bidPrices.push(Math.round((bid1 - level * tickSize) * 100) / 100);
    askPrices.push(Math.round((ask1 + level * tickSize) * 100) / 100);

    const baseSize = Math.floor(randLogNormal(500, 0.5));
    const biasMultiplier = 1 + imbalanceBias * 0.3 * (level === 0 ? 1 : 0.5);
    bidSizes.push(Math.max(100, Math.floor(baseSize * Math.max(0.3, biasMultiplier))));
    askSizes.push(Math.max(100, Math.floor(baseSize * Math.max(0.3, 2 - biasMultiplier))));
    bidOrders.push(Math.floor(Math.random() * 10) + 1);
    askOrders.push(Math.floor(Math.random() * 10) + 1);
  }

  const totalBid = bidSizes.slice(0, 3).reduce((a, b) => a + b, 0);
  const totalAsk = askSizes.slice(0, 3).reduce((a, b) => a + b, 0);
  const bookImbalance =
    totalBid + totalAsk > 0 ? (totalBid - totalAsk) / (totalBid + totalAsk) : 0;

  return {
    ticker,
    ts,
    bidPrices,
    bidSizes,
    bidOrders,
    askPrices,
    askSizes,
    askOrders,
    spreadBps: Math.round(spreadBps * 100) / 100,
    midPrice: Math.round(midPrice * 10000) / 10000,
    bookImbalance: Math.round(bookImbalance * 10000) / 10000,
  };
}

async function fetchDailyBars(
  db: Client,
  ticker: string,
  days: number
): Promise<{ date: string; open: number; high: number; low: number; close: number; volume: number }[]> {
  const { rows } = await db.query(
    `SELECT date::text, open::float, high::float, low::float,
            COALESCE(adj_close, close)::float AS close, volume::int
     FROM prices_daily
     WHERE upper(ticker) = upper($1) AND close > 0
     ORDER BY date DESC LIMIT $2`,
    [ticker, days]
  );
  return rows.reverse();
}

async function main() {
  console.log(`\n=== SYNTHETIC TICK GENERATOR ===`);
  console.log(`Tickers: ${TICKERS.join(", ")}`);
  console.log(`Days: ${DAYS}`);
  console.log(`Trades/day: ~${TRADES_PER_DAY}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  if (!DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const db = new Client({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  await db.connect();
  console.log("Connected to DB\n");

  // Ensure tables exist
  const sqlFile = require("fs").readFileSync(
    resolve(__dirname, "../../../packages/db/src/schema/021_orderflow_tables.sql"),
    "utf8"
  );
  await db.query(sqlFile);
  console.log("Tables verified/created\n");

  let totalTicks = 0;
  let totalDepths = 0;

  for (const ticker of TICKERS) {
    console.log(`\n--- ${ticker} ---`);

    const dailyBars = await fetchDailyBars(db, ticker, DAYS);
    if (dailyBars.length === 0) {
      console.log(`  No daily data found for ${ticker}, skipping`);
      continue;
    }
    console.log(`  Found ${dailyBars.length} daily bars`);

    const adv = Math.round(
      dailyBars.reduce((sum, b) => sum + b.volume, 0) / dailyBars.length
    );
    console.log(`  ADV: ${adv.toLocaleString()}`);

    // Check for injections on this ticker
    const injection = INJECTIONS.find((inj) => inj.ticker === ticker);

    for (let dayIdx = 0; dayIdx < dailyBars.length; dayIdx++) {
      const bar = dailyBars[dayIdx];
      const baseDate = new Date(bar.date + "T00:00:00+01:00"); // CET

      // Generate ticks
      const pricePath = generatePricePath(
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        TRADES_PER_DAY
      );

      const allTicks: SyntheticTick[] = [];
      const allDepths: SyntheticDepth[] = [];

      // Distribute trades across the session using volume profile
      const weights: number[] = [];
      for (let i = 0; i < TRADES_PER_DAY; i++) {
        const minuteOfDay =
          MARKET_OPEN_MIN + (i / TRADES_PER_DAY) * SESSION_MINUTES;
        weights.push(volumeProfile(minuteOfDay));
      }
      const totalWeight = weights.reduce((a, b) => a + b, 0);

      let cumulativeMinute = MARKET_OPEN_MIN;
      for (let i = 0; i < TRADES_PER_DAY; i++) {
        const minuteGap = (weights[i] / totalWeight) * SESSION_MINUTES;
        cumulativeMinute = MARKET_OPEN_MIN + (i / TRADES_PER_DAY) * SESSION_MINUTES;

        const ts = new Date(baseDate);
        const mins = Math.floor(cumulativeMinute);
        const secs = Math.floor((cumulativeMinute - mins) * 60);
        ts.setHours(Math.floor(mins / 60), mins % 60, secs, Math.floor(Math.random() * 1000));

        const size = Math.max(1, Math.floor(randLogNormal(500, 0.6)));
        const side = Math.random() < 0.5 ? 1 : -1; // Random for normal days

        allTicks.push({
          ticker,
          ts,
          price: pricePath[i],
          size,
          side,
        });

        // Generate depth snapshot every ~5 ticks
        if (i % 5 === 0) {
          const spreadBps = 3 + Math.random() * 4; // 3-7 bps typical for liquid OSE
          const imbalanceBias = (Math.random() - 0.5) * 0.6;
          allDepths.push(
            generateDepthFromPrice(ticker, ts, pricePath[i], spreadBps, imbalanceBias)
          );
        }
      }

      // Inject patterns if this is a target day
      if (injection && dayIdx === injection.dayIndex && dayIdx < dailyBars.length) {
        let injected: { ticks: SyntheticTick[]; depths: SyntheticDepth[] };

        switch (injection.type) {
          case "iceberg_buy":
            injected = injectIcebergBuy(bar.close, baseDate, ticker);
            console.log(`  ** INJECTED iceberg_buy on day ${dayIdx} (${bar.date})`);
            break;
          case "informed_selling":
            injected = injectInformedSelling(bar.close, baseDate, ticker);
            console.log(`  ** INJECTED informed_selling on day ${dayIdx} (${bar.date})`);
            break;
          case "high_toxicity":
            injected = injectHighToxicity(bar.close, baseDate, ticker);
            console.log(`  ** INJECTED high_toxicity on day ${dayIdx} (${bar.date})`);
            break;
        }

        allTicks.push(...injected!.ticks);
        allTicks.sort((a, b) => a.ts.getTime() - b.ts.getTime());
      }

      totalTicks += allTicks.length;
      totalDepths += allDepths.length;

      if (!DRY_RUN) {
        // Batch insert ticks
        if (allTicks.length > 0) {
          const tickValues: string[] = [];
          const tickParams: any[] = [];
          let paramIdx = 1;

          for (const t of allTicks) {
            tickValues.push(
              `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
            );
            tickParams.push(t.ticker, t.ts.toISOString(), t.price, t.size, t.side);
          }

          await db.query(
            `INSERT INTO orderflow_ticks (ticker, ts, price, size, side)
             VALUES ${tickValues.join(", ")}`,
            tickParams
          );
        }

        // Batch insert depths
        if (allDepths.length > 0) {
          const depthValues: string[] = [];
          const depthParams: any[] = [];
          let paramIdx = 1;

          for (const d of allDepths) {
            depthValues.push(
              `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
            );
            depthParams.push(
              d.ticker,
              d.ts.toISOString(),
              JSON.stringify(d.bidPrices),
              JSON.stringify(d.bidSizes),
              JSON.stringify(d.bidOrders),
              JSON.stringify(d.askPrices),
              JSON.stringify(d.askSizes),
              JSON.stringify(d.askOrders),
              d.spreadBps,
              d.midPrice,
              d.bookImbalance
            );
          }

          await db.query(
            `INSERT INTO orderflow_depth_snapshots
             (ticker, ts, bid_prices, bid_sizes, bid_orders, ask_prices, ask_sizes, ask_orders, spread_bps, mid_price, book_imbalance)
             VALUES ${depthValues.join(", ")}`,
            depthParams
          );
        }
      }
    }

    console.log(`  Generated ${dailyBars.length} days of data`);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total ticks: ${totalTicks.toLocaleString()}`);
  console.log(`Total depth snapshots: ${totalDepths.toLocaleString()}`);
  console.log(`Dry run: ${DRY_RUN}`);

  await db.end();
  console.log("Done.\n");
}

main().catch((e) => {
  console.error("FATAL:", e.message || e);
  console.error(e.stack || e);
  process.exit(1);
});
