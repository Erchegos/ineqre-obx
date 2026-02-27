# InEqRe (Intelligence Equity Research) v3.0

Quantitative equity research platform for Oslo Stock Exchange (OSE). Combines automated research aggregation, ML price predictions, volatility modeling, and strategy backtesting.

> **Maintenance Note**: Update this file whenever changes are pushed to git. Add new features, APIs, components, or modify existing entries to keep documentation current.

---

## Git & Deployment

**IMPORTANT**: There are TWO git repos in this project. Only push to the **inner** one:

| Repo | Path | Remote | Deploys to |
|------|------|--------|------------|
| **Inner (CORRECT)** | `InEqRe_OBX/` | `git@github.com:Erchegos/ineqre-obx.git` | Vercel (production) |
| Outer (DO NOT USE) | `code/` (parent dir) | Same remote (broken mirror) | Nothing — wrong file paths |

**Always `cd InEqRe_OBX/` before running git commands.** The outer repo commits files at `InEqRe_OBX/apps/web/...` paths which Vercel cannot find. The inner repo uses correct `apps/web/...` paths.

```bash
# Correct workflow:
cd InEqRe_OBX/
git add <files>
git commit -m "message"
git push
```

## Tech Stack
- **Frontend**: Next.js 15, React 19, TypeScript, Recharts, Tailwind CSS 4
- **Backend**: Node.js, PostgreSQL 17, Drizzle ORM, Supabase
- **ML**: Python, scikit-learn (Ridge, GB, RF), arch (GARCH), hmmlearn (MSGARCH), FastAPI ML service
- **Data**: Interactive Brokers TWS API (primary), Yahoo Finance (fallback)
- **Build**: Turborepo, PNPM workspaces

---

## Directory Structure

```
InEqRe_OBX/
├── apps/web/                    # Main Next.js application
│   ├── src/app/                 # Pages and API routes
│   ├── src/components/          # React components
│   ├── src/lib/                 # Business logic & utilities
│   └── scripts/                 # Data pipeline scripts
├── packages/
│   ├── db/                      # Database schema (@ineqre/db)
│   │   └── src/schema/          # Drizzle schema files
│   └── ibkr/                    # IBKR integration (@ineqre/ibkr)
│       └── src/                 # TWS client, fundamentals parser
├── scripts/                     # Root-level utility scripts
├── ml-service/                  # Python ML microservice
└── docs/                        # Documentation files
```

---

## Active Features & Pages

| Feature | URL Route | File Path |
|---------|-----------|-----------|
| **Homepage** | `/` | `apps/web/src/app/page.tsx` |
| **Universe Explorer** | `/stocks` | `apps/web/src/app/stocks/page.tsx` |
| **Stock Detail** | `/stocks/[ticker]` | `apps/web/src/app/stocks/[ticker]/page.tsx` |
| **Research Portal** | `/research` | `apps/web/src/app/research/page.tsx` |
| **Correlation Analysis** | `/correlation` | `apps/web/src/app/correlation/page.tsx` |
| **ML Predictions** | `/predictions/[ticker]` | `apps/web/src/app/predictions/[ticker]/page.tsx` |
| **Monte Carlo** | `/montecarlo/[ticker]` | `apps/web/src/app/montecarlo/[ticker]/page.tsx` |
| **Volatility** | `/volatility/[ticker]` | `apps/web/src/app/volatility/[ticker]/page.tsx` |
| **OBX Volatility Dashboard** | `/volatility/obx` | `apps/web/src/app/volatility/obx/page.tsx` |
| **Std Channel Strategy** | `/std-channel-strategy` | `apps/web/src/app/std-channel-strategy/page.tsx` |
| **Backtest Results** | `/backtest` | `apps/web/src/app/backtest/page.tsx` |
| **FX Hedging** | `/fx-hedging` | `apps/web/src/app/fx-hedging/page.tsx` |
| **Options List** | `/options` | `apps/web/src/app/options/page.tsx` |
| **Options Analysis** | `/options/[ticker]` | `apps/web/src/app/options/[ticker]/page.tsx` |
| **Portfolio Optimizer** | `/portfolio` | `apps/web/src/app/portfolio/page.tsx` |
| **Intelligence Terminal** | `/news` | `apps/web/src/app/news/page.tsx` |

---

## API Endpoints

All endpoints in `apps/web/src/app/api/`

### Data APIs
| Endpoint | Purpose |
|----------|---------|
| `GET /api/stocks` | List all securities (filter by asset_type) |
| `GET /api/equities/[ticker]` | Equity details |
| `GET /api/prices/[ticker]` | OHLCV price history |
| `GET /api/analytics/[ticker]` | Price analytics, returns, drawdown |
| `GET /api/volatility/[ticker]` | Volatility metrics (Yang-Zhang, EWMA, vol cone, decomposition) |
| `GET /api/volatility/obx` | OBX index-level vol dashboard (constituents, vol cone, correlation) |
| `GET /api/volatility/ml/[ticker]` | Proxy to Python ML service (GARCH, MSGARCH, VaR, jumps) |
| `GET /api/fundamentals/[ticker]` | E/P, B/M, dividend yield, market cap |
| `GET /api/liquidity/[ticker]` | Liquidity regime classification |

