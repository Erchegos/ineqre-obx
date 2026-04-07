/**
 * Order Flow Intelligence — Microstructure Analytics Engine
 *
 * Implements:
 * - VPIN (Easley, López de Prado, O'Hara 2010/2012)
 * - Kyle's Lambda (Kyle 1985)
 * - OFI — Order Flow Imbalance (Cont, Kukanov, Stoikov 2014)
 * - Bulk Volume Classification (Easley et al. 2012)
 * - Iceberg / fragmented block detection (time-clustering)
 * - Intraday regime classification (rule-based)
 *
 * All functions operate on typed arrays — no DB dependency.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface Tick {
  ts: Date;
  price: number;
  size: number;
  side?: number; // 1=buy, -1=sell, 0=unknown
}

export interface DepthSnapshot {
  ts: Date;
  bidPrices: number[]; // [best_bid, ..., 5th_level]
  bidSizes: number[];
  askPrices: number[];
  askSizes: number[];
  spreadBps: number;
  midPrice: number;
  bookImbalance: number; // (bid_vol - ask_vol) / (bid_vol + ask_vol)
}

export interface FlowBar {
  ticker?: string;
  barType: string;
  barOpenTs: Date;
  barCloseTs: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
  vwap: number;
  buyVolume: number;
  sellVolume: number;
  turnover?: number;
  ofi?: number;
  spreadMeanBps?: number;
  depthImbalanceMean?: number;
}

export interface VPINResult {
  vpin: number;
  percentile: number;
  bucketImbalances: number[];
  volumeBucketSize: number;
  regime: "low" | "normal" | "elevated" | "extreme";
}

export interface KyleLambdaResult {
  lambda: number;
  tStat: number;
  r2: number;
  intercept: number;
  nObs: number;
}

export interface IcebergDetection {
  ticker: string;
  startTs: Date;
  endTs: Date;
  direction: 1 | -1;
  totalVolume: number;
  tradeCount: number;
  avgTradeSize: number;
  medianTradeSize: number;
  priceRangeBps: number;
  vwap: number;
  estBlockPct: number; // % of ADV
  method: "clustering" | "size_anomaly" | "book_reload" | "ml";
  confidence: number; // 0-1
}

export type FlowRegime =
  | "informed_buying"
  | "informed_selling"
  | "market_making"
  | "retail"
  | "neutral";

export type SpreadRegime = "tight" | "normal" | "wide" | "crisis";

export interface FlowFeatureVector {
  vpin: number;
  spreadZScore: number;
  volumeRateZScore: number;
  bookImbalancePersistence: number;
  tradeSizeEntropy: number;
  kyleLambdaZScore: number;
  ofiMomentum: number; // ofi_5m / ofi_30m
}

export interface ToxicityResult {
  score: number; // 0-100
  components: {
    vpinContribution: number;
    lambdaContribution: number;
    spreadContribution: number;
    ofiContribution: number;
  };
}

// ============================================================================
// MATH HELPERS
// ============================================================================

/**
 * Standard normal CDF — Abramowitz & Stegun approximation
 */
export function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const prob =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - prob : prob;
}

/**
 * Shannon entropy of a discrete distribution
 */
