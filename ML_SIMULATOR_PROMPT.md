# OSE Equity ML Trading Simulator — Build Specification

**Context for Claude**: This document is a planning brief for building a live ML trading simulator
for Oslo Stock Exchange equities. It is modelled on an existing Kalman filter FX pairs trading
simulator (described below as the reference implementation). Read the full context before planning.

---

## Reference Implementation: What Already Exists

The InEqRe platform already has a **live FX Pairs Trading Simulator** at `/fx` (PAIRS TRADING tab).
Use this as your visual and architectural blueprint. Key design decisions to carry over:

### Visual Pattern
- Dark terminal theme: `#0a0a0a` background, `#161b22` cards, `#30363d` borders, `#3b82f6` accent
- Monospace font throughout, uppercase section labels with `letter-spacing: 0.08em`
- Animated live playback: PLAY/PAUSE/RESET with configurable speed (1x/3x/5x/10x)
- Simulation reveals data progressively bar-by-bar — user watches trades form in real time
- Three-panel layout: left = main signal chart, right = position monitor, bottom row = equity/state

### Simulation Architecture Pattern
```
API route: fetches historical data → runs engine → returns series + trades + equity + stats
Engine (pure TS): takes arrays of prices/signals → outputs per-bar state + completed trades
UI: animates through series, computing live equity / unrealized P&L as playIdx advances
```

### What Works Well (keep)
- **1-day entry lag** (signal at close t → fill at t+1 open) — realistic execution
- **Same-bar exit** for take-profit (limit orders pre-placed)
- **MIN_HOLD = 2 days** — prevents whipsaw noise trades
- **COOLDOWN = 1 bar** after any exit
- **Vol-targeted P&L**: `pnlPct = netSignalCapture × (positionSizePct / 10)` — keeps P&L meaningful across different signal scales
- **Collapsible guide panel** at top explaining every feature
- **Auto-reset on replay** — pressing PLAY at end restarts automatically

---

## The New Build: OSE ML Trading Simulator

### Concept
A single-stock (and optionally multi-stock) live trading simulator that replays historical ML
signals on Oslo Børs equities. Unlike FX pairs (which trades the *spread* between two assets),
this simulator trades **individual OSE stocks** using the platform's existing ML prediction
infrastructure plus regime and factor signals.

The goal is to make the ML engine's predictions tangible and interpretable — a trader should be
able to watch the signals fire on a stock they know (e.g. EQNR, MOWI) and immediately understand
why the model took or avoided a trade.

### Why OSE / Why This Platform
The platform already has:
- `ml_predictions` table: XGB+LGBM ensemble 1-month forward return predictions per ticker per date
- `factor_technical` + `factor_fundamentals`: 19 factors per ticker (momentum, vol, B/M, E/P etc.)
- `prices_daily`: OHLCV + adjusted close back to ~2014 for all OSE equities
- `backtest_predictions`: historical prediction vs actual pairs (monthly, walk-forward)
- ML service (FastAPI): regime detection (3-state HMM), GARCH vol, jump detection
- Short positions, news/filings, analyst reports all in DB

This simulator should plug directly into all of that — no new data pipelines needed.

---

## Functional Specification

### Page Location
New page: `/alpha` or add as a new tab to the existing `/portfolio` or `/stocks/[ticker]` page.
Recommended: standalone `/alpha/simulator` page to keep it focused and uncluttered.

### Stock Selector
- Single ticker input with autocomplete (reuse `TickerSelector` component)
- Preset watchlist chips: EQNR, MOWI, AKRBP, BORR, GOGL, FRO, FLNG (liquid OSE names)
- Sector filter: Energy / Seafood / Shipping / Materials
- Show data quality badge (A/B/C) and prediction coverage before user starts

### Signal Sources (4 layers, combinable)

#### Layer 1: ML Prediction Signal (primary)
- Source: `ml_predictions` table — `predicted_return` column per ticker/date
- Signal: **BUY** when predicted_return > threshold (default +2%), **SELL/FLAT** otherwise
- This is the XGB+LGBM ensemble, already trained and stored
- Show raw prediction value + confidence percentile (p25/p75 spread) on signal bars