### Prediction APIs
| Endpoint | Purpose |
|----------|---------|
| `GET /api/factors/[ticker]` | Technical & fundamental factors |
| `GET /api/factors/tickers` | List tickers with factor data |
| `GET /api/predictions/[ticker]` | ML predictions (GB/RF ensemble) |
| `GET /api/predictions/generate` | Trigger prediction generation |
| `GET /api/residuals/[ticker]` | Residual analysis |
| `GET /api/optimizer-config/[ticker]` | Optimizer configuration |
| `GET /api/optimizer-config/tickers` | List optimized tickers |

### Strategy APIs
| Endpoint | Purpose |
|----------|---------|
| `GET /api/backtest` | ML backtest results |
| `GET /api/backtest/[ticker]` | Ticker-specific backtest |
| `GET /api/std-channel/[ticker]` | Std deviation channel data |
| `GET /api/std-channel-optimize/[ticker]` | Optimized channel params |
| `GET /api/std-channel-optimize` | Bulk optimization results |
| `GET /api/std-channel-strategy` | Strategy backtest with trades & signals |
| `GET /api/correlation` | Correlation matrices |

### Options APIs
| Endpoint | Purpose |
|----------|---------|
| `GET /api/options` | List all stocks with options data + aggregated stats (OI, IV, max pain, P/C ratio) |
| `GET /api/options/[ticker]` | Options chain, OI, Max Pain, IV skew (from DB) |
| `GET /api/options/[ticker]/iv-curve` | ATM IV term structure (from DB) |

### Research APIs
| Endpoint | Purpose |
|----------|---------|
| `GET /api/research/documents` | List research documents |
| `GET /api/research/documents/[id]` | Document details |
| `GET /api/research/documents/[id]/attachments/[aid]` | PDF attachments |
| `POST /api/research/auth` | Password authentication |
| `POST /api/research/generate-summaries` | AI summary generation |

### Portfolio APIs (Password-Protected)
| Endpoint | Purpose |
|----------|---------|
| `POST /api/portfolio/auth` | Username + password authentication (JWT 8h, profile from `research_access_tokens.description`) |
| `POST /api/portfolio/optimize` | Mean-variance optimization (5 modes, risk decomposition, efficient frontier) |
| `GET /api/portfolio/configs` | List saved portfolio configurations |
| `POST /api/portfolio/configs` | Save new portfolio configuration |
| `GET /api/portfolio/configs/[id]` | Load specific portfolio configuration |
| `PUT /api/portfolio/configs/[id]` | Update portfolio configuration |
| `DELETE /api/portfolio/configs/[id]` | Delete portfolio configuration |

### News & Intelligence APIs
| Endpoint | Purpose |
|----------|---------|
| `GET /api/news` | AI-classified news feed (severity, sentiment, ticker/sector mapping) |
| `GET /api/news/ticker/[ticker]` | Per-ticker news: merges IBKR news + NewsWeb filings, sorted by date |
| `GET /api/shorts` | Latest short positions for all stocks (Finanstilsynet SSR) |
| `GET /api/shorts/[ticker]` | Per-stock short position history with holder breakdown |
| `GET /api/commodities` | All commodity prices with stock sensitivity data |
| `GET /api/commodities/[symbol]` | Per-commodity detail with price history and stock betas |

### FX APIs
| Endpoint | Purpose |
|----------|---------|
| `GET /api/fx-pairs` | FX pair data |
| `GET /api/fx-hedging/exposures` | FX exposure analysis |

### System APIs
| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Full health check |
| `GET /api/health-simple` | Lightweight health check |
| `GET /api/health-db` | Database connectivity |
| `GET /api/stats` | System statistics |
| `GET /api/ibkr/test` | IBKR connection test |
| `POST /api/ibkr/import-stock` | Import stock from IBKR |

---

## Core Libraries

All in `apps/web/src/lib/`