function shannonEntropy(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let entropy = 0;
  for (const c of counts) {
    if (c > 0) {
      const p = c / total;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

/**
 * Simple OLS regression: y = α + β×x
 * Returns { slope, intercept, r2, tStat, nObs }
 */
function simpleOLS(
  x: number[],
  y: number[]
): {
  slope: number;
  intercept: number;
  r2: number;
  tStat: number;
  nObs: number;
} {
  const n = Math.min(x.length, y.length);
  if (n < 3) return { slope: 0, intercept: 0, r2: 0, tStat: 0, nObs: n };

  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
    sxx += x[i] * x[i];
    sxy += x[i] * y[i];
    syy += y[i] * y[i];
  }

  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-15)
    return { slope: 0, intercept: 0, r2: 0, tStat: 0, nObs: n };

  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;

  // R²
  const yMean = sy / n;
  let ssTot = 0,
    ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yHat = intercept + slope * x[i];
    ssRes += (y[i] - yHat) ** 2;
    ssTot += (y[i] - yMean) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // t-statistic for slope
  const sigmaSquared = ssRes / (n - 2);
  const seSlope = Math.sqrt(sigmaSquared / (sxx - (sx * sx) / n));
  const tStat = seSlope > 0 ? slope / seSlope : 0;

  return { slope, intercept, r2, tStat, nObs: n };
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance =
    arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function coefficientOfVariation(arr: number[]): number {
  const m = mean(arr);
  if (Math.abs(m) < 1e-10) return 0;
  return stddev(arr) / Math.abs(m);
}

// ============================================================================
// BULK VOLUME CLASSIFICATION (BVC)
// ============================================================================

/**
 * BVC — Easley, López de Prado, O'Hara (2012)
 *
 * Classifies volume into buy/sell without quote-level data.
 * Uses the price change within a bar and rolling volatility.
 *
 * @param deltaP - Price change (close - open) of the bar
 * @param sigma - Rolling bar volatility (std of price changes over N trailing bars)
 * @param totalVolume - Total volume in the bar
 * @returns { buyVolume, sellVolume }
 */
export function classifyBulkVolume(
  deltaP: number,
  sigma: number,
  totalVolume: number
): { buyVolume: number; sellVolume: number } {
  const z = sigma > 0 ? deltaP / sigma : 0;
  const buyFraction = normalCDF(z);
  const buyVolume = Math.round(totalVolume * buyFraction);
  const sellVolume = Math.round(totalVolume - buyVolume);
  return { buyVolume, sellVolume };
}

/**
 * Apply BVC to an array of bars.
 * Computes rolling sigma from the trailing `sigmaWindow` bars.
 */
export function classifyBarsVolume(
  bars: FlowBar[],
  sigmaWindow: number = 20
): FlowBar[] {
  const priceChanges: number[] = [];
  const result: FlowBar[] = [];

  for (let i = 0; i < bars.length; i++) {
    const deltaP = bars[i].close - bars[i].open;
    priceChanges.push(deltaP);

    const window = priceChanges.slice(
      Math.max(0, priceChanges.length - sigmaWindow)
    );
    const sigma = stddev(window);

    const { buyVolume, sellVolume } = classifyBulkVolume(
      deltaP,
      sigma,
      bars[i].volume
    );

    result.push({
      ...bars[i],
      buyVolume,
      sellVolume,
    });
  }
  return result;
}

// ============================================================================
// VPIN — Volume-Synchronized Probability of Informed Trading
// ============================================================================

/**
 * VPIN — Easley, López de Prado, O'Hara (2010)
 *
 * 1. Divide volume into N equal-sized buckets (VBS = ADV / 50)
 * 2. Within each bucket, classify buy/sell using BVC
 * 3. Bucket imbalance = |V_buy - V_sell| / VBS
 * 4. VPIN = rolling mean of imbalance over last `lookbackBuckets` buckets
 *
 * @param bars - FlowBars with buyVolume/sellVolume already classified
 * @param volumeBucketSize - VBS (typically ADV / 50)
 * @param lookbackBuckets - Number of buckets for rolling VPIN (default 50)
 * @param vpinHistory - Optional array of historical daily VPIN values for percentile
 */
export function computeVPIN(
  bars: FlowBar[],
  volumeBucketSize: number,
  lookbackBuckets: number = 50,
  vpinHistory?: number[]
): VPINResult {
  if (bars.length === 0 || volumeBucketSize <= 0) {
    return {
      vpin: 0,
      percentile: 50,
      bucketImbalances: [],
      volumeBucketSize,
      regime: "normal",
    };
  }

  // Build volume buckets from classified bars
  const bucketImbalances: number[] = [];
  let currentBucketBuy = 0;
  let currentBucketSell = 0;
  let currentBucketVolume = 0;

  for (const bar of bars) {
    let remainBuy = bar.buyVolume;
    let remainSell = bar.sellVolume;

    while (remainBuy + remainSell > 0) {
      const spaceLeft = volumeBucketSize - currentBucketVolume;
      const canFill = Math.min(remainBuy + remainSell, spaceLeft);

      if (canFill <= 0) break;

      // Proportionally split buy/sell
      const totalRemain = remainBuy + remainSell;
      const buyPortion = Math.round(canFill * (remainBuy / totalRemain));
      const sellPortion = canFill - buyPortion;

      currentBucketBuy += buyPortion;
      currentBucketSell += sellPortion;
      currentBucketVolume += canFill;
      remainBuy -= buyPortion;
      remainSell -= sellPortion;

      // Bucket full?
      if (currentBucketVolume >= volumeBucketSize) {
        const imbalance =
          Math.abs(currentBucketBuy - currentBucketSell) / volumeBucketSize;
        bucketImbalances.push(imbalance);
        currentBucketBuy = 0;
        currentBucketSell = 0;
        currentBucketVolume = 0;
      }
    }
  }

  // VPIN = mean of last N bucket imbalances
  const recentBuckets = bucketImbalances.slice(-lookbackBuckets);
  const vpin = recentBuckets.length > 0 ? mean(recentBuckets) : 0;

  // Percentile vs history
  let percentile = 50;
  if (vpinHistory && vpinHistory.length > 0) {
    const below = vpinHistory.filter((v) => v <= vpin).length;
    percentile = (below / vpinHistory.length) * 100;
  }

  // Regime
  let regime: VPINResult["regime"] = "normal";
  if (vpin > 0.85) regime = "extreme";
  else if (vpin > 0.7) regime = "elevated";
  else if (vpin > 0.3) regime = "normal";
  else regime = "low";

  return { vpin, percentile, bucketImbalances, volumeBucketSize, regime };
}

// ============================================================================
// KYLE'S LAMBDA — Price Impact Coefficient
// ============================================================================

/**
 * Kyle's Lambda — Kyle (1985)
 *
 * Regression: ΔP_t = α + λ × SignedVolume_t + ε_t
 *
 * Higher λ = more information asymmetry, less liquidity.
 *
 * @param bars - FlowBars with buyVolume/sellVolume classified
 * @param windowBars - Number of bars for rolling window (default 12 = 60 min if 5-min bars)
 */
export function computeKyleLambda(
  bars: FlowBar[],
  windowBars: number = 12
): KyleLambdaResult {
  const n = Math.min(bars.length, windowBars);
  if (n < 5)
    return { lambda: 0, tStat: 0, r2: 0, intercept: 0, nObs: n };

  const recentBars = bars.slice(-n);
  const priceChanges: number[] = [];
  const signedVolumes: number[] = [];

  for (let i = 1; i < recentBars.length; i++) {
    priceChanges.push(recentBars[i].close - recentBars[i - 1].close);
    signedVolumes.push(
      recentBars[i].buyVolume - recentBars[i].sellVolume
    );
  }

  const result = simpleOLS(signedVolumes, priceChanges);

  return {
    lambda: result.slope,
    tStat: result.tStat,
    r2: result.r2,
    intercept: result.intercept,
    nObs: result.nObs,
  };
}

// ============================================================================
// OFI — Order Flow Imbalance
// ============================================================================

/**
 * OFI — Cont, Kukanov, Stoikov (2014)
 *
 * Measures net pressure on the orderbook from quote updates.
 * Uses top-of-book only (simplified version).
 *
 * Positive OFI = net buying pressure
 * Negative OFI = net selling pressure
 * OFI diverging from price = hidden institutional flow
 */
export function computeOFI(
  current: DepthSnapshot,
  previous: DepthSnapshot
): number {
  if (
    !current.bidPrices?.length ||
    !previous.bidPrices?.length ||
    !current.askPrices?.length ||
    !previous.askPrices?.length
  ) {
    return 0;
  }

  const bidPrice = current.bidPrices[0];
  const prevBidPrice = previous.bidPrices[0];
  const bidSize = current.bidSizes[0];
  const prevBidSize = previous.bidSizes[0];

  const askPrice = current.askPrices[0];
  const prevAskPrice = previous.askPrices[0];
  const askSize = current.askSizes[0];
  const prevAskSize = previous.askSizes[0];

  let ofi = 0;

  // Bid side contribution
  if (bidPrice >= prevBidPrice) {
    ofi += bidSize;
  }
  if (bidPrice <= prevBidPrice) {
    ofi -= prevBidSize;
  }

  // Ask side contribution
  if (askPrice <= prevAskPrice) {
    ofi -= askSize;
  }
  if (askPrice >= prevAskPrice) {
    ofi += prevAskSize;
  }

  return ofi;
}

/**
 * Compute cumulative OFI from a series of depth snapshots.
 */
export function computeCumulativeOFI(snapshots: DepthSnapshot[]): number[] {
  const ofiSeries: number[] = [0];
  let cumOfi = 0;
  for (let i = 1; i < snapshots.length; i++) {
    cumOfi += computeOFI(snapshots[i], snapshots[i - 1]);
    ofiSeries.push(cumOfi);
  }
  return ofiSeries;
}

// ============================================================================
// ICEBERG / FRAGMENTED BLOCK DETECTION
// ============================================================================

/**
 * Detect iceberg/fragmented block trades using time-clustering.
 *
 * Groups trades by (direction, time_window) and flags clusters where:
 * - Total volume > 3× median cluster volume (baseline)
 * - Trade sizes are suspiciously uniform (low CV)
 * - Inter-trade intervals are regular (low CV)
 * - Price impact is small relative to volume
 *
 * @param ticks - Tick data for a single ticker, single day
 * @param adv - Average daily volume (for % ADV calculation)
 * @param clusterWindowMs - Time window for grouping trades (default 60s)
 * @param minTrades - Minimum trades to form a cluster (default 5)
 */
export function detectIcebergs(
  ticks: Tick[],
  adv: number,
  clusterWindowMs: number = 60_000,
  minTrades: number = 5,
  minVolume: number = 10_000  // absolute minimum shares — filters noise/tiny prints
): IcebergDetection[] {
  if (ticks.length < minTrades) return [];

  const detections: IcebergDetection[] = [];

  // Group ticks into directional clusters (same side within time window)
  const clusters = clusterTrades(ticks, clusterWindowMs);

  // Compute baseline statistics from all clusters
  const clusterVolumes = clusters.map((c) =>
    c.reduce((sum, t) => sum + t.size, 0)
  );
  const medianClusterVol = median(clusterVolumes);
  const volumeThreshold = Math.max(medianClusterVol * 3, adv * 0.005); // At least 0.5% ADV

  for (const cluster of clusters) {
    if (cluster.length < minTrades) continue;

    const totalVolume = cluster.reduce((sum, t) => sum + t.size, 0);
    if (totalVolume < volumeThreshold) continue;
    if (totalVolume < minVolume) continue; // hard floor — skip tiny clusters

    const sizes = cluster.map((t) => t.size);
    const sizeCV = coefficientOfVariation(sizes);

    // Compute inter-trade time gaps
    const gaps: number[] = [];
    for (let i = 1; i < cluster.length; i++) {
      gaps.push(cluster[i].ts.getTime() - cluster[i - 1].ts.getTime());
    }
    const timeCV = gaps.length > 0 ? coefficientOfVariation(gaps) : 1;

    // Determine direction (majority side)
    const buys = cluster.filter((t) => t.side === 1).length;
    const sells = cluster.filter((t) => t.side === -1).length;
    const direction: 1 | -1 = buys >= sells ? 1 : -1;

    // Price impact
    const firstPrice = cluster[0].price;
    const lastPrice = cluster[cluster.length - 1].price;
    const midPrice = (firstPrice + lastPrice) / 2;
    const priceRangeBps =
      midPrice > 0
        ? (Math.abs(lastPrice - firstPrice) / midPrice) * 10000
        : 0;

    // VWAP
    let volumeWeightedSum = 0;
    for (const t of cluster) volumeWeightedSum += t.price * t.size;
    const vwapValue = totalVolume > 0 ? volumeWeightedSum / totalVolume : 0;

    // Confidence scoring
    let confidence = 0;

    // Low size CV = uniform order sizes = iceberg signature
    if (sizeCV < 0.3) confidence += 0.35;
    else if (sizeCV < 0.5) confidence += 0.2;

    // Low time CV = regular intervals = algo execution
    if (timeCV < 0.4) confidence += 0.25;
    else if (timeCV < 0.6) confidence += 0.15;

    // Large volume relative to ADV
    const pctAdv = adv > 0 ? (totalVolume / adv) * 100 : 0;
    if (pctAdv > 5) confidence += 0.25;
    else if (pctAdv > 2) confidence += 0.2;
    else if (pctAdv > 1) confidence += 0.1;

    // Low price impact relative to volume = hidden execution
    const expectedImpactBps = Math.sqrt(pctAdv) * 5; // rough heuristic
    if (priceRangeBps < expectedImpactBps * 0.5) confidence += 0.15;

    confidence = Math.min(confidence, 1);

    if (confidence >= 0.3) {
      detections.push({
        ticker: "",
        startTs: cluster[0].ts,
        endTs: cluster[cluster.length - 1].ts,
        direction,
        totalVolume,
        tradeCount: cluster.length,
        avgTradeSize: mean(sizes),
        medianTradeSize: median(sizes),
        priceRangeBps,
        vwap: vwapValue,
        estBlockPct: pctAdv,
        method: "clustering",
        confidence,
      });
    }
  }

  return detections;
}

/**
 * Group ticks into clusters based on time proximity and direction.
 */
function clusterTrades(ticks: Tick[], windowMs: number): Tick[][] {
  if (ticks.length === 0) return [];

  const clusters: Tick[][] = [];
  let current: Tick[] = [ticks[0]];

  for (let i = 1; i < ticks.length; i++) {
    const timeDiff = ticks[i].ts.getTime() - ticks[i - 1].ts.getTime();
    const sameDirection =
      ticks[i].side !== undefined &&
      ticks[i - 1].side !== undefined &&
      ticks[i].side === ticks[i - 1].side;

    if (timeDiff <= windowMs && (sameDirection || ticks[i].side === 0)) {
      current.push(ticks[i]);
    } else {
      if (current.length >= 2) clusters.push(current);
      current = [ticks[i]];
    }
  }
  if (current.length >= 2) clusters.push(current);

  return clusters;
}

// ============================================================================
// REGIME CLASSIFICATION
// ============================================================================

/**
 * Classify intraday microstructure regime.
 *
 * 5 regimes based on a feature vector computed every 5 minutes:
 * - INFORMED_BUYING:  High VPIN + positive OFI + elevated Lambda or spread
 * - INFORMED_SELLING: High VPIN + negative OFI + elevated Lambda or spread
 * - MARKET_MAKING:    Low VPIN + tight spread + high trade size entropy
 * - RETAIL:           Normal VPIN + normal volume + high size entropy + low Lambda
 * - NEUTRAL:          Everything else
 */
export function classifyFlowRegime(features: FlowFeatureVector): FlowRegime {
  const { vpin, spreadZScore, volumeRateZScore, tradeSizeEntropy, kyleLambdaZScore, ofiMomentum } = features;

  // Informed buying: high toxicity + positive OFI + stressed conditions
  if (
    vpin > 0.65 &&
    ofiMomentum > 0.3 &&
    (kyleLambdaZScore > 1.0 || spreadZScore > 1.0)
  ) {
    return "informed_buying";
  }

  // Informed selling: high toxicity + negative OFI + stressed conditions
  if (
    vpin > 0.65 &&
    ofiMomentum < -0.3 &&
    (kyleLambdaZScore > 1.0 || spreadZScore > 1.0)
  ) {
    return "informed_selling";
  }

  // Market making: low toxicity + tight spread + diverse order sizes
  if (vpin < 0.35 && spreadZScore < -0.5 && tradeSizeEntropy > 3.0) {
    return "market_making";
  }

  // Retail: moderate VPIN + normal conditions + high entropy + low impact
  if (
    vpin >= 0.35 &&
    vpin <= 0.55 &&
    Math.abs(volumeRateZScore) < 1.0 &&
    tradeSizeEntropy > 2.5 &&
    kyleLambdaZScore < 0.5
  ) {
    return "retail";
  }

  return "neutral";
}

/**
 * Classify spread regime based on z-score vs 20-day baseline.
 */
export function classifySpreadRegime(spreadZScore: number): SpreadRegime {
  if (spreadZScore < -0.5) return "tight";
  if (spreadZScore < 1.0) return "normal";
  if (spreadZScore < 2.5) return "wide";
  return "crisis";
}

// ============================================================================
// TOXICITY SCORE
// ============================================================================

/**
 * Composite toxicity score (0-100).
 *
 * Weighted blend of VPIN, Lambda, OFI strength, and spread regime.
 * Higher = more informed flow / less liquidity / riskier for market makers.
 */
export function computeToxicityScore(
  vpin: number,
  kyleLambdaZScore: number,
  ofiStrength: number, // |OFI_5m| z-score
  spreadZScore: number
): ToxicityResult {
  // Weights
  const W_VPIN = 0.40;
  const W_LAMBDA = 0.25;
  const W_OFI = 0.20;
  const W_SPREAD = 0.15;

  // Normalize each component to 0-100 scale
  const vpinComponent = Math.min(100, vpin * 100); // VPIN is [0,1] → [0,100]
  const lambdaComponent = Math.min(
    100,
    Math.max(0, 50 + kyleLambdaZScore * 20)
  ); // z-score → 0-100
  const ofiComponent = Math.min(100, Math.max(0, ofiStrength * 25)); // OFI z-score → 0-100
  const spreadComponent = Math.min(
    100,
    Math.max(0, 50 + spreadZScore * 20)
  ); // spread z-score → 0-100

  const score =
    W_VPIN * vpinComponent +
    W_LAMBDA * lambdaComponent +
    W_OFI * ofiComponent +
    W_SPREAD * spreadComponent;

  return {
    score: Math.round(Math.min(100, Math.max(0, score)) * 100) / 100,
    components: {
      vpinContribution: Math.round(W_VPIN * vpinComponent * 100) / 100,
      lambdaContribution: Math.round(W_LAMBDA * lambdaComponent * 100) / 100,
      spreadContribution: Math.round(W_SPREAD * spreadComponent * 100) / 100,
      ofiContribution: Math.round(W_OFI * ofiComponent * 100) / 100,
    },
  };
}

// ============================================================================
// BAR AGGREGATION
// ============================================================================

/**
 * Aggregate ticks into time-based bars.
 * @param ticks - Raw tick data (sorted by ts ascending)
 * @param intervalMs - Bar interval in milliseconds (60000 for 1-min, 300000 for 5-min)
 * @param barType - Label for the bar type ('time_1m', 'time_5m')
 */
export function aggregateTimeBars(
  ticks: Tick[],
  intervalMs: number,
  barType: string
): FlowBar[] {
  if (ticks.length === 0) return [];

  const bars: FlowBar[] = [];
  let barStart = new Date(
    Math.floor(ticks[0].ts.getTime() / intervalMs) * intervalMs
  );
  let barEnd = new Date(barStart.getTime() + intervalMs);
  let barTicks: Tick[] = [];

  for (const tick of ticks) {
    while (tick.ts >= barEnd) {
      if (barTicks.length > 0) {
        bars.push(ticksToBar(barTicks, barType, barStart, barEnd));
      }
      barStart = barEnd;
      barEnd = new Date(barStart.getTime() + intervalMs);
      barTicks = [];
    }
    barTicks.push(tick);
  }

  if (barTicks.length > 0) {
    bars.push(ticksToBar(barTicks, barType, barStart, barEnd));
  }

  return bars;
}

/**
 * Aggregate ticks into volume bars.
 * @param ticks - Raw tick data (sorted by ts ascending)
 * @param volumeBucketSize - Volume per bar (typically ADV / 50)
 */
export function aggregateVolumeBars(
  ticks: Tick[],
  volumeBucketSize: number
): FlowBar[] {
  if (ticks.length === 0 || volumeBucketSize <= 0) return [];

  const bars: FlowBar[] = [];
  let barTicks: Tick[] = [];
  let barVolume = 0;

  for (const tick of ticks) {
    barTicks.push(tick);
    barVolume += tick.size;

    if (barVolume >= volumeBucketSize) {
      const barStart = barTicks[0].ts;
      const barEnd = barTicks[barTicks.length - 1].ts;
      bars.push(ticksToBar(barTicks, "volume", barStart, barEnd));
      barTicks = [];
      barVolume = 0;
    }
  }

  // Final partial bar
  if (barTicks.length > 0) {
    const barStart = barTicks[0].ts;
    const barEnd = barTicks[barTicks.length - 1].ts;
    bars.push(ticksToBar(barTicks, "volume", barStart, barEnd));
  }

  return bars;
}

function ticksToBar(
  ticks: Tick[],
  barType: string,
  barStart: Date,
  barEnd: Date
): FlowBar {
  const prices = ticks.map((t) => t.price);
  const volume = ticks.reduce((sum, t) => sum + t.size, 0);
  let turnover = 0;
  for (const t of ticks) turnover += t.price * t.size;

  return {
    barType,
    barOpenTs: barStart,
    barCloseTs: barEnd,
    open: prices[0],
    high: Math.max(...prices),
    low: Math.min(...prices),
    close: prices[prices.length - 1],
    volume,
    tradeCount: ticks.length,
    vwap: volume > 0 ? turnover / volume : prices[0],
    buyVolume: 0, // Filled by BVC classification later
    sellVolume: 0,
    turnover,
  };
}

// ============================================================================
// FEATURE VECTOR COMPUTATION
// ============================================================================

/**
 * Compute the flow feature vector from bars and depth snapshots.
 * Used for regime classification and toxicity scoring.
 */
export function computeFlowFeatures(
  bars5m: FlowBar[],
  depthSnapshots: DepthSnapshot[],
  baseline: {
    meanSpreadBps: number;
    stdSpreadBps: number;
    meanVolumeRate: number;
    stdVolumeRate: number;
    meanLambda: number;
    stdLambda: number;
  }
): FlowFeatureVector {
  // Spread z-score
  const recentSpreads = depthSnapshots
    .slice(-60)
    .map((d) => d.spreadBps)
    .filter((s) => s > 0);
  const currentSpread =
    recentSpreads.length > 0
      ? recentSpreads[recentSpreads.length - 1]
      : baseline.meanSpreadBps;
  const spreadZScore =
    baseline.stdSpreadBps > 0
      ? (currentSpread - baseline.meanSpreadBps) / baseline.stdSpreadBps
      : 0;

  // Volume rate z-score (trades per 5-min bar)
  const recentVolumes = bars5m.slice(-6).map((b) => b.tradeCount);
  const currentVolumeRate =
    recentVolumes.length > 0
      ? recentVolumes[recentVolumes.length - 1]
      : baseline.meanVolumeRate;
  const volumeRateZScore =
    baseline.stdVolumeRate > 0
      ? (currentVolumeRate - baseline.meanVolumeRate) / baseline.stdVolumeRate
      : 0;

  // Book imbalance persistence (autocorrelation of imbalance)
  const imbalances = depthSnapshots.slice(-10).map((d) => d.bookImbalance);
  let bookImbalancePersistence = 0;
  if (imbalances.length >= 5) {
    const m = mean(imbalances);
    let num = 0,
      den = 0;
    for (let i = 1; i < imbalances.length; i++) {
      num += (imbalances[i] - m) * (imbalances[i - 1] - m);
      den += (imbalances[i - 1] - m) ** 2;
    }
    bookImbalancePersistence = den > 0 ? num / den : 0;
  }

  // Trade size entropy
  const recentBars = bars5m.slice(-6);
  const sizeBuckets = new Array(10).fill(0); // 10 size buckets
  for (const bar of recentBars) {
    // Approximate size distribution from buy/sell volumes
    const avgSize = bar.volume / Math.max(bar.tradeCount, 1);
    const bucket = Math.min(9, Math.floor(Math.log2(Math.max(avgSize, 1))));
    sizeBuckets[bucket] += bar.tradeCount;
  }
  const tradeSizeEntropy = shannonEntropy(sizeBuckets);

  // Kyle's Lambda z-score
  const lambda = computeKyleLambda(bars5m, 12);
  const kyleLambdaZScore =
    baseline.stdLambda > 0
      ? (lambda.lambda - baseline.meanLambda) / baseline.stdLambda
      : 0;

  // OFI momentum: ratio of short-term to medium-term OFI
  const ofi5m =
    bars5m.length >= 1 ? bars5m[bars5m.length - 1].ofi || 0 : 0;
  const ofi30m =
    bars5m.length >= 6
      ? bars5m
          .slice(-6)
          .reduce((sum, b) => sum + (b.ofi || 0), 0)
      : ofi5m;
  const ofiMomentum =
    Math.abs(ofi30m) > 0.01 ? ofi5m / Math.abs(ofi30m) : 0;

  // VPIN from recent bars
  const vpinResult = computeVPIN(
    bars5m.slice(-50),
    bars5m.length > 0 ? mean(bars5m.map((b) => b.volume)) : 1000,
    50
  );

  return {
    vpin: vpinResult.vpin,
    spreadZScore,
    volumeRateZScore,
    bookImbalancePersistence,
    tradeSizeEntropy,
    kyleLambdaZScore,
    ofiMomentum,
  };
}

// ============================================================================
// PHASE 3/4 — ADVANCED DETECTION MODELS (tick-data only, no order book)
// ============================================================================

// ── Types ──────────────────────────────────────────────────────────────────

export type IntradayRegime =
  | "opening_auction"
  | "price_discovery"
  | "institutional_accumulation"
  | "retail_flow"
  | "closing_pressure"
  | "low_activity";

export interface IntradayRegimeWindow {
  startTs: Date;
  endTs: Date;
  regime: IntradayRegime;
  tradeRate: number;       // trades/min
  avgTradeSize: number;
  priceChangePct: number;
  buyRatio: number;        // buy volume / total volume (BVC-based)
  vwapDeviation: number;   // (price - vwap) / vwap * 10000 bps
  confidence: number;
}

export interface TWAPWindow {
  startTs: Date;
  endTs: Date;
  direction: 1 | -1;
  sliceCount: number;      // number of detected equal-time slices
  avgSliceVolume: number;
  sliceVolumeCV: number;   // coefficient of variation — low = TWAP signature
  avgSliceIntervalMs: number;
  totalVolume: number;
  vwap: number;
  confidence: number;
}

export interface VWAPExecutionWindow {
  startTs: Date;
  endTs: Date;
  direction: 1 | -1;
  volumeParticipationRate: number; // fraction of market volume
  vwapDevBps: number;              // how close to VWAP execution was
  cumulativeVolume: number;
  priceRangeBps: number;
  confidence: number;
}

export interface StealthAccumulation {
  startTs: Date;
  endTs: Date;
  direction: 1 | -1;
  totalVolume: number;
  pctAdv: number;
  priceRangeBps: number;           // small = stealth
  amihudRatio: number;             // |return| / volume — low = stealth
  tradeCount: number;
  avgTradeSize: number;
  peakVolumeWindowTs: Date;        // highest 5-min volume within the window
  confidence: number;
}

export interface MomentumIgnition {
  startTs: Date;
  endTs: Date;
  direction: 1 | -1;
  priceMoveBps: number;            // large
  volumeInWindow: number;          // small — the ignition signature
  tradeCount: number;
  volumeVsPriorBps: number;        // how much less volume than prior same-size move
  confidence: number;
}

export interface AmihudBar {
  ts: Date;
  returnBps: number;
  volume: number;
  amihud: number;                  // |return| / volume × 1e6 (scaled)
  illiquidityRegime: "liquid" | "normal" | "illiquid" | "crisis";
}

export interface TradeInformativeness {
  windowStartTs: Date;
  signedVolumeImbalance: number;   // (buy_vol - sell_vol) / total_vol
  futureReturnBps: number;         // price change over next `horizonMs`
  informative: boolean;            // signed volume predicted direction
}

// ── Amihud Illiquidity ─────────────────────────────────────────────────────

/**
 * Amihud (2002) illiquidity ratio per 1-min bar.
 * ILLIQ = |r_t| / Volume_t × scaling_factor
 *
 * High Amihud = large price move per unit volume = illiquid / informed flow.
 * Low Amihud  = small price move per unit volume = stealth execution / market making.
 */
export function computeAmihud(
  bars: FlowBar[],
  lookback: number = 20
): AmihudBar[] {
  const result: AmihudBar[] = [];
  const history: number[] = [];

  for (const bar of bars) {
    if (bar.volume === 0) continue;
    const returnBps = bar.open > 0
      ? ((bar.close - bar.open) / bar.open) * 10000
      : 0;
    const amihud = bar.volume > 0
      ? (Math.abs(returnBps) / bar.volume) * 1e6
      : 0;

    history.push(amihud);
    const window = history.slice(-lookback);
    const mu = mean(window);
    const sigma = stddev(window);
    const zScore = sigma > 0 ? (amihud - mu) / sigma : 0;

    let illiquidityRegime: AmihudBar["illiquidityRegime"] = "normal";
    if (zScore < -0.5) illiquidityRegime = "liquid";
    else if (zScore > 2.5) illiquidityRegime = "crisis";
    else if (zScore > 1.0) illiquidityRegime = "illiquid";

    result.push({
      ts: bar.barOpenTs,
      returnBps,
      volume: bar.volume,
      amihud,
      illiquidityRegime,
    });
  }
  return result;
}

// ── Trade Informativeness ──────────────────────────────────────────────────

/**
 * Measures how predictive signed order flow imbalance is for future returns.
 *
 * For each window of `windowMs`, compute:
 *   signed_imbalance = (buy_vol - sell_vol) / total_vol   [BVC-based]
 *   future_return    = price change over the next `horizonMs`
 *
 * Returns each window tagged as "informative" if sign(imbalance) == sign(return).
 */
export function computeTradeInformativeness(
  bars: FlowBar[],  // 1-min bars with BVC classification
  horizonBars: number = 5
): TradeInformativeness[] {
  const results: TradeInformativeness[] = [];

  for (let i = 0; i < bars.length - horizonBars; i++) {
    const bar = bars[i];
    const totalVol = bar.buyVolume + bar.sellVolume;
    if (totalVol === 0) continue;

    const imbalance = (bar.buyVolume - bar.sellVolume) / totalVol;
    const futureBar = bars[i + horizonBars];
    const futureReturn = bar.close > 0
      ? ((futureBar.close - bar.close) / bar.close) * 10000
      : 0;

    const informative =
      (imbalance > 0.1 && futureReturn > 0) ||
      (imbalance < -0.1 && futureReturn < 0);

    results.push({
      windowStartTs: bar.barOpenTs,
      signedVolumeImbalance: imbalance,
      futureReturnBps: futureReturn,
      informative,
    });
  }
  return results;
}

// ── TWAP Execution Detection ───────────────────────────────────────────────

/**
 * Detect TWAP (Time-Weighted Average Price) algo execution.
 *
 * TWAP fingerprint:
 * - Equal time intervals between child orders
 * - Low variance in volume per slice
 * - Consistent direction
 * - Price moves gradually (no urgency)
 *
 * Works on 1-min bars. Scans for windows where:
 *   - Volume CV across slices < 0.35 (uniform slices)
 *   - At least 4 consecutive bars with directional pressure
 *   - Inter-bar intervals are regular (time bars = regular by definition, so
 *     we look for sustained directional imbalance + low size variance)
 */
export function detectTWAP(
  bars: FlowBar[],
  minSlices: number = 4,
  maxCv: number = 0.4
): TWAPWindow[] {
  const results: TWAPWindow[] = [];
  if (bars.length < minSlices) return results;

  let i = 0;
  while (i < bars.length - minSlices + 1) {
    // Try to extend a window starting at i
    let j = i;
    let windowBuyVol = 0;
    let windowSellVol = 0;
    const sliceVolumes: number[] = [];
    let direction: 1 | -1 | 0 = 0;

    while (j < bars.length) {
      const b = bars[j];
      const totalVol = b.buyVolume + b.sellVolume;
      if (totalVol === 0) { j++; continue; }

      const barDir: 1 | -1 = b.buyVolume >= b.sellVolume ? 1 : -1;

      if (direction === 0) direction = barDir;
      else if (barDir !== direction) break; // direction changed — end window

      sliceVolumes.push(b.volume);
      windowBuyVol += b.buyVolume;
      windowSellVol += b.sellVolume;
      j++;
    }

    const sliceCount = j - i;
    if (sliceCount >= minSlices && direction !== 0) {
      const cv = coefficientOfVariation(sliceVolumes);

      if (cv <= maxCv) {
        const windowBars = bars.slice(i, j);
        const totalVol = sliceVolumes.reduce((a, b) => a + b, 0);
        let turnover = 0;
        for (const b of windowBars) {
          turnover += b.vwap * b.volume;
        }
        const vwapVal = totalVol > 0 ? turnover / totalVol : 0;
        const avgIntervalMs = windowBars.length > 1
          ? (windowBars[windowBars.length - 1].barCloseTs.getTime() -
             windowBars[0].barOpenTs.getTime()) / (windowBars.length - 1)
          : 60000;

        // Confidence: lower CV + more slices + larger volume = higher confidence
        const cvScore = Math.max(0, 1 - cv / maxCv);
        const sliceScore = Math.min(1, (sliceCount - minSlices) / 6);
        const confidence = 0.5 * cvScore + 0.3 * sliceScore + 0.2;

        results.push({
          startTs: windowBars[0].barOpenTs,
          endTs: windowBars[windowBars.length - 1].barCloseTs,
          direction: direction as 1 | -1,
          sliceCount,
          avgSliceVolume: mean(sliceVolumes),
          sliceVolumeCV: cv,
          avgSliceIntervalMs: avgIntervalMs,
          totalVolume: totalVol,
          vwap: vwapVal,
          confidence: Math.min(0.98, confidence),
        });

        i = j; // skip past this window
        continue;
      }
    }
    i++;
  }

  // Merge overlapping windows, keep highest confidence
  return mergeOverlapping(results);
}

// ── VWAP Execution Detection ───────────────────────────────────────────────

/**
 * Detect institutional VWAP execution windows.
 *
 * VWAP execution fingerprint:
 * - Volume participation rate stays roughly constant (10-20% of market flow)
 * - Execution price stays close to rolling VWAP
 * - Direction is consistent
 * - Volume spikes correlate with market volume spikes (tracking market pace)
 */
export function detectVWAPExecution(
  bars: FlowBar[],
  minWindowBars: number = 6,
  maxVwapDevBps: number = 30
): VWAPExecutionWindow[] {
  const results: VWAPExecutionWindow[] = [];
  if (bars.length < minWindowBars) return results;

  // Compute rolling VWAP
  let cumTurnover = 0;
  let cumVolume = 0;
  const rollingVwap: number[] = [];
  for (const b of bars) {
    cumTurnover += b.vwap * b.volume;
    cumVolume += b.volume;
    rollingVwap.push(cumVolume > 0 ? cumTurnover / cumVolume : b.vwap);
  }

  let i = 0;
  while (i < bars.length - minWindowBars + 1) {
    let j = i;
    let direction: 1 | -1 | 0 = 0;
    const devs: number[] = [];
    const participationRates: number[] = [];
    let totalVol = 0;

    while (j < bars.length) {
      const b = bars[j];
      const totalBv = b.buyVolume + b.sellVolume;
      if (totalBv === 0) { j++; continue; }

      const barDir: 1 | -1 = b.buyVolume >= b.sellVolume ? 1 : -1;
      if (direction === 0) direction = barDir;
      else if (barDir !== direction) break;

      const devBps = rollingVwap[j] > 0
        ? Math.abs((b.vwap - rollingVwap[j]) / rollingVwap[j]) * 10000
        : 0;
      devs.push(devBps);
      participationRates.push(totalBv > 0 ? totalBv / (b.volume || 1) : 0);
      totalVol += b.volume;
      j++;
    }

    const windowLen = j - i;
    if (windowLen >= minWindowBars && direction !== 0) {
      const avgDev = mean(devs);
      const prParticipation = mean(participationRates);
      const prCV = coefficientOfVariation(participationRates);

      if (avgDev <= maxVwapDevBps) {
        const windowBars = bars.slice(i, j);
        const firstPrice = windowBars[0].open;
        const lastPrice = windowBars[windowBars.length - 1].close;
        const midPrice = (firstPrice + lastPrice) / 2;
        const priceRangeBps = midPrice > 0
          ? (Math.abs(lastPrice - firstPrice) / midPrice) * 10000
          : 0;

        // Confidence: tight VWAP tracking + stable participation rate
        const devScore = Math.max(0, 1 - avgDev / maxVwapDevBps);
        const prScore = Math.max(0, 1 - prCV);
        const confidence = 0.5 * devScore + 0.3 * prScore + 0.2 * Math.min(1, windowLen / 12);

        results.push({
          startTs: windowBars[0].barOpenTs,
          endTs: windowBars[windowBars.length - 1].barCloseTs,
          direction: direction as 1 | -1,
          volumeParticipationRate: prParticipation,
          vwapDevBps: avgDev,
          cumulativeVolume: totalVol,
          priceRangeBps,
          confidence: Math.min(0.98, confidence),
        });
        i = j;
        continue;
      }
    }
    i++;
  }

  return mergeOverlapping(results);
}

// ── Stealth Accumulation Detection ────────────────────────────────────────

/**
 * Detect stealth accumulation/distribution — large volume absorbed with minimal price impact.
 *
 * Classic institutional footprint:
 * - Large cumulative volume over extended window
 * - Price stays in tight range (low range/volume = low Amihud)
 * - Consistent directional pressure (BVC shows net buying/selling)
 * - No single large print — distributed across many small/medium trades
 */
export function detectStealthAccumulation(
  ticks: Tick[],
  bars1m: FlowBar[],
  adv: number,
  windowMs: number = 30 * 60_000,  // 30-min rolling window
  minPctAdv: number = 2.0,          // minimum 2% ADV to flag
  maxPriceRangeBps: number = 100    // max 10 bps range for stealth
): StealthAccumulation[] {
  const results: StealthAccumulation[] = [];
  if (ticks.length < 10 || bars1m.length < 5) return results;

  // Scan with rolling window over 1-min bars
  const windowBars = Math.ceil(windowMs / 60_000);

  for (let i = 0; i + windowBars <= bars1m.length; i++) {
    const window = bars1m.slice(i, i + windowBars);
    const totalVol = window.reduce((s, b) => s + b.volume, 0);
    const pctAdv = adv > 0 ? (totalVol / adv) * 100 : 0;

    if (pctAdv < minPctAdv) continue;

    const firstPrice = window[0].open;
    const lastPrice = window[window.length - 1].close;
    const midPrice = (firstPrice + lastPrice) / 2;
    const allPrices = window.flatMap(b => [b.high, b.low]);
    const highPrice = Math.max(...allPrices);
    const lowPrice = Math.min(...allPrices);
    const priceRangeBps = midPrice > 0
      ? ((highPrice - lowPrice) / midPrice) * 10000
      : 999;

    if (priceRangeBps > maxPriceRangeBps) continue;

    // Directional pressure
    const totalBuy = window.reduce((s, b) => s + (b.buyVolume || 0), 0);
    const totalSell = window.reduce((s, b) => s + (b.sellVolume || 0), 0);
    const classified = totalBuy + totalSell;
    if (classified === 0) continue;
    const buyRatio = totalBuy / classified;
    const direction: 1 | -1 = buyRatio >= 0.55 ? 1 : buyRatio <= 0.45 ? -1 : 1;
    if (Math.abs(buyRatio - 0.5) < 0.05) continue; // no directional pressure

    // Amihud ratio for the window
    const returnBps = midPrice > 0
      ? Math.abs((lastPrice - firstPrice) / firstPrice) * 10000
      : 0;
    const amihud = totalVol > 0 ? (returnBps / totalVol) * 1e6 : 0;

    // Peak volume bar
    const peakBar = window.reduce((a, b) => b.volume > a.volume ? b : a);

    // Confidence: high volume + tight range + directional pressure
    const volScore = Math.min(1, (pctAdv - minPctAdv) / 10);
    const rangeScore = Math.max(0, 1 - priceRangeBps / maxPriceRangeBps);
    const dirScore = Math.abs(buyRatio - 0.5) * 2; // 0-1
    const confidence = 0.4 * volScore + 0.35 * rangeScore + 0.25 * dirScore;

    if (confidence >= 0.35) {
      results.push({
        startTs: window[0].barOpenTs,
        endTs: window[window.length - 1].barCloseTs,
        direction,
        totalVolume: totalVol,
        pctAdv,
        priceRangeBps,
        amihudRatio: amihud,
        tradeCount: window.reduce((s, b) => s + b.tradeCount, 0),
        avgTradeSize: totalVol / Math.max(1, window.reduce((s, b) => s + b.tradeCount, 0)),
        peakVolumeWindowTs: peakBar.barOpenTs,
        confidence: Math.min(0.98, confidence),
      });
    }
  }

  // Remove overlapping windows — keep highest confidence
  return mergeOverlappingGeneric(results, (a, b) =>
    a.startTs.getTime() < b.endTs.getTime() &&
    b.startTs.getTime() < a.endTs.getTime()
  );
}

// ── Momentum Ignition Detection ───────────────────────────────────────────

/**
 * Detect momentum ignition — rapid price moves with abnormally low volume.
 *
 * Classic manipulation pattern: small participant triggers stop cascades
 * or momentum algos by moving price quickly with minimal capital.
 *
 * Signature:
 * - Price moves > X bps in short window
 * - Volume in that window < expected for that price move (low Amihud denominator)
 * - Often followed by reversal within 5-10 min
 */
export function detectMomentumIgnition(
  bars: FlowBar[],
  minMoveBps: number = 30,   // min price move to flag
  windowBars: number = 3,    // bars to consider for the "ignition" move
  amihudBars?: AmihudBar[]
): MomentumIgnition[] {
  const results: MomentumIgnition[] = [];
  if (bars.length < windowBars + 2) return results;

  // Compute rolling average volume per bar for context
  const avgVol = mean(bars.map(b => b.volume));

  for (let i = 0; i <= bars.length - windowBars; i++) {
    const window = bars.slice(i, i + windowBars);
    const firstPrice = window[0].open;
    const lastPrice = window[window.length - 1].close;
    if (firstPrice === 0) continue;

    const moveBps = ((lastPrice - firstPrice) / firstPrice) * 10000;
    if (Math.abs(moveBps) < minMoveBps) continue;

    const windowVol = window.reduce((s, b) => s + b.volume, 0);
    const expectedVol = avgVol * windowBars;

    // Volume much lower than average = ignition signature
    const volRatio = expectedVol > 0 ? windowVol / expectedVol : 1;
    if (volRatio >= 0.7) continue; // normal volume — not ignition

    const direction: 1 | -1 = moveBps > 0 ? 1 : -1;

    // Prior window volume for comparison
    const priorVol = i > 0
      ? bars.slice(Math.max(0, i - windowBars), i).reduce((s, b) => s + b.volume, 0)
      : windowVol;
    const volumeVsPriorBps = priorVol > 0
      ? ((windowVol - priorVol) / priorVol) * 10000
      : 0;

    // Confidence: bigger move + lower volume = more suspicious
    const moveScore = Math.min(1, (Math.abs(moveBps) - minMoveBps) / 50);
    const volScore = Math.max(0, 1 - volRatio);
    const confidence = 0.5 * moveScore + 0.5 * volScore;

    if (confidence >= 0.3) {
      results.push({
        startTs: window[0].barOpenTs,
        endTs: window[window.length - 1].barCloseTs,
        direction,
        priceMoveBps: Math.abs(moveBps),
        volumeInWindow: windowVol,
        tradeCount: window.reduce((s, b) => s + b.tradeCount, 0),
        volumeVsPriorBps,
        confidence: Math.min(0.98, confidence),
      });
    }
  }

  return results;
}

// ── Intraday Regime Classification ────────────────────────────────────────

/**
 * Rolling 5-regime intraday classification using tick data only.
 *
 * Regimes:
 *   opening_auction        — first ~5 min, high volume, all prices
 *   price_discovery        — elevated vol + large price range, early session
 *   institutional_accumulation — sustained directional flow, low Amihud
 *   retail_flow            — small trades, bidirectional, normal conditions
 *   closing_pressure       — rising volume near close, VWAP reversion
 *   low_activity           — low trade rate, wide spreads relative to normal
 */
export function computeIntradayRegime(
  bars: FlowBar[],
  sessionStartTs: Date,
  sessionEndTs: Date
): IntradayRegimeWindow[] {
  const results: IntradayRegimeWindow[] = [];
  if (bars.length < 3) return results;

  const sessionMs = sessionEndTs.getTime() - sessionStartTs.getTime();

  // Session VWAP
  let cumTurnover = 0;
  let cumVol = 0;
  for (const b of bars) { cumTurnover += b.vwap * b.volume; cumVol += b.volume; }
  const sessionVwap = cumVol > 0 ? cumTurnover / cumVol : bars[0].vwap;

  // Rolling baselines
  const avgTradeRate = mean(bars.map(b => b.tradeCount));
  const avgVol = mean(bars.map(b => b.volume));
  const avgAvgSize = mean(bars.map(b => b.tradeCount > 0 ? b.volume / b.tradeCount : 0));

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.tradeCount === 0) continue;

    const elapsedPct = (b.barOpenTs.getTime() - sessionStartTs.getTime()) / sessionMs;
    const remainingPct = 1 - elapsedPct;

    const tradeRate = b.tradeCount; // per bar (1-min)
    const avgSize = b.tradeCount > 0 ? b.volume / b.tradeCount : 0;
    const totalBv = (b.buyVolume || 0) + (b.sellVolume || 0);
    const buyRatio = totalBv > 0 ? (b.buyVolume || 0) / totalBv : 0.5;
    const vwapDev = sessionVwap > 0
      ? ((b.vwap - sessionVwap) / sessionVwap) * 10000
      : 0;
    const barReturn = b.open > 0
      ? ((b.close - b.open) / b.open) * 10000
      : 0;

    let regime: IntradayRegime;
    let confidence = 0.7;

    // Opening auction — first 2 mins after open
    if (elapsedPct < 0.03) {
      regime = "opening_auction";
      confidence = 0.95;
    }
    // Closing pressure — last 10% of session
    else if (remainingPct < 0.10 && tradeRate > avgTradeRate * 1.3) {
      regime = "closing_pressure";
      confidence = 0.85;
    }
    // Low activity
    else if (tradeRate < avgTradeRate * 0.4) {
      regime = "low_activity";
      confidence = 0.80;
    }
    // Institutional accumulation: sustained direction + low price impact + large avg size
    else if (
      Math.abs(buyRatio - 0.5) > 0.12 &&
      avgSize > avgAvgSize * 1.5 &&
      Math.abs(barReturn) < 5
    ) {
      regime = "institutional_accumulation";
      confidence = 0.60 + Math.abs(buyRatio - 0.5) * 0.5;
    }
    // Price discovery: large price moves, elevated activity, early session
    else if (
      elapsedPct < 0.20 &&
      (Math.abs(barReturn) > 10 || tradeRate > avgTradeRate * 2)
    ) {
      regime = "price_discovery";
      confidence = 0.75;
    }
    // Retail: small trades, balanced, normal conditions
    else if (avgSize < avgAvgSize * 0.7 && Math.abs(buyRatio - 0.5) < 0.08) {
      regime = "retail_flow";
      confidence = 0.65;
    }
    else {
      regime = "retail_flow";
      confidence = 0.50;
    }

    results.push({
      startTs: b.barOpenTs,
      endTs: b.barCloseTs,
      regime,
      tradeRate,
      avgTradeSize: avgSize,
      priceChangePct: barReturn / 100,
      buyRatio,
      vwapDeviation: vwapDev,
      confidence: Math.min(0.98, confidence),
    });
  }

  return results;
}