#### Layer 2: Momentum Confirmation Filter
- Source: `factor_technical.mom1m`, `mom6m`, `mom11m`
- Filter: only take BUY signals when ≥2 of 3 momentum windows are positive
- Prevents buying into deteriorating momentum (common false positive in ML models)
- Configurable: OFF / 1-of-3 / 2-of-3 / all-3

#### Layer 3: Volatility Regime Gate
- Source: Call ML service `/volatility/regime/{ticker}` — 2-state MSGARCH (low/high vol)
- Gate: suppress BUY signals during high-volatility regime (regime prob > 0.7)
- Rationale: ML 1-month predictions underperform in high-vol because factor relationships break
- Configurable: OFF / soft (reduce size 50%) / hard (no entry)

#### Layer 4: Valuation Anchor (optional)
- Source: `factor_fundamentals.ep`, `bm` — sector-relative z-scores
- Filter: avoid buying stocks at extreme valuation premium (z > +2σ vs sector peers)
- Configurable: OFF / ON

### Entry/Exit Logic

```
ENTRY CONDITIONS (all must pass):
  1. ML signal: predicted_return > entryThreshold (default 2%)
  2. Momentum filter: passes configured minimum (default: 2-of-3)
  3. Vol regime gate: not in high-vol regime (if enabled)
  4. Not already in position for this ticker
  5. Cooldown: >5 trading days since last exit

POSITION SIZING:
  - Base: positionSizePct % of NAV (default 10%)
  - Vol-scaled: multiply by (targetVol / currentVol) — same vol-targeting as FX sim
  - ML confidence adjustment: ×1.25 if p75 - p25 < 4% (tight confidence interval)

EXIT CONDITIONS (first to trigger):
  1. Take profit: actual return > mlPrediction × 0.8 (captured 80% of forecast)
  2. Stop loss: actual return < -stopLossPct (default -5%)
  3. Signal flip: new ML prediction < -1% (model has reversed view)
  4. Time stop: held > maxHoldDays (default 30 trading days — ~1.5 months)
  5. Regime exit: vol regime flips to high (if hard gate enabled)
```

### P&L Calculation
Use actual OHLCV from `prices_daily` — entry at next-day open, exit at close on trigger day.
No leverage. Transaction cost: `costBps` round-trip (default 10 bps for OSE mid-cap).

```
entryPrice  = prices_daily.open  on entryDate + 1
exitPrice   = prices_daily.close on exitDate
rawReturn   = (exitPrice - entryPrice) / entryPrice
pnlPct      = rawReturn × positionSizePct - costBps/10000
```

---

## UI Layout (follow FX sim pattern)

### Top Bar
```
[TICKER SELECTOR] [SECTOR FILTER]       [3Y] [5Y] [MAX]       [▶ PLAY] [⏹ RESET] [1x] [3x] [5x] [10x]
```

### Row 1: Signal View + Position Monitor (70/30 split)

**Left — ML Signal Chart (main)**
- Price candlestick or line chart (trailing 90 trading days window)
- Overlaid: ML predicted return as colored background band (green = bullish, red = bearish)
- Entry dots (▲ green triangle on price), exit dots (● white circle)
- Active position highlight: colored price area from entry to current
- Annotation: prediction value at each entry signal (+3.2% etc.)

**Right — Position Monitor**
- Same bell-curve concept as FX sim but for ML signal
- X-axis: prediction range (−5% to +5%), vertical line at current prediction
- Shows distance to entry threshold and stop (like the FX ±1.8σ display)
- Active trade card: entry price, current P&L %, days held, stop level

### Row 2: Live Performance + Factor State (60/40 split)

**Left — Equity Curve**
- Compounded P&L indexed to 100 (closed trades only)
- Benchmark overlay: OSE OBX index return over same period
- Alpha line: strategy minus benchmark (fill green if outperforming)

**Right — Factor Dashboard (live)**
- 4 mini-cards updating as simulation advances:
  - ML SIGNAL: current prediction + confidence band
  - MOMENTUM: 3-window alignment (1m/6m/11m) — stoplight indicator
  - VOL REGIME: low/high with transition probability
  - VALUATION: E/P and B/M sector-relative z-score