| File | Purpose |
|------|---------|
| `montecarlo.ts` | 10K-path GBM simulation, normal random generation |
| `volatility.ts` | Yang-Zhang, Rogers-Satchell, Parkinson, Garman-Klass, EWMA |
| `std-channel.ts` | Linear regression with ±1σ/±2σ bands, optimal window |
| `statistics.ts` | Log returns, Sharpe ratio, drawdown, VaR, CVaR |
| `factors.ts` | Momentum (1m/6m/11m/36m), volatility, fundamentals |
| `factorAdvanced.ts` | Advanced ML-related factor derivations |
| `fxHedging.ts` | FX exposure, hedge ratios, carry trade P&L |
| `fxPairCalculations.ts` | Forward pricing, Interest Rate Parity |
| `riskManagement.ts` | Position sizing, portfolio risk, drawdown tracking |
| `positionSizing.ts` | Kelly criterion, volatility-adjusted sizing |
| `stdChannelStrategy.ts` | Std channel trading strategy backtesting |
| `eventFilters.ts` | 8 event-driven filters for signal quality (volume, gap, market, volatility, fundamentals, research, liquidity, momentum) |
| `liquidityRegime.ts` | Liquidity classification (high/normal/low) |
| `regimeClassification.ts` | Market regime detection |
| `tradingImplications.ts` | Convert analytics to trading signals |
| `db.ts` | PostgreSQL connection pool |
| `supabase.ts` | Supabase client for PDF storage |
| `stocks-server.ts` | Server-side stock data fetching |
| `security.ts` | JWT auth, RBAC, secure response formatting |
| `rate-limit.ts` | IP-based rate limiting (100 req/min) |
| `validation.ts` | Zod schemas for API validation |
| `dataQuality.ts` | Data completeness, tier classification |
| `options.ts` | Black-Scholes pricing, IV solver, payoff diagrams, multi-time P&L; sigma clamped ≥5% to prevent gamma blow-up from bad Yahoo IV |
| `parameterValidation.ts` | Strategy parameter validation |
| `market.ts` | Market-level calculations |
| `price-data-adapter.ts` | Price data normalization |
| `portfolioOptimizer.ts` | Markowitz optimization: covariance (sample/Ledoit-Wolf/EWMA), 5 modes (EW/MinVar/MaxSharpe/RiskParity/MaxDiv), closed-form solutions + iterative constraint projection, risk decomposition, efficient frontier |

---

## Components

All in `apps/web/src/components/`

### Charts
- `PriceChart.tsx` - Line charts for price/return data
- `CandlestickChart.tsx` - OHLC candlestick visualization
- `MonteCarloChart.tsx` - Monte Carlo simulation paths
- `PredictionChart.tsx` - ML prediction distribution
- `ReturnDistributionChart.tsx` - Return histogram
- `VolatilityChart.tsx` - Volatility trends
- `VolatilityCorrelationChart.tsx` - Vol vs price correlation
- `VolatilitySeasonality.tsx` - Monthly volatility seasonality
- `CorrelationHeatmap.tsx` - Cross-sectional correlation matrix
- `RollingCorrelationChart.tsx` - Rolling correlation over time
- `SeasonalityChart.tsx` - Monthly seasonality patterns
- `ResidualSquaresChart.tsx` - Residual analysis
- `price-drawdown-chart.tsx` - Drawdown visualization
- `VolConeChart.tsx` - Percentile band cone chart (5th-95th at 1W-1Y windows)
- `ConstituentHeatmap.tsx` - Sortable OBX constituent vol heatmap

### Volatility Advanced
- `VolatilityHero.tsx` - Regime-colored hero panel with key metrics
- `VolatilityAdvancedTabs.tsx` - Tabbed interface (Estimators | GARCH | Regime | VaR)
- `ExpectedMovesStrip.tsx` - Compact expected moves display
- `GarchParametersTab.tsx` - GARCH(1,1) parameters, conditional vol chart, AIC/BIC
- `RegimeModelTab.tsx` - MSGARCH transition matrix, state probabilities, regime duration
- `VarBacktestTab.tsx` - VaR levels, backtest chart, Kupiec/Christoffersen tests, jump events

### Data Display
- `TickerSelector.tsx` - Ticker autocomplete input
- `TimeframeSelector.tsx` - Preset/custom timeframe selection
- `DataFreshnessIndicator.tsx` - Data quality indicator
- `LiquidityBadge.tsx` - Liquidity regime badge
- `StockFundamentalsPanel.tsx` - E/P, B/M, dividend yield display
- `FactorDashboard.tsx` - 17-factor visualization
- `FeatureImportance.tsx` - ML feature importance bars
- `RegimeHeader.tsx` - Market regime header
- `RegimeTimeline.tsx` - Regime periods timeline
- `ExpectedMoves.tsx` - Expected daily/weekly moves
- `TradingImplications.tsx` - Trading signals
- `MethodologySection.tsx` - Expandable methodology explanations
- `MarketCorrelation.tsx` - Market-level correlation

---

## Database Schema

Schema files in `packages/db/src/schema/`

### Master Data
| Table | Purpose |
|-------|---------|
| `stocks` | Security master (ticker, name, ISIN, sector, currency) |
| `prices_daily` | Daily OHLCV with adjusted close |

### Factor Tables
| Table | Purpose |
|-------|---------|
| `factor_technical` | Momentum (1m/6m/11m/36m), volatility (1m/3m/12m), beta, ivol |
| `factor_fundamentals` | B/M, E/P, dividend yield, sales/price, EV/EBITDA, market cap |

### ML Tables
| Table | Purpose |
|-------|---------|
| `ml_predictions` | GB/RF ensemble predictions, percentiles, confidence |
| `ml_model_metadata` | Model versioning, hyperparams, performance metrics |