// ── Round-Lot / Algo Fingerprint Detection ────────────────────────────────

export interface AlgoFingerprint {
  ts: Date;
  pattern: "round_lot_clustering" | "size_uniformity" | "regular_intervals" | "price_pinning";
  tradeCount: number;
  dominantSize: number;    // most common trade size in cluster
  totalVolume: number;
  durationMs: number;
  priceRangeBps: number;
  confidence: number;
}

/**
 * Detect algorithmic trading fingerprints in raw tick stream.
 *
 * Four patterns:
 *   round_lot_clustering — trades cluster at 100/200/500/1000 share sizes
 *   size_uniformity      — unusually consistent trade sizes (low CV)
 *   regular_intervals    — evenly-spaced trades (TWAP/VWAP algo)
 *   price_pinning        — repeated trades at exact same price (iceberg refill)
 */
export function detectAlgoFingerprints(
  ticks: Tick[],
  clusterWindowMs: number = 30_000  // 30-sec cluster window
): AlgoFingerprint[] {
  const results: AlgoFingerprint[] = [];
  if (ticks.length < 5) return results;

  const ROUND_LOTS = new Set([50, 100, 200, 500, 1000, 2000, 5000]);

  // Cluster ticks by time proximity (same window)
  let windowStart = ticks[0].ts.getTime();
  let cluster: Tick[] = [];

  const processCluster = (c: Tick[]) => {
    if (c.length < 4) return;

    const sizes = c.map(t => t.size);
    const prices = c.map(t => t.price);
    const gaps: number[] = [];
    for (let k = 1; k < c.length; k++) {
      gaps.push(c[k].ts.getTime() - c[k-1].ts.getTime());
    }

    const totalVol = sizes.reduce((a, b) => a + b, 0);
    const midPrice = (prices[0] + prices[prices.length - 1]) / 2;
    const priceRangeBps = midPrice > 0
      ? ((Math.max(...prices) - Math.min(...prices)) / midPrice) * 10000
      : 0;
    const durationMs = c[c.length - 1].ts.getTime() - c[0].ts.getTime();

    // 1. Round-lot clustering
    const roundLotCount = sizes.filter(s => ROUND_LOTS.has(s)).length;
    const roundLotRatio = roundLotCount / sizes.length;
    if (roundLotRatio >= 0.6) {
      // Find dominant size
      const sizeFreq: Record<number, number> = {};
      for (const s of sizes) sizeFreq[s] = (sizeFreq[s] || 0) + 1;
      const dominantSize = parseInt(
        Object.entries(sizeFreq).sort((a, b) => b[1] - a[1])[0][0]
      );
      results.push({
        ts: c[0].ts,
        pattern: "round_lot_clustering",
        tradeCount: c.length,
        dominantSize,
        totalVolume: totalVol,
        durationMs,
        priceRangeBps,
        confidence: Math.min(0.98, 0.4 + roundLotRatio * 0.5),
      });
    }

    // 2. Size uniformity
    const sizeCV = coefficientOfVariation(sizes);
    if (sizeCV < 0.25 && c.length >= 5) {
      results.push({
        ts: c[0].ts,
        pattern: "size_uniformity",
        tradeCount: c.length,
        dominantSize: Math.round(mean(sizes)),
        totalVolume: totalVol,
        durationMs,
        priceRangeBps,
        confidence: Math.min(0.98, 0.5 + (0.25 - sizeCV) * 2),
      });
    }

    // 3. Regular intervals (TWAP)
    if (gaps.length >= 3) {
      const gapCV = coefficientOfVariation(gaps);
      if (gapCV < 0.30) {
        results.push({
          ts: c[0].ts,
          pattern: "regular_intervals",
          tradeCount: c.length,
          dominantSize: Math.round(mean(sizes)),
          totalVolume: totalVol,
          durationMs,
          priceRangeBps,
          confidence: Math.min(0.98, 0.5 + (0.30 - gapCV) * 2),
        });
      }
    }

    // 4. Price pinning (same price repeated)
    const priceFreq: Record<string, number> = {};
    for (const p of prices) {
      const key = p.toFixed(2);
      priceFreq[key] = (priceFreq[key] || 0) + 1;
    }
    const maxPriceFreq = Math.max(...Object.values(priceFreq));
    const pricePinRatio = maxPriceFreq / prices.length;
    if (pricePinRatio >= 0.7 && c.length >= 5) {
      const pinnedPrice = parseFloat(
        Object.entries(priceFreq).sort((a, b) => b[1] - a[1])[0][0]
      );
      results.push({
        ts: c[0].ts,
        pattern: "price_pinning",
        tradeCount: c.length,
        dominantSize: Math.round(mean(sizes)),
        totalVolume: totalVol,
        durationMs,
        priceRangeBps,
        confidence: Math.min(0.98, 0.4 + pricePinRatio * 0.55),
      });
    }
  };

  for (const tick of ticks) {
    if (tick.ts.getTime() - windowStart > clusterWindowMs) {
      processCluster(cluster);
      windowStart = tick.ts.getTime();
      cluster = [];
    }
    cluster.push(tick);
  }
  processCluster(cluster);

  return results.sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

// ── Helpers ────────────────────────────────────────────────────────────────

function mergeOverlapping<T extends { startTs: Date; endTs: Date; confidence: number }>(
  items: T[]
): T[] {
  return mergeOverlappingGeneric(items, (a, b) =>
    a.startTs.getTime() < b.endTs.getTime() &&
    b.startTs.getTime() < a.endTs.getTime()
  );
}

function mergeOverlappingGeneric<T extends { confidence: number }>(
  items: T[],
  overlaps: (a: T, b: T) => boolean
): T[] {
  if (items.length === 0) return items;
  const kept: T[] = [];
  for (const item of items) {
    const existing = kept.findIndex(k => overlaps(k, item));
    if (existing >= 0) {
      if (item.confidence > kept[existing].confidence) {
        kept[existing] = item;
      }
    } else {
      kept.push(item);
    }
  }
  return kept;
}