- Signal log: last 5 signals fired with reason (BUY/SKIP/EXIT + which filter triggered)

### Bottom — Trade Log + Stats
- Stats strip: Total Return, Ann. Return, Sharpe, Max DD, Win Rate, Trades, Avg Hold, vs OBX
- Collapsible trade log: each row = entry date / exit date / direction / predicted return / actual return / days held / P&L / exit reason

### Collapsible Guide Panel (same as FX sim)
Three columns: Strategy explanation / Reading the charts / Parameters & controls

---

## Parameter Controls (sliders, same style as FX sim)

| Parameter | Default | Range | Notes |
|-----------|---------|-------|-------|
| Entry threshold | +2.0% | 0–5% | Min predicted return to trigger BUY |
| Stop loss | −5.0% | −2% to −15% | Hard stop on actual return |
| Position size | 10% NAV | 2–30% | Scales all P&L |
| Max hold days | 30 | 5–63 | Time-based exit |
| Cost (bps) | 10 | 0–50 | Round-trip transaction cost |
| Momentum filter | 2-of-3 | OFF/1/2/3 | Momentum confirmation |
| Vol regime gate | Soft | OFF/Soft/Hard | High-vol suppression |

---

## API Design

### GET `/api/alpha/simulator/[ticker]`
```
Query params:
  days          — history window (default 1260)
  threshold     — ML entry threshold % (default 2.0)
  stop          — stop loss % (default 5.0)
  pos           — position size % NAV (default 10)
  maxhold       — max hold days (default 30)
  cost          — cost bps (default 10)
  momentum      — momentum filter level 0–3 (default 2)
  volgate       — 'off'|'soft'|'hard' (default 'soft')

Response:
  ticker, params, observations
  series[]      — per-bar: date, price, open, close, mlPrediction, momentumScore, volRegime, zscore (for P&L)
  trades[]      — per-trade: entry/exit date+price, predicted/actual return, days held, pnlPct, exitReason, factorsAtEntry
  equity[]      — per-trade: date, value (indexed 100)
  stats{}       — totalReturn, annReturn, sharpe, maxDD, winRate, trades, avgHold, vsBenchmark
  benchmark[]   — OBX index return series (same dates)
```

### Engine (pure TypeScript, no side effects)
```typescript
// apps/web/src/lib/mlTradingEngine.ts

export interface MLEngineParams { threshold, stop, positionSizePct, maxHoldDays, costBps, momentumLevel, volGate }
export interface MLEngineInput { dates, prices, opens, mlPredictions, momentumScores, volRegimes, benchmarkReturns }
export interface MLEngineTrade { entryDate, exitDate, entryPrice, exitPrice, predictedReturn, actualReturn, daysHeld, pnlPct, exitReason, factorsAtEntry }
export interface MLEngineResult { series: MLEnginePoint[], trades: MLEngineTrade[], equity: EquityPoint[], stats: Stats }

export function runMLEngine(input: MLEngineInput, params: MLEngineParams): MLEngineResult
```

---

## Database Queries Needed

### Primary data fetch (in API route)
```sql
-- ML predictions aligned with prices
WITH pred AS (
  SELECT date, predicted_return, p25, p75
  FROM ml_predictions
  WHERE ticker = $1 AND date >= CURRENT_DATE - INTERVAL '$2 days'
  ORDER BY date
),
px AS (
  SELECT date, open, close, adj_close
  FROM prices_daily
  WHERE ticker = $1 AND date >= CURRENT_DATE - INTERVAL '$2 days'
  ORDER BY date
),
mom AS (
  SELECT date, mom1m, mom6m, mom11m
  FROM factor_technical
  WHERE ticker = $1 AND date >= CURRENT_DATE - INTERVAL '$2 days'
),
obx AS (
  SELECT date, close AS obx_close
  FROM prices_daily
  WHERE ticker = 'OBX' AND date >= CURRENT_DATE - INTERVAL '$2 days'
)
SELECT px.date, px.open, px.close, pred.predicted_return, pred.p25, pred.p75,
       mom.mom1m, mom.mom6m, mom.mom11m, obx.obx_close
FROM px
LEFT JOIN pred ON pred.date = px.date
LEFT JOIN mom  ON mom.date  = px.date
LEFT JOIN obx  ON obx.date  = px.date
ORDER BY px.date
```