### Research Tables
| Table | Purpose |
|-------|---------|
| `research_documents` | Broker research with full-text search |
| `research_attachments` | PDF files with storage paths |
| `research_access_tokens` | Password-protected access control |

### FX Tables
| Table | Purpose |
|-------|---------|
| `fxSpotRates` | Daily spot rates (NOK base) |
| `stockFxExposure` | Currency revenue breakdown per stock |
| `fxCurrencyBetas` | Rolling currency betas |
| `fxOptimalHedges` | Optimal hedge ratios |
| `fxMarketRegimes` | Market regime classification |

### Options Data
| Table | Purpose |
|-------|---------|
| `options_chain` | Pre-loaded options chain (strike, IV, Greeks, OI, volume) |
| `options_meta` | Options metadata (expirations, strikes, multiplier) |

### OSE-Specific
| Table | Purpose |
|-------|---------|
| `obxEquities` | OSE daily data (VWAP, trades, turnover) |
| `obxFeatures` | Market proxy metrics |

### Portfolio Management
| Table | Purpose |
|-------|---------|
| `portfolio_configs` | Saved portfolio configurations (tickers, weights, mode, constraints) |

### Intelligence / Alt Data
| Table | Purpose |
|-------|---------|
| `short_positions` | Daily aggregate short interest per stock (Finanstilsynet SSR) |
| `short_position_holders` | Individual short position holders per stock per day |
| `commodity_prices` | Daily OHLCV for Brent, WTI, Gas, Aluminium, Gold, Silver |
| `commodity_stock_sensitivity` | Regression beta, correlation of stocks vs commodities |
| `newsweb_filings` | Oslo Børs NewsWeb regulatory filings (AI-classified) |
| `insider_transactions` | Structured insider trade data extracted from filings |

---

## Data Pipeline

### Data Sources
1. **IBKR Gateway** (port 4002) - Primary real-time data
2. **Yahoo Finance** - Fallback for prices/fundamentals + commodity prices (BZ=F, CL=F, NG=F, ALI=F, GC=F, SI=F)
3. **Norges Bank** - FX rates (NOK/USD, EUR, GBP)
4. **Gmail IMAP** - Research emails from Pareto/DNB
5. **Finanstilsynet SSR** - Short selling positions (`https://ssr.finanstilsynet.no/api/v2/instruments`)

### ML Pipeline (6 steps)
Located in `apps/web/scripts/ml-daily-pipeline.ts`:

1. Calculate technical factors (19 factors)
2. Backfill beta/IVOL
3. Calculate NOK volume
4. Fetch Yahoo fundamentals
5. Refresh materialized view
6. Regenerate ML predictions

**Run**: `pnpm run ml:pipeline` (from apps/web)

### Intelligence Data Pipeline (daily)
Run after market close alongside ML pipeline:

1. **Short positions**: `pnpm run shorts:fetch` — Finanstilsynet SSR API (no auth, free JSON)
2. **Commodity prices**: `pnpm run commodities:fetch` — Yahoo Finance OHLCV + stock sensitivity regression
3. **News**: `pnpm run news:fetch` — IBKR news headlines with AI classification
4. **NewsWeb filings**: `pnpm run newsweb:fetch` — Oslo Børs regulatory filings (insider trades, earnings, buybacks, dividends)

### Automation
- **GitHub Actions**: ML pipeline daily at 01:00 UTC, Email import every 10 min
- **Local**: `pnpm run daily-update` (smart IBKR → Yahoo fallback)
- **Intelligence data**: Run `shorts:fetch` + `commodities:fetch` + `newsweb:fetch` daily after prices are updated

---

## Key Scripts

### apps/web/scripts/
| Script | Purpose |
|--------|---------|
| `ml-daily-pipeline.ts` | Master ML orchestrator (6 steps) |
| `ibkr-daily-update.ts` | Fetch OHLCV from IBKR |
| `backfill-yahoo.mjs` | Yahoo Finance price fallback |
| `regenerate-predictions.ts` | Generate ML predictions |
| `backtest-std-channel.ts` | Backtest std channel strategy |
| `optimize-std-channel.ts` | Optimize channel parameters |
| `optimize-std-channel-fast.ts` | Fast optimization variant |
| `export-factors-for-optimizer.ts` | Export factor data for optimizer |
| `populate-factors-simple.ts` | Populate factor tables |
| `refresh-materialized-view.ts` | Refresh DB materialized views |
| `scan-ose-universe.ts` | Discover new OSE tickers |
| `import-new-tickers.ts` | Import tickers to database |
| `fetch-options-daily.ts` | Fetch options chains from Yahoo Finance, store in DB |
| `fetch-options-nasdaq.ts` | Fetch options OI/bid/ask from Nasdaq API (supplements Yahoo) |
| `fetch-ssr-shorts.ts` | Fetch short positions from Finanstilsynet SSR API |
| `fetch-commodities.ts` | Fetch commodity prices from Yahoo + calculate stock sensitivity |
| `fetch-newsweb-filings.ts` | Fetch regulatory filings from Oslo Børs NewsWeb API into `newsweb_filings` |

