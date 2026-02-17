# InEqRe (Intelligence Equity Research) v2.3

Quantitative equity research platform for Oslo Stock Exchange (OSE). Combines automated research aggregation, ML price predictions, volatility modeling, and strategy backtesting.

> **Maintenance Note**: Update this file whenever changes are pushed to git. Add new features, APIs, components, or modify existing entries to keep documentation current.

## Tech Stack
- **Frontend**: Next.js 15, React 19, TypeScript, Recharts, Tailwind CSS 4
- **Backend**: Node.js, PostgreSQL 17, Drizzle ORM, Supabase
- **ML**: Python, scikit-learn (Ridge regression, Gradient Boosting, Random Forest)
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
| **Std Channel Strategy** | `/std-channel-strategy` | `apps/web/src/app/std-channel-strategy/page.tsx` |
| **Backtest Results** | `/backtest` | `apps/web/src/app/backtest/page.tsx` |
| **FX Hedging** | `/fx-hedging` | `apps/web/src/app/fx-hedging/page.tsx` |
| **Options List** | `/options` | `apps/web/src/app/options/page.tsx` |
| **Options Analysis** | `/options/[ticker]` | `apps/web/src/app/options/[ticker]/page.tsx` |

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
| `GET /api/volatility/[ticker]` | Volatility metrics (Yang-Zhang, EWMA, etc.) |
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
| `options.ts` | Black-Scholes pricing, IV solver, payoff diagrams, multi-time P&L |
| `parameterValidation.ts` | Strategy parameter validation |
| `market.ts` | Market-level calculations |
| `price-data-adapter.ts` | Price data normalization |

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
| `factor_fundamentals` | B/M, E/P, dividend yield, sales/price, market cap |

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

---

## Data Pipeline

### Data Sources
1. **IBKR Gateway** (port 4002) - Primary real-time data
2. **Yahoo Finance** - Fallback for prices/fundamentals
3. **Norges Bank** - FX rates (NOK/USD, EUR, GBP)
4. **Gmail IMAP** - Research emails from Pareto/DNB

### ML Pipeline (6 steps)
Located in `apps/web/scripts/ml-daily-pipeline.ts`:

1. Calculate technical factors (19 factors)
2. Backfill beta/IVOL
3. Calculate NOK volume
4. Fetch Yahoo fundamentals
5. Refresh materialized view
6. Regenerate ML predictions

**Run**: `pnpm run ml:pipeline` (from apps/web)

### Automation
- **GitHub Actions**: ML pipeline daily at 01:00 UTC, Email import every 10 min
- **Local**: `pnpm run daily-update` (smart IBKR → Yahoo fallback)

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
- **Type**: Ridge regression ensemble (60% GB + 40% RF)
- **Target**: 1-month forward returns
- **Output**: Point estimate + percentiles (p05, p25, p50, p75, p95)
- **Versions**: v2.0_19factor_enhanced, v2.1_optimized (ticker-specific)

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
- Quick add from chain via B/S buttons per strike
- 6 preset strategies with adjustable qty (default 10):
  - Bull Call Spread, Bear Put Spread, Long Straddle, Long Strangle, Iron Condor, Call Butterfly
- Smart strategy builder: skips strikes with no data, uses mid-price for realistic premiums
- Strategies auto-rebuild when switching expiry dates (premiums, costs, breakevens update)
- Each strategy shows description, legs, outlook, risk, cost
- Multi-time payoff diagram (today, 1/3 elapsed, 2/3 elapsed, at expiry)
- Portfolio Greeks per-contract (delta, gamma, theta, vega) — raw Black-Scholes values, not scaled by quantity
- Breakeven points, max profit, max loss (detects unlimited profit/loss via net call exposure)

### Data
- Ticker mapping: `.US` suffix stripped for API calls (e.g., `EQNR.US` → `EQNR` in DB)
- Data from `options_chain` and `options_meta` tables (populated by `fetch-options-daily.ts`)
- Supported tickers: EQNR, BORR, FLNG, FRO (US-listed with valid OI/volume)
- Max pain computed in JS (iterates each strike as hypothetical settlement price)
- OPTN badge on stocks list only shows for `.US`-suffixed tickers

---

## Security

- Rate limiting: 100 req/min (public), 500 req/min (authenticated)
- JWT authentication for protected endpoints
- Password hashing with bcryptjs (research portal)
- Parameterized SQL queries (injection prevention)
- Ticker validation (alphanumeric, max 10 chars)
- Secure error handling (no internal details exposed)