### Vol regime (from ML service, called separately)
```
GET http://localhost:8000/volatility/regime/{ticker}
→ Returns: state_sequence[], state_probs[], transition_matrix
```

---

## Multi-Stock Extension (Phase 2)

After single-stock works, extend to a **portfolio simulation** mode:
- Select 3–8 OSE stocks simultaneously
- Each stock runs its own signal engine independently
- Positions are sized to sum ≤ 100% NAV (scale down if multiple signals fire same day)
- Portfolio equity curve = sum of all positions weighted by allocation
- Cross-stock view: timeline showing which stocks are in/out at each simulation bar
- Add correlation risk gate: don't hold >2 stocks with pairwise correlation >0.7

---

## Technical Notes for Implementation

### Reuse from existing codebase
- `TickerSelector` component — already has autocomplete from stocks table
- `PriceChart` component — can overlay signals on existing chart
- `LiquidityBadge` — show alongside ticker
- `RegimeHeader` — reuse for vol regime display
- Dark terminal styling constants — copy from `/fx` page `S` object
- Animation loop pattern — exact same `useEffect + setInterval` as FX sim

### New components to build
- `MLSignalChart` — price chart with prediction overlay, entry/exit triangles
- `MLPositionMonitor` — bell curve for prediction vs threshold (analogous to FX position monitor)
- `MLFactorState` — 4-card live factor dashboard
- `MLEquityPanel` — equity curve with OBX benchmark overlay and alpha fill

### Pitfalls to avoid (learned from FX sim)
1. **Lookahead bias**: only use `ml_predictions` where `date < current simulation bar` — never the prediction from the current bar itself (it would use same-day prices)
2. **Survivorship**: prices_daily should include delisted tickers if doing historical backtest — flag if ticker has gaps
3. **Monthly prediction cadence**: ML predictions are generated monthly — interpolate or step-hold between prediction dates (carry last known prediction forward)
4. **Vol regime latency**: MSGARCH regime requires 252+ bars to be meaningful — show warning if ticker has <1Y of data
5. **Factor data gaps**: some tickers have sparse factor_technical coverage — handle NULL gracefully (skip momentum filter if data unavailable)

---

## Files to Create

```
apps/web/src/app/alpha/
  simulator/
    page.tsx                    # Main simulator page (monolithic, like /fx)
    loading.tsx                 # Skeleton loader

apps/web/src/lib/
  mlTradingEngine.ts            # Pure engine: signal evaluation + trade sim + equity

apps/web/src/app/api/
  alpha/
    simulator/
      [ticker]/
        route.ts                # GET: fetch data, run engine, return series+trades+stats
```

---

## Phase 1 Deliverable (MVP)

A working single-stock simulator for GBP, EUR, USD pairs... wait no — for OSE equities:

1. Ticker selector (EQNR default)
2. ML signal chart with entry/exit dots on price
3. Position monitor (bell curve, live z-position of prediction vs threshold)
4. Equity curve vs OBX benchmark
5. Stats strip + trade log
6. Play/pause/reset with 1x–10x speed
7. Sliders: entry threshold, stop loss, position size, cost
8. Collapsible how-it-works guide

**Definition of done**: Running the simulator on EQNR 5Y produces >20 trades, equity curve is meaningful vs OBX benchmark, and the user can clearly see *why* each trade was taken (prediction value + factor state visible at each entry).

---

## Style Reference

Copy the exact styling from `apps/web/src/app/fx/page.tsx` — the `S` object at the top of the
`renderPairs()` function defines all card, button, label styles. The color palette:

```
background:  #0a0a0a
card:        #161b22  border: #30363d
inner card:  #0d1117  border: #21262d
accent:      #3b82f6
success:     #10b981
danger:      #ef4444
warning:     #f59e0b
text:        #ffffff
muted:       rgba(255,255,255,0.5)
dim:         rgba(255,255,255,0.4)
```

Font: `monospace` system stack. All section labels: `fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase"`.