### scripts/
| Script | Purpose |
|--------|---------|
| `email-processor.js` | Import research emails via IMAP |
| `gmail-pdf-downloader.js` | Download PDF attachments |
| `generate-summaries.js` | AI-powered research summaries |
| `import-yahoo-adjusted.ts` | Import Yahoo historical data |
| `update-single-stock.ts` | Update individual stock |
| `update-tier-bc-equities.ts` | Update tier B/C equities |
| `fetch-new-fundamentals.ts` | Fetch new fundamental data |
| `upload-research-pdf.ts` | Upload research PDFs |

---

## Common Tasks - Where to Look

| Task Type | Look Here |
|-----------|-----------|
| **UI/Page changes** | `apps/web/src/app/[route]/page.tsx` |
| **Add new page** | Create folder in `apps/web/src/app/` |
| **Component changes** | `apps/web/src/components/` |
| **API changes** | `apps/web/src/app/api/[endpoint]/route.ts` |
| **Add new API** | Create folder in `apps/web/src/app/api/` |
| **Calculation logic** | `apps/web/src/lib/` |
| **Database schema** | `packages/db/src/schema/` |
| **Add new table** | Create file in schema/, update drizzle |
| **IBKR integration** | `packages/ibkr/src/` |
| **Data pipeline** | `apps/web/scripts/` |
| **New ticker import** | Run `pnpm run ibkr:scan-universe` then `import:new-tickers` |
| **ML predictions** | `apps/web/scripts/regenerate-predictions.ts` |
| **Research portal** | `apps/web/src/app/research/` + `api/research/` |
| **FX hedging** | `apps/web/src/lib/fxHedging.ts` + `api/fx-hedging/` |
| **Volatility models** | `ml-service/app/models/` + `api/volatility/ml/[ticker]` |
| **OBX dashboard** | `apps/web/src/app/volatility/obx/` + `api/volatility/obx/` |

---

## NPM Commands

From `apps/web/`:
```bash
pnpm run dev              # Dev server
pnpm run build            # Production build
pnpm run ibkr:update      # IBKR daily price update
pnpm run ml:pipeline      # Full ML pipeline
pnpm run daily-update     # Smart IBKR→Yahoo + ML
pnpm run ibkr:scan-universe  # Scan for new tickers
pnpm run import:new-tickers  # Import new tickers
pnpm run shorts:fetch       # Fetch Finanstilsynet short positions
pnpm run commodities:fetch  # Fetch commodity prices + sensitivity
pnpm run newsweb:fetch      # Fetch Oslo Børs NewsWeb filings
```

---

## Environment Variables

Required in `.env`:
- `DATABASE_URL` - PostgreSQL connection string
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key
- `ANTHROPIC_API_KEY` - For AI summaries
- `GMAIL_CREDENTIALS` / `GMAIL_TOKEN` - For email import

---

## ML Model Details

### Factors (19 total)
**Technical (11)**: mom1m, mom6m, mom11m, mom36m, chgmom, vol1m, vol3m, vol12m, maxret, beta, ivol, dum_jan

**Fundamental (8)**: bm, ep, dy, sp, sg, mktcap, nokvol

### Model
- **Type**: XGBoost (50%) + LightGBM (50%) ensemble (replaced GB/RF v2)
- **Target**: 1-month forward returns
- **Output**: Point estimate + percentiles (p05, p25, p50, p75, p95) + SHAP importance
- **Versions**: v3.0_xgb_lgbm

### Python ML Service
Located in `ml-service/`. FastAPI service v2.0 for ML predictions, volatility models, regime detection, clustering, and signal generation.

**Volatility Endpoints** (GET):
| Endpoint | Purpose |
|----------|---------|
| `/volatility/garch/{ticker}` | GARCH(1,1) fitting, conditional vol series, forecasts |
| `/volatility/regime/{ticker}` | 2-state MSGARCH (HMM + per-state GARCH), transition matrix |
| `/volatility/var/{ticker}` | Historical, Parametric, GARCH VaR/ES at 95%/99% |
| `/volatility/var-backtest/{ticker}` | Kupiec POF + Christoffersen independence tests |
| `/volatility/jumps/{ticker}` | Statistical jump detection (3σ threshold) |
| `/volatility/full/{ticker}` | Combined: all models in one call |

**Alpha Engine Endpoints** (POST):
| Endpoint | Purpose |
|----------|---------|
| `/regime/multivariate` | 3-state HMM (Bull/Neutral/Crisis) on multivariate features |
| `/clustering/spectral` | Spectral clustering on residual correlations + OU z-scores |
| `/signals/cnn` | 1D CNN + Transformer signal generation (PyTorch) |
| `/signals/combine` | 6-signal weighted combiner (regime-adjusted) |
| `/signals/backtest` | Walk-forward backtest engine |
| `/train` | Train XGBoost/LightGBM ensemble |
| `/predict` | Generate prediction for ticker/date |

**Dependencies**: `arch>=6.0`, `hmmlearn>=0.3`, `xgboost>=2.0`, `lightgbm>=4.0`, `shap>=0.43`, `torch>=2.0`, `fastapi`, `uvicorn`

**Start**: `cd ml-service && source venv/bin/activate && uvicorn app.main:app --port 8000`

### Alpha Engine Architecture
```
Signal Sources (6):
  ML (XGB/LGBM):  25% — 1-month return prediction
  CNN:            20% — 1D CNN + Transformer pattern detection
  Momentum:       15% — 1m/6m/11m trend alignment
  Valuation:      15% — Sector-relative z-scores (E/P, B/M, D/Y, EV/EBITDA, S/P)
  Cluster (MR):   15% — OU mean-reversion z-score
  Regime:         10% — 3-state HMM portfolio regime

Crisis mode: Regime → 30%, CNN → 10%, others adjusted
Output: Combined signal [-1, 1] per ticker
```

---

## Volatility Module Details

### Per-Stock Page (`/volatility/[ticker]`)
- **Regime Hero**: Color-coded panel with 6-regime classification (Crisis → Low & Stable)
- **Regime Timeline**: Price overlay with regime-colored background bands
- **Vol Cone**: Percentile bands (5th-95th) at 1W/2W/1M/3M/6M/1Y windows
- **Vol Decomposition**: Systematic (β×σ_m) vs idiosyncratic risk breakdown
- **Advanced Tabs**: Estimators | GARCH Parameters | Regime Model | VaR Backtest
- **Trading Implications**: Regime-specific trading signals

### OBX Dashboard (`/volatility/obx`)
- **Regime Status Bar**: OBX index regime + duration + trend
- **3-Column Dashboard**: Index vol metrics | Regime distribution | Systemic risk
- **Regime Timeline**: OBX price with regime overlay
- **Vol Cone + Rolling Correlation**: 2-column layout
- **Constituent Heatmap**: Sortable table of all OSE equities by vol/regime/percentile
- **Market Assessment**: AI-generated interpretation

### Regime Classification (6 regimes)
```
Crisis (>95th pctile):     #FF1744 — Cash preservation, emergency hedging
Extreme High (>85th):      #F44336 — Defensive, reduce exposure
Elevated (>65th):          #FF9800 — Cautious, tighten stops
Normal (30th-65th):        #9E9E9E — Standard positioning
Low & Contracting (<30th): #2196F3 — Accumulate, expand positions
Low & Stable (<30th):      #4CAF50 — Full allocation, sell vol
```

---

## Event-Driven Filters (Std Channel Strategy)

Located in `apps/web/src/lib/eventFilters.ts`

### Purpose
Distinguish between mean-reverting opportunities (technical overreaction) and regime shifts (fundamental change). Used in the std-channel strategy to filter out trades that are likely to fail.

### 8 Active Filters

| Filter | Weight | Purpose |
|--------|--------|---------|
| **Volume Anomaly** | 20% | High volume + extreme σ = news-driven, avoid. Normal volume = technical, trade |
| **Gap Detection** | 15% | Overnight gaps indicate news events. Large gaps = avoid |
| **Market Context** | 15% | Beta-adjusted: Is move systematic (market-wide) or idiosyncratic (stock-specific)? |
| **Volatility Regime** | 10% | High-vol regime = extreme moves common. Low-vol = unusual, good reversion |
| **Fundamental Stability** | 10% | Did E/P, B/M change recently? Stable = technical move |
| **Research Activity** | 10% | Recent analyst reports suggest news-driven move |
| **Liquidity Quality** | 10% | Illiquid stocks: moves persist. Liquid: faster reversion |
| **Momentum Divergence** | 10% | Short vs long-term momentum alignment for trend quality |

### Scoring
- Each filter returns 0-1 score
- Weighted average = composite score
- **PROCEED** (≥0.7): Strong setup, take the trade
- **CAUTION** (0.5-0.7): Mixed signals, reduce size
- **AVOID** (<0.5): Red flags, skip the trade

### Integration
- Enabled by default in std-channel strategy
- Configurable via `useFilters` and `minEventScore` params
- Filter details shown in expanded signal rows on UI

---

## Options Analysis Details

The options module (`/options/[ticker]`) provides:

### Chain & Analytics
- Options chain table (calls & puts side-by-side) with bid/ask/last/IV/Greeks/OI
- Open Interest distribution chart by strike
- Volume by strike chart
- IV skew chart (volatility smile) — filters out 0% IV strikes with no volume/OI
- Greeks by strike (delta, gamma on dual axes)
- Max Pain calculation
- Put/Call ratio (OI & Volume based)
- Filters: Near ATM / All strikes

### P&L Calculator
- Manual position entry (type, strike, expiry, premium, qty)
- B/S buttons on chain populate the manual entry form (no auto-add) — user reviews and clicks "ADD TO STRATEGY"
- Editable positions: EDIT button loads position back into form for adjustment, click to re-add
- Strike input: arrow up/down keys snap to next/prev valid strike from chain, premium auto-updates
- 6 preset strategies with adjustable qty (default 10):
  - Bull Call Spread, Bear Put Spread, Long Straddle, Long Strangle, Iron Condor, Call Butterfly
- Smart strategy builder: skips strikes with no data, uses mid-price for realistic premiums
- Each strategy shows description, legs, outlook, risk, cost
- Multi-time payoff diagram (today, 1/3 elapsed, 2/3 elapsed, at expiry)
- Portfolio Greeks per-contract (delta, gamma, theta, vega) — raw Black-Scholes values, not scaled by quantity
- Breakeven points, max profit, max loss (detects unlimited profit/loss via net call exposure)
- Chain filters: Near ATM, All, ITM, OTM

### Data
- Ticker mapping: `.US` suffix stripped for API calls (e.g., `EQNR.US` → `EQNR` in DB)
- Data from `options_chain` and `options_meta` tables (populated by `fetch-options-daily.ts`)
- Supported tickers: EQNR, FLNG, FRO (US-listed with valid OI/volume)
- Max pain computed in JS (iterates each strike as hypothetical settlement price)
- OPTN badge on stocks list only shows for `.US`-suffixed tickers
- **Synthetic bid/ask**: Options without bid/ask from Yahoo get synthetic quotes:
  - Mid price = last_price (if available) or Black-Scholes theoretical price
  - Spread: 5% ATM → 25% deep OTM (moneyness-scaled)
  - Applied both in fetch script (DB storage) and API route (runtime fallback)
  - IV solved from last_price via Newton-Raphson when Yahoo returns ~0 IV
  - Dead options (no price, no OI) are skipped during fetch
- **Protective UPSERT**: Fetch scripts never overwrite good data with empty data:
  - bid/ask/last_price: only updated when new value > 0
  - IV/Greeks: only updated when new IV > 1%
  - OI/volume: only updated when new value > 0 (preserves historical OI from previous fetches)
  - underlying_price/fetched_at: always updated (always valid)
- **Dual data sources**: Yahoo Finance (`fetch-options-daily.ts`) + Nasdaq API (`fetch-options-nasdaq.ts`)
  - Yahoo: primary source for IV, chain structure, expirations
  - Nasdaq: supplements with real bid/ask, OI, and volume (no auth required)
  - Both use protective UPSERT — run in any order, best data wins

---

## Portfolio Optimizer Details

Located at `/portfolio`. Password-protected with per-user profiles.

### Auth & Profile System
- Login requires **username + password** (no session persistence — must re-login on every page reload)
- Username matches `description` column in `research_access_tokens`; password verified against `token_hash` (bcryptjs)
- JWT token (8h expiry) includes `profile` field, displayed in header badge
- Auto-logout on 401 (expired token) — any API call returning 401 clears auth state
- Saved portfolios are scoped by profile — each user only sees their own configs
- `portfolio_configs.profile` column (VARCHAR 50) stores the profile name
- Accounts managed via `scripts/create-research-password.ts`

### Optimization Modes (Long-Only, Sum-to-1)
| Mode | Objective | Needs Expected Returns |
|------|-----------|----------------------|
| Equal Weight | `w_i = 1/N` | No |
| Min Variance | Minimize `w'Σw` via projected gradient descent | No |
| Max Sharpe | Maximize `(w'μ - rf) / √(w'Σw)` | Yes (ML predictions) |
| Risk Parity | Equalize risk contributions `RC_i = w_i × (Σw)_i / σ_p` | No |
| Max Diversification | Maximize `(w'σ) / √(w'Σw)` | No |

### Covariance Methods
- **Ledoit-Wolf Shrinkage** (default): Shrinks sample covariance toward diagonal target
- **EWMA** (λ=0.94): Exponentially weighted, recent data emphasized
- **Sample**: Raw sample covariance (unstable for large N/T ratios)

### Constraint Enforcement
- Iterative projection algorithm (50 rounds) in `applyConstraintsAndNormalize()`
- Box constraints: `[minPos, maxPos]` per position, long-only (default max 20%)
- Sector exposure cap (default 30%)
- When capped positions don't sum to 1, deficit redistributed to zero-weight positions
- **Allocation modes**: "All Included" (minPos=1%, forces every ticker) vs "Allow Zero" (minPos=0, optimizer may exclude)

### Efficient Frontier
- Interactive custom SVG chart with Catmull-Rom splines + Capital Market Line through tangency
- SVG gradient fills, animated pulse on compact diamond portfolio marker
- Weight-proportional asset dots with hover tooltips (ticker, vol, return, weight)
- Mode comparison portfolio positions with permanent abbreviated labels (EW/MV/MS/RP/MD)
- Multi-pass label collision detection for all markers (assets, modes, Min Var, tangency M)

### Investment Intelligence (API-enriched)
The optimize API (`POST /api/portfolio/optimize`) enriches results with:

**Per-Holding Signals** (`holdingSignals[]`):
- **Combined Signal**: 6-source weighted blend [-1, +1] → Strong Buy / Buy / Hold / Sell / Strong Sell
- **ML Signal**: XGB/LGBM ensemble 1-month forecast (thresholds: >4%, >1.5%, >-1.5%, >-4%)
- **Momentum Signal**: Bullish / Neutral / Bearish (from alignment of mom1m/mom6m/mom11m)
- **Valuation Signal**: Cheap / Fair / Expensive — sector-relative z-scores (MAD-based) across E/P, B/M, D/Y, EV/EBITDA, S/P vs OSE sector peers. Z-score breakdown shown per card.
- **Cluster Signal**: OU mean-reversion z-score from spectral clustering
- **Per-holding beta**: Cov(R_i, R_OBX) / Var(R_OBX)
- **Research count**: Documents in last 90 days per holding

**Portfolio Regime** (`regimeContext.portfolioRegime`):
- 3-state multivariate HMM (Bull / Neutral / Crisis)
- Features: cross-sectional returns, realized vol, avg pairwise correlation
- Output: state probs, transition matrix, regime-conditional expected returns

**Cluster Analysis** (`clusterAnalysis`):
- Spectral clustering on residual correlation matrix (market factor removed)
- Auto-selects K clusters via silhouette score
- OU half-life and z-score per cluster for mean-reversion signals

**Mode Comparison** (`modeComparison{}`):
- Server-side runs all 5 optimization modes in parallel
- Returns metrics for each: return, vol, Sharpe, Sortino, drawdown, VaR, effective positions

**Risk Alerts** (`riskAlerts[]`):
- Concentration risk (HHI > 15%)
- Regime risk (>30% holdings in Crisis/Extreme High)
- Sector concentration (>40% single sector)
- Drawdown alert (>20%)
- Negative ML on large positions (>5% weight)
- High portfolio beta (>1.3)

### Dashboard Layout (3-step workflow)
1. **Select Assets**: Ticker search with sector badges, chips with sector-colored borders, clear all
2. **Configure Strategy**: 5 mode cards with icons/descriptions, parameters row (portfolio value, lookback, max position, covariance method, allocation mode)
3. **Results**: 6 key metric cards, secondary metrics strip, save/load portfolio

### Dashboard Sections
- **Saved Portfolios Bar**: Card tiles at top with active state, load/delete
- **Weights Strip**: Compact weight display sorted by allocation
- **Risk Alerts Banner**: Color-coded critical/warning/info alerts
- **Mode Comparison**: Interactive RadarChart (instant hover response) + table with Hist/ML Return & Sharpe; hover highlights radar, click switches strategy with loading bar
- **Portfolio Alpha Intelligence**: Combined 6-source signal gauge, signal distribution bar, per-holding signal cards with component breakdown (ML, MOM, VAL, CLU, REG, CNN), VAL peer z-score breakdown per card (E/P, P/B, DY, EV/EBITDA, S/P with raw values)
- **Efficient Frontier**: Interactive SVG with gradient fills, hover tooltips, mode positions overlay, animated portfolio marker
- **Weight Distribution**: Horizontal bar chart
- **Risk Decomposition**: Sortable table with marginal contribution, component VaR, % of total risk
- **Correlation + Sector**: 2:1 grid with heatmap and pie chart with progress bars
- **Portfolio Regime Panel**: 3-state HMM state probs, transition matrix, regime-conditional returns
- **Cluster Analysis Panel**: Spectral clusters with z-scores, half-lives, MR signals
- **Holdings Regime**: Per-holding volatility regime cards
- **Holdings Table**: Full detail with links to stock pages

### Loading States
- Animated gradient loading bar (fixed top) during strategy switching
- Results sections dim to 40% opacity with pointer-events disabled
- Radar chart responds instantly to hover (no API call needed)

### Sector Browser (Ticker Picker)
- Collapsible "BROWSE BY SECTOR" panel below ticker input
- Stocks grouped by sector with color-coded headers, stock count
- Click stock to add, "ADD ALL" to add entire sector
- Filter + sort (A-Z, Price, Data quality) within browser
- Data quality badges (A/B/C) based on price history rows

### Persistence
- Save/load named portfolios via `portfolio_configs` table (scoped by profile)
- CRUD API at `/api/portfolio/configs` (filtered by JWT profile)

---

## Security

- Rate limiting: 100 req/min (public), 500 req/min (authenticated)
- JWT authentication for protected endpoints
- Password hashing with bcryptjs (research portal)
- Parameterized SQL queries (injection prevention)
- Ticker validation (alphanumeric, max 10 chars)
- Secure error handling (no internal details exposed)
