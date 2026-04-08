# InEqRe (Intelligence Equity Research) v3.1

Quantitative equity research platform for Oslo Stock Exchange (OSE). Combines automated research aggregation, ML price predictions, volatility modeling, and strategy backtesting.

> **Maintenance Note**: Update this file whenever changes are pushed to git. Add new features, APIs, components, or modify existing entries to keep documentation current.

> **Recent Updates (2026-04-08)**: 
> - Fixed Supabase RLS security: Enabled Row-Level Security on 6 tables (`orderflow_ticks`, `orderflow_bars`, `orderflow_depth_snapshots`, `orderflow_signals`, `orderflow_iceberg_detections`, `live_trade_signals`)
> - Cleaned up orderflow data: Removed 1.2M duplicate trades from historical import errors. Added `UNIQUE (ticker, ts, price, size)` constraint to `orderflow_ticks` and fixed `ON CONFLICT` clause in fetch script to prevent future duplicates.

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
| **Homepage** | `/` | `apps/web/src/app/page.tsx` (max 3 tags per feature card) |
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
| **Alpha Engine** | `/alpha` | `apps/web/src/app/alpha/page.tsx` — 4 tabs: Strategy (optimized top 10 + paper trading + equity curve), Signals, Explorer, Simulator |
| **FX Terminal** | `/fx` | `apps/web/src/app/fx/page.tsx` |
| **Options List** | `/options` | `apps/web/src/app/options/page.tsx` |
| **Options Analysis** | `/options/[ticker]` | `apps/web/src/app/options/[ticker]/page.tsx` |
| **Portfolio Optimizer** | `/portfolio` | `apps/web/src/app/portfolio/page.tsx` |
| **Intelligence Terminal** | `/news` | `apps/web/src/app/news/page.tsx` |
| **Seafood Intelligence** | `/seafood` | `apps/web/src/app/seafood/page.tsx` |
| **Shipping Intelligence** | `/shipping` | `apps/web/src/app/shipping/page.tsx` |
| **Commodity Terminal** | `/commodities` | `apps/web/src/app/commodities/page.tsx` |
| **Commodity Detail** | `/commodities/[symbol]` | `apps/web/src/app/commodities/[symbol]/page.tsx` |
| **Sector Intelligence** | `/sectors` | `apps/web/src/app/sectors/page.tsx` |
| **Financials Intelligence** | `/financials` | `apps/web/src/app/financials/page.tsx` |

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
| `GET /api/alpha/top-performers` | Walk-forward trade sim on top 50 liquid OSE (fixed params, 12M) |
| `GET /api/alpha/best-stocks` | Top 10 OSE stocks by 365d return × Sharpe (cache key `best_stocks_v12_maxreturn`, 25h TTL). Entry >0.25%, exit <-0.5%, 2% stop, 25% TP, 30d max hold. Filters: Sharpe ≥ 0.8, WinRate ≥ 48%, MaxDD ≥ -10%, positive return. Ranking: `totalReturn × max(sharpe, 0.1)`. ML signal priority: real ensemble_prediction → factor_technical mom6m → LAG(126) price mom × 0.15. |
| `GET /api/alpha/simulator/[ticker]` | Per-ticker SimInputBar[] for client-side ML trading simulation |
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
| `GET /api/research/price-targets/[ticker]` | Parsed Xtrainvestor price target changes for a ticker (last 90d) |

### Portfolio APIs
| Endpoint | Purpose |
|----------|---------|
| `POST /api/portfolio/optimize` | Mean-variance optimization — **public, no auth required** |
| `POST /api/portfolio/analyze` | Manual portfolio analysis: risk metrics, historical series, mode comparison, ML forecast |
| `POST /api/portfolio/backtest` | Walk-forward ML backtest for portfolio: 4 strategies (Static, ML-Tilted, ML Long-Only, OBX), monthly breakdown, per-ticker accuracy |
| `POST /api/portfolio/auth` | Optional login for save/load (JWT 8h) |
| `GET /api/portfolio/configs` | List saved portfolios (auth required) |
| `POST /api/portfolio/configs` | Save portfolio (auth required) |
| `GET /api/portfolio/configs/[id]` | Load specific portfolio (auth required) |
| `PUT /api/portfolio/configs/[id]` | Update portfolio (auth required) |
| `DELETE /api/portfolio/configs/[id]` | Delete portfolio (auth required) |

### News & Intelligence APIs
| Endpoint | Purpose |
|----------|---------|
| `GET /api/news` | AI-classified news feed (severity, sentiment, ticker/sector mapping) |
| `GET /api/news/ticker/[ticker]` | Per-ticker news: merges IBKR news + NewsWeb filings, sorted by date |
| `GET /api/shorts` | Latest short positions for all stocks (Finanstilsynet SSR) |
| `GET /api/shorts/[ticker]` | Per-stock short position history with holder breakdown |
| `GET /api/commodities` | All commodity prices (17 symbols) with multi-period returns, sparklines, stock sensitivity |
| `GET /api/commodities/[symbol]` | Per-commodity detail with price history, SMAs, and stock betas |
| `GET /api/commodities/correlation` | NxN Pearson correlation matrix on log-returns (?days=90, ?equities=EQNR,MOWI) |
| `GET /api/sectors/overview` | Per-sector aggregate intelligence: performance, commodity driver, best/worst |

### FX APIs
| Endpoint | Purpose |
|----------|---------|
| `GET /api/fx-pairs` | FX pair data (legacy, still active) |
| `GET /api/fx-hedging/exposures` | FX exposure analysis (legacy) |
| `GET /api/fx/dashboard` | FX Terminal dashboard: rates, TWI, correlations, regimes, exposure heatmap, **+ fundingRegimes** (CB balance sheet / GDP per currency) |
| `GET /api/fx/rates/forward?pair=NOKUSD` | Forward rates at 1M/3M/6M/12M via covered IRP, **+ basisDecomposition** per tenor (OIS basis, implementable basis, arb flags) |
| `GET /api/fx/sensitivity/[ticker]` | Multi-currency regression betas + fundamental exposure + divergences |
| `GET /api/fx/exposure/[ticker]` | Revenue/cost breakdown from fx_fundamental_exposure |
| `POST /api/fx/portfolio` | Portfolio FX VaR, weighted exposure, stress scenarios (body: tickers + weights) |
| `POST /api/fx/hedge-calculator` | Forward hedge P&L scenarios, cost, break-even (body: ticker + params) |
| `GET /api/fx/carry?pair=NOKUSD&days=252` | Carry trade metrics: carry, Sharpe, cumulative P&L, **+ carryDecomposition** (gross/net-high/net-mid bps, CP-OIS from Rime et al. 2022 Table 1) |
| `GET /api/fx/interest-rates` | Current rates per currency/tenor from interest_rates table |
| `GET /api/fx/basis?pair=NOKUSD&tenor=3M` | 90-day cross-currency basis (CIP deviation) series + summary (current, avg30d, pct rank) |
| `GET /api/fx/arb-monitor?tenor=3M` | CIP arbitrage profit per pair: forward premium − (OIS + CP-OIS − foreign CB deposit); signal POSITIVE_ARB / MARGINAL / NO_ARB |
| `POST /api/fx/hedge-calculator` | Forward hedge P&L + **+ quarterEndWarning** (crosses QE, days until, basis widening 40-71 bps estimate) |

### Seafood APIs
| Endpoint | Purpose |
|----------|---------|
| `GET /api/seafood/overview` | Dashboard summary (price, lice avg, traffic lights) |
| `GET /api/seafood/salmon-price` | Salmon commodity price history |
| `GET /api/seafood/lice` | Industry lice levels (weekly) |
| `GET /api/seafood/production-areas` | 13 production area details + traffic lights |
| `GET /api/seafood/localities` | Fish farm sites with lice data |
| `GET /api/seafood/company-exposure` | Per-company seafood risk metrics |
| `GET /api/seafood/diseases` | Disease outbreak tracker (PD/ILA) |
| `GET /api/seafood/biomass` | Biomass by area, national trend, YoY (Fiskeridirektoratet) |
| `GET /api/seafood/harvest` | Harvest volumes, mortality rates, feed conversion |
| `GET /api/seafood/export` | SSB salmon export price + volume (weekly) |
| `GET /api/seafood/ocean` | Sea temperature by production area (weekly) |
| `GET /api/seafood/quarterly-ops` | Quarterly company ops (EBIT/kg, harvest, cost/kg) from earnings reports |
| `GET /api/seafood/spot-prices` | Fish Pool SISALMON weekly spot prices by weight class (NOK/EUR) |
| `GET /api/seafood/forward-prices` | Fish Pool forward curve (EUR/tonne) with w/w change |
| `GET /api/seafood/price-estimates` | Pareto quarterly/annual salmon price estimates + spot history |
| `GET /api/seafood/harvest-tracker/live` | Live wellboat positions (join harvest_vessels + shipping_positions) |
| `GET /api/seafood/harvest-tracker/vessels` | Harvest vessel registry |
| `GET /api/seafood/harvest-tracker/slaughterhouses` | Slaughterhouse locations with production area |
| `GET /api/seafood/harvest-tracker/trips` | Detected farm→slaughterhouse trips with price matching |
| `GET /api/seafood/harvest-tracker/estimates` | Quarterly harvest estimates vs actuals per company |
| `GET /api/seafood/harvest-tracker/activity` | Daily harvest activity for charts + spot price overlay |
| `GET /api/seafood/harvest-tracker/vessel-history` | Vessel detail: specs, position history, trip log, 12-month stats |

### Shipping APIs
| Endpoint | Purpose |
|----------|---------|
| `GET /api/shipping/overview` | Fleet KPIs, BDI/BDTI/BCTI indices with change |
| `GET /api/shipping/companies` | All companies with fleet stats, latest rates, stock price |
| `GET /api/shipping/companies/[ticker]` | Company detail: vessels, contracts, quarterly rates |
| `GET /api/shipping/positions` | Vessel positions with contract/rate data (for map) |
| `GET /api/shipping/vessels` | Vessel list with contract info, filterable |
| `GET /api/shipping/rates/market` | Market rate time series (BDI/BDTI/BCTI) |
| `GET /api/shipping/rates/company` | Company quarterly TCE data |
| `GET /api/shipping/contracts` | Vessel contracts with rate vs spot comparison |
| `GET /api/shipping/ports` | Reference ports |
| `GET /api/shipping/exposure-matrix` | Company x vessel_class rate heatmap |

### Financials APIs
| Endpoint | Purpose |
|----------|---------|
| `GET /api/financials/overview` | Company cards (price, returns, fundamentals, ML signal, shorts), rate snapshot, sector performance, recent news |
| `GET /api/financials/rates` | Interest rate environment: current rates, yield curve, 2Y history, OLS rate sensitivity heatmap, cross-currency comparison |
| `GET /api/financials/comparison` | Full scorecard: all sector stocks with fundamentals + technicals + price returns |
| `GET /api/financials/signals` | ML predictions (full distribution), short interest with history + holders, insider transactions, auto-generated risk alerts |
| `GET /api/financials/macro` | FX rates + 90d history, CB balance sheet regimes, oil/commodity exposure betas, FX revenue breakdown |

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
| `fxPairCalculations.ts` | Forward pricing, IRP, **+ calculateCrossCurrencyBasis** (LOOP deviation bps), **+ decomposeBasis** (OIS vs implementable, arb flags), **+ decomposeCarry** (gross/net carry after CP-OIS funding cost) |
| `fxTerminal.ts` | Multi-currency OLS regression, NOK TWI, portfolio FX VaR, carry trade metrics, hedge cost/break-even, **+ quarter-end utilities** (getNextQuarterEnd, hedgeCrossesQuarterEnd, quarterEndBasisWidening — 40/71/55 bps from Rime et al. 2022 Table 7) |
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
| `orderflow.ts` | Intraday orderflow models: Bulk Volume Classification (BVC), VPIN rolling windows, Kyle's Lambda (OLS price impact), Amihud illiquidity by bar, trade informativeness, intraday regime classification (6 regimes), TWAP/VWAP execution detection, stealth accumulation, momentum ignition, algo fingerprints (4 patterns), iceberg detection, OFI proxy |
| `shippingTCE.ts` | Baltic Exchange-based TCE calculation library: Worldscale→TCE formula, 14 vessel types, 10 reference routes (TD3C/TD20/TD6/TC1/C5 etc), VLSFO bunker cost, voyage costs, fleet quarterly earnings aggregation |
| `sectorMapping.ts` | Sector-commodity-ticker mapping constants: 4 sectors (Energy/Seafood/Shipping/Materials), 17 commodities with metadata (category/importance/unit), used by commodity & sector dashboards |

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

### Portfolio
- `ManualWeightEditor.tsx` - Spreadsheet editor for manual portfolio weights/amounts/shares with auto-calculation. Accepts `externalWeights` prop to sync from APPLY buttons.
- `PortfolioPerformanceChart.tsx` - Multi-line cumulative returns chart (per-stock + portfolio + OBX benchmark), sorted tooltip (highest return first)
- `PortfolioComparisonPanel.tsx` - Side-by-side metrics comparison with APPLY ALL / per-stock APPLY buttons (syncs to weight editor)

### Harvest Tracker
- `HarvestMap.tsx` - Map wrapper with company filter bar, vessel status counts (dynamic import, no SSR)
- `HarvestMapInner.tsx` - react-leaflet Norway map with farms, slaughterhouses, vessel positions, trip lines, route trails, vessel click interaction

### Shipping
- `ShippingMap.tsx` - Map wrapper with sector/company filter bars (dynamic import, no SSR)
- `ShippingMapInner.tsx` - react-leaflet global vessel map, dark theme, vessel/port markers with rich popups

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
| `research_documents` | Broker research with full-text search, target_price, rating, source_url (dedup for scraped reports) |
| `research_attachments` | PDF files with storage paths |
| `research_access_tokens` | Password-protected access control |

### FX Tables
| Table | Purpose |
|-------|---------|
| `fxSpotRates` | Daily spot rates (NOK base: NOKUSD, NOKEUR, NOKGBP, NOKSEK, NOKDKK) |
| `interestRates` | Policy/market rates by currency, tenor, source |
| `fxForwardRates` | Computed forward rates |
| `stockFxExposure` | Currency revenue breakdown per stock (simple) |
| `fxFundamentalExposure` | Revenue + cost currency splits, net exposure, EBITDA/EPS sensitivity |
| `fxRegressionResults` | Multi-currency regression: joint β_mkt/USD/EUR/GBP/SEK, t-stats, R², partial R² |
| `fxCurrencyBetas` | Rolling single-pair currency betas |
| `fxOptimalHedges` | Optimal hedge ratios |
| `fxMarketRegimes` | Market regime classification |
| `cb_balance_sheets` | Central bank balance sheet / GDP ratios by currency (USD/EUR/JPY/GBP/CHF/NOK); regime classification per Rime et al. (2022) Table 4 |

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
| `orderflow_ticks` | Intraday tick-by-tick trades: ticker, ts (UTC), price, size, side (1=buy/-1=sell/0=unknown). Populated by `fetch-euronext-orderflow.ts` from Euronext Live |

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

### Seafood Tables
| Table | Purpose |
|-------|---------|
| `seafood_production_areas` | 13 Norwegian coastal zones with traffic light status |
| `seafood_localities` | Fish farm sites (BarentsWatch/Fiskeridirektoratet) |
| `seafood_lice_reports` | Weekly sea lice counts per locality (BarentsWatch) |
| `seafood_diseases` | Disease outbreak reports (PD, ILA) |
| `seafood_company_metrics` | Aggregated per-company seafood risk metrics |
| `seafood_biomass_monthly` | Monthly biomass/harvest/mortality by production area (Fiskeridirektoratet) |
| `seafood_export_weekly` | Weekly salmon export price+volume (SSB table 03024) |
| `seafood_ocean_conditions` | Sea temperature aggregated per area per week |
| `salmon_quarterly_ops` | Company quarterly ops data from earnings reports (EBIT/kg, harvest, cost/kg) |
| `salmon_spot_weekly` | Fish Pool SISALMON weekly spot by weight class (NOK + EUR) |
| `salmon_forward_prices` | Fish Pool forward curve (EUR/tonne per period) |
| `salmon_export_volumes` | Fish Pool weekly export volumes (this year vs last) |
| `salmon_price_estimates` | Pareto quarterly price estimates (NOK/EUR, supply growth, spot) |

### Harvest Tracker Tables
| Table | Purpose |
|-------|---------|
| `harvest_vessels` | Wellboat registry (name, IMO, MMSI, owner, capacity, vessel_type) |
| `harvest_slaughterhouses` | Processing plants (name, ticker, lat/lng, capacity_tonnes_day) |
| `harvest_trips` | Detected farm→slaughterhouse trips (vessel, origin, destination, times, volume, spot price) |
| `harvest_vessel_positions` | AIS position history for route visualization and trip detection |
| `harvest_quarterly_estimates` | Per-company per-quarter aggregates (est. harvest, trip count, VWAP, vs actuals) |

### Shipping Tables
| Table | Purpose |
|-------|---------|
| `shipping_companies` | OSE-listed shipping companies (sector, fleet size, color) |
| `shipping_vessels` | Individual vessels (IMO, DWT/TEU, type, class, built year) |
| `shipping_positions` | AIS-derived vessel positions (lat/lon, speed, heading, destination) |
| `shipping_vessel_contracts` | Charter contracts (TC/SPOT/COA, rate, charterer, expiry) |
| `shipping_company_rates` | Quarterly company TCE rates by vessel class |
| `shipping_market_rates` | Daily market rate indices (BDI, BDTI, BCTI) |
| `shipping_ports` | Reference ports with coordinates and sector |

---

## Data Pipeline

### Data Sources
1. **IBKR Gateway** (port 4002) - Primary real-time data
2. **Yahoo Finance** - Fallback for prices/fundamentals + commodity OHLCV (15 symbols: BZ=F, CL=F, NG=F, RB=F, HO=F, TTF=F, MTF=F, ALI=F, GC=F, SI=F, HG=F, TIO=F, LBR=F, ZS=F, ZW=F)
2b. **TradingEconomics** - Web scraper for Steel (CNY/t), HRC Steel (USD/t), Iron Ore (USD/t) — commodities not on Yahoo
3. **Norges Bank** - FX rates (NOK/USD, EUR, GBP)
4. **Gmail IMAP** - Research emails from Pareto/DNB/Arctic/ABG/SpareBank 1/Redeye/MFN
5. **Redeye GraphQL** - Commissioned research scraper (redeye.se/api/graphql, OSE-only filter)
6. **DNB Carnegie Access** - Commissioned research via REST API (sitemap + /carnegie-api/, NO-country filter, PDF download)
7. **DNB Markets Research** - Macro/FI/currencies analysis PDFs via public getreport.aspx endpoint (MRP_XXXXXX IDs, Referer-gated)
8. **Finanstilsynet SSR** - Short selling positions (`https://ssr.finanstilsynet.no/api/v2/instruments`)
9. **BarentsWatch** - Seafood lice, disease, locality data (OAuth2 client_credentials)
7. **Fiskeridirektoratet** - Monthly biomass/harvest/mortality CSV (no auth, free)
8. **SSB (Statistics Norway)** - Weekly salmon export price+volume via PxWebApi v2 (no auth, free)
9. **Euronext Live** - Intraday tick-by-tick trade data for OSE equities. CSV endpoint: `https://live.euronext.com/en/ajax/AwlIntradayPrice/getFullDownloadAjax/{ISIN}-XOSL?format=csv&full_dl_date=YYYY-MM-DD`. JSON fallback: POST `getIntradayPriceFilteredData`. Stores to `orderflow_ticks`. Run via `pnpm run flow:fetch`

### ML Pipeline (7 steps)
Located in `apps/web/scripts/ml-daily-pipeline.ts`:

1. Calculate technical factors (19 factors)
2. Backfill beta/IVOL
3. Calculate NOK volume
4. Fetch Yahoo fundamentals
5. Refresh materialized view
6. Regenerate ML predictions
7. FX multi-currency regressions (non-critical)

**Run**: `pnpm run ml:pipeline` (from apps/web)

### Intelligence Data Pipeline (daily)
Run after market close alongside ML pipeline:

1. **Short positions**: `pnpm run shorts:fetch` — Finanstilsynet SSR API (no auth, free JSON)
2. **Commodity prices**: `pnpm run commodities:fetch` — Yahoo Finance OHLCV + stock sensitivity regression
3. **News**: `pnpm run news:fetch` — IBKR news headlines with AI classification
4. **NewsWeb filings**: `pnpm run newsweb:fetch` — Oslo Børs regulatory filings (insider trades, earnings, buybacks, dividends)

### Automation
- **GitHub Actions**:
  - ML + prices: daily at 16:00 UTC (17:00 CET / after market close)
  - Email import: every 10 min (research PDFs including Pareto Shipping Daily)
  - **Shipping midday**: Mon–Fri at 10:00 UTC (11:00 CET / 12:00 CEST) — parses latest Pareto Shipping Daily PDF + fetches Ship & Bunker prices
  - Seafood: weekly Wednesday 12:00 UTC + monthly 21st
- **Local**: `pnpm run daily-update` (smart IBKR → Yahoo fallback)
- **Intelligence data**: Run `shorts:fetch` + `commodities:fetch` + `newsweb:fetch` daily after prices are updated

---

## Key Scripts

### apps/web/scripts/
| Script | Purpose |
|--------|---------|
| `ml-daily-pipeline.ts` | Master ML orchestrator (6 steps) |
| `precompute-alpha.ts` | Nightly precompute for alpha best-stocks cache (v12). Mirrors `api/alpha/best-stocks/route.ts` logic. Runs at 02:00 UTC via GitHub Actions. Entry 0.25%, 2% stop, 25% TP, 30d hold, ranked by totalReturn × Sharpe. |
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
| `seed-fx-exposures.ts` | Seed fx_fundamental_exposure for ~23 major OSE companies (revenue/cost splits) |
| `seed-fx-interest-rates.ts` | Seed interest_rates with policy/market rates for NOK/USD/EUR/GBP/SEK/DKK |
| `calculate-fx-regressions.ts` | Rolling multi-currency regression pipeline (252D windows, 21D step) |
| `fetch-ssr-shorts.ts` | Fetch short positions from Finanstilsynet SSR API |
| `fetch-commodities.ts` | Fetch 17 commodity prices from Yahoo + SSB + TradingEconomics scraper (Steel) + calculate stock sensitivity |
| `fetch-newsweb-filings.ts` | Fetch regulatory filings from Oslo Børs NewsWeb API into `newsweb_filings` |
| `fetch-barentswatch-seafood.ts` | Fetch lice/disease/locality data from BarentsWatch (OAuth2) |
| `fetch-biomass-fiskeridir.ts` | Fetch monthly biomass/harvest/mortality from Fiskeridirektoratet (no auth) |
| `fetch-ssb-salmon-export.ts` | Fetch weekly salmon export price+volume from SSB PxWebApi (no auth) |
| `fetch-ocean-conditions.ts` | Aggregate sea temperature from lice reports by production area |
| `fetch-redeye-research.ts` | Scrape commissioned research from Redeye (GraphQL API, OSE-only filter) |
| `fetch-dnb-carnegie-research.ts` | Scrape commissioned research from DNB Carnegie Access (sitemap + REST API, NO-country filter, PDF download) |
| `fetch-dnb-markets-research.ts` | Scrape DNB Markets macro/FI research PDFs (public getreport.aspx, ID range scan, pdftotext metadata extraction) |
| `fetch-shipping-rates.ts` | Fetch BDI market rate from Yahoo Finance (`^BDI`), store in `shipping_market_rates` |
| `fetch-ais-positions.ts` | AISStream.io WebSocket snapshot: connects for 5min, collects real vessel positions |
| `lookup-vessel-mmsi.ts` | Resolve vessel IMO→MMSI via Digitraffic + verified manual table |
| `fetch-vessel-positions.ts` | Digitraffic AIS positions (Finnish coastal range) |
| `parse-shipping-daily.ts` | Parse Pareto Shipping Daily PDFs: 16+ rate indices + BCI/BDTI/BCTI + VLSFO bunker prices (BDI bug fix: capped at 12,000, excludes subindex lines) |
| `fetch-bunker-prices.ts` | Scrape VLSFO/HSFO/MGO bunker prices from Ship & Bunker (Singapore/Rotterdam/Fujairah/Houston), store in `shipping_market_rates` as usd_per_tonne |
| `fetch-fishpool-reports.ts` | Fetch Fish Pool SISALMON + Price Status PDFs from IMAP, parse spot prices by weight class, forward curve, export volumes |
| `parse-pareto-seafood.ts` | Parse Pareto Seafood Weekly PDFs from research portal for quarterly salmon price estimates (NOK/EUR/supply growth) |
| `seed-cb-balance-sheets.ts` | Seed CB balance sheet / GDP ratios for 6 currencies (Fed/ECB/BoJ/BoE/SNB/NB); regime thresholds from Rime et al. (2022) Table 4 |
| `seed-harvest-data.ts` | Seed wellboat fleet (~30 vessels) and slaughterhouse locations (~18 plants) |
| `lookup-harvest-mmsi.ts` | Resolve wellboat names → MMSI via Digitraffic + manual lookup |
| `fetch-harvest-positions.ts` | AIS-based trip detection: proximity state machine (farm→slaughterhouse) with spot price matching |
| `aggregate-harvest-estimates.ts` | Quarterly aggregation: trip volumes → per-company estimates vs actuals |
| `fetch-euronext-orderflow.ts` | Fetch intraday tick-by-tick trade data from Euronext Live for OSE equities (CSV/JSON endpoints). Uses tick-rule side classification. Stores to `orderflow_ticks` table with deduplication on `(ticker, ts, price, size)` unique constraint. CLI: `--ticker`, `--date`, `--all`, `--backfill N`, `DRYRUN=1` |
| `analyze-orderflow.ts` | Phase 3/4 orderflow intelligence report (terminal, ANSI colors). Builds 1min/5min/volume bars, computes BVC, VPIN, Kyle's Lambda, Amihud, trade informativeness, detects TWAP/VWAP execution windows, stealth accumulation, momentum ignition, algo fingerprints, icebergs, OFI proxy. |
| `generate-synthetic-ticks.ts` | Generate synthetic tick data for orderflow backtesting |
| `backtest-orderflow.ts` | Backtest orderflow signals (BVC, VPIN, Kyle's Lambda) on tick data |

### scripts/
| Script | Purpose |
|--------|---------|
| `email-processor.js` | Import research emails via IMAP (--backfill-all for full 2026 rescan) |
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
pnpm run research:redeye    # Fetch Redeye commissioned research (OSE-only)
pnpm run research:redeye:backfill  # Backfill all Redeye history
pnpm run research:redeye:list      # List OSE company matches
pnpm run research:carnegie  # Fetch DNB Carnegie Access Norwegian research (2026+)
pnpm run research:carnegie:dry    # Dry run (scan only)
pnpm run research:carnegie:stats  # Show country distribution
pnpm run research:carnegie:all    # Include all Nordic (SE/NO/FI/DK)
pnpm run research:dnb-markets     # Fetch DNB Markets macro research PDFs (2026+)
pnpm run research:dnb-markets:dry # Dry run (scan only)
pnpm run research:dnb-markets:all # Include all macro (no Norway keyword filter)
pnpm run research:dnb-markets:back # Scan further back (older IDs from 260000)
pnpm run shipping:rates     # Fetch BDI from Yahoo Finance
pnpm run shipping:parse-daily     # Parse latest Pareto Shipping Daily PDF rates
pnpm run shipping:parse-daily:all # Backfill all historical Pareto reports
pnpm run shipping:parse-daily:dry # Dry run (parse only, no DB insert)
pnpm run fishpool:fetch            # Fetch Fish Pool SISALMON + forward prices from IMAP
pnpm run fishpool:fetch:dry        # Dry run
pnpm run fishpool:fetch:backfill   # Backfill historical reports
pnpm run pareto:seafood            # Parse Pareto Seafood Weekly price estimates
pnpm run pareto:seafood:dry        # Dry run
pnpm run pareto:seafood:all        # Process all historical reports
pnpm run ais:lookup-mmsi          # Resolve & populate vessel MMSIs
pnpm run ais:lookup-mmsi:dry      # Dry run (show matches, no DB changes)
pnpm run ais:snapshot             # AISStream.io WebSocket position snapshot (5min)
pnpm run ais:snapshot:dry         # Dry run (connect & collect, no DB write)
pnpm run ais:digitraffic          # Digitraffic AIS positions (Finnish range)
pnpm run harvest:seed             # Seed wellboats + slaughterhouses
pnpm run harvest:lookup-mmsi      # Resolve wellboat MMSIs
pnpm run harvest:track            # Run AIS trip detection (long-running)
pnpm run harvest:aggregate        # Aggregate quarterly harvest estimates
pnpm run fx:seed-exposures        # Seed FX fundamental exposures (23 companies)
pnpm run fx:seed-rates            # Seed interest rates (NOK/USD/EUR/GBP/SEK/DKK)
pnpm run fx:seed-cb               # Seed CB balance sheet / GDP ratios (6 currencies)
pnpm run fx:seed-cb:dry           # Dry run
pnpm run fx:regression            # Run FX multi-currency regression pipeline
pnpm run fx:regression:dry        # Dry run (no DB writes)
pnpm run flow:fetch               # Fetch Euronext intraday ticks for today (default EQNR)
pnpm run flow:fetch:dry           # Dry run (parse only, no DB insert)
pnpm run flow:analyze             # Run orderflow intelligence report (terminal output)
pnpm run flow:backtest            # Backtest orderflow signals on tick data
pnpm run flow:backtest:dry        # Dry run orderflow backtest
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

Located at `/portfolio`. Open access — anyone can optimize. Optional sign-in to save/load named portfolios.

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

### Manual Portfolio Mode
Toggle between OPTIMIZER and MANUAL PORTFOLIO at the top. Manual mode provides two tabs:

**ANALYSIS Tab:**
- **Weight Editor**: Spreadsheet-style table — edit Weight %, Amount (NOK), or Shares per holding; other two auto-calculate. Text-based inputs allow clearing zeros. Normalize/Equal Weight buttons. APPLY buttons sync weights back to editor.
- **Historical Performance**: Multi-line Recharts chart with per-stock actual returns (unweighted) + portfolio total + OBX benchmark. Tooltip sorted by return value. Timeframe buttons (3M/6M/1Y/2Y/ALL).
- **Optimal Adjustment Suggestions**: Side-by-side YOUR PORTFOLIO vs suggested (EW/MV/MS/RP/MD). APPLY ALL button replaces all weights; per-stock APPLY buttons for selective changes. Auto-re-analyzes after applying.
- **ML Forecast**: Aggregate weighted portfolio forecast + per-holding table.
- **Risk Decomposition, Correlation, Sector Allocation**: Same as optimizer mode.
- **API**: `POST /api/portfolio/analyze` — computes metrics, historical series, mode comparison, ML forecast for user-supplied weights.

**ML BACKTEST Tab:**
- **Walk-Forward Backtest**: Uses `backtest_predictions` table (monthly prediction/actual pairs) to simulate portfolio strategies.
- **4 Strategies Compared**: Static Weights (hold user weights), ML-Tilted (5x tilt by prediction signal), ML Long-Only (exclude negative predictions), OBX Benchmark.
- **Strategy Stats Cards**: Total return, annualized return, volatility, Sharpe, max drawdown, win rate per strategy.
- **Cumulative Returns Chart**: LineChart with all 4 strategies, sorted tooltip.
- **Strategy Explanations**: Color-coded 2x2 grid explaining each strategy below the chart.
- **Monthly Breakdown**: Collapsible table with per-month returns for each strategy, hit rate, ticker coverage.
- **Per-Ticker Accuracy**: Collapsible table with hit rate, MAE, avg prediction vs actual, best/worst month per holding.
- **API**: `POST /api/portfolio/backtest` — accepts tickers + weights, returns cumulative series, strategy stats, monthly breakdown, per-ticker accuracy.

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

## Financials & Insurance Intelligence Details

Located at `/financials`. Monolithic "use client" page following the shipping/seafood terminal pattern. Accent color: `#6366f1` (indigo).

### Companies Tracked (12 OSE-Listed)
- **Banks (7)**: DNB, NOBA (Nordea), MING (SpareBank 1 SMN), SRBNK (SpareBank 1 SR-Bank), NOFI (SpareBank 1 Nord-Norge), HELG (SpareBank 1 Helgeland), PARB (Pareto Bank)
- **Insurers (3)**: GJENSIDI (Gjensidige), STB (Storebrand), PROTCT (Protector Forsikring)
- **Financial Services (2)**: AKER (Aker ASA), ABG (ABG Sundal Collier)

### 5 Tabs
1. **OVERVIEW** -- KPI strip (NB policy rate, NIBOR 3M, sector daily return, sector YTD), horizontal bar chart sorted by daily return, company grid cards with 90d sparklines, news feed
2. **RATES** -- Rate strip, yield curve (LineChart), 2Y rate history (stepAfter for policy, monotone for NIBOR), OLS rate sensitivity heatmap (stock returns vs NIBOR 3M first-differences), scenario calculator with bps slider, cross-currency comparison table
3. **SCORECARD** -- Sub-sector filter (all/bank/ins/fin), sortable comparison table (11 columns), valuation scatter (P/E vs Mom6M), momentum grouped bars
4. **SIGNALS** -- Risk alert banner, ML prediction grid cards with signal labels (STRONG BUY to STRONG SELL), short interest table with expandable holders, insider transactions table
5. **MACRO** -- FX strip (4 pairs), FX history dual-axis chart (90d), CB balance sheet regime table, oil/commodity exposure table, FX revenue heatmap

### Data Sources
- All data from existing DB tables (no new tables or dependencies)
- Rate sensitivity computed server-side via OLS regression (min 60 aligned observations)
- Interest rates stored as decimals (0.045 = 4.5%), multiplied by 100 for display
- Tickers validated per API call -- only those present in `stocks` table are queried

---

## Shipping Intelligence Details

Located at `/shipping`. Monolithic "use client" page following the seafood terminal pattern.

### Companies Tracked (10 OSE-Listed)
FRO (Frontline), HAFNI (Hafnia), FLNG (Flex LNG), SOFF (Solstad Offshore), BORR (Borr Drilling), DOFG (DOF Group), 2020 (2020 Bulkers), HAVI (Havila Shipping), GOGL (Golden Ocean), MPCC (MPC Container Ships)

### 4 Tabs
1. **OVERVIEW** — Fleet KPIs (vessels, utilization, at-sea %), BDI/BDTI/BCTI index cards with change, company grid with stock price + fleet stats
2. **MAP & FLEET** — Global react-leaflet map with vessel markers colored by company, sector/company filter bars, vessel popups showing charter rate, destination, contract info
3. **RATES** — Market rate time series charts (mini SVG sparklines) with timeframe selector (7D/30D/90D/1Y/ALL, default 30D), quarterly company TCE comparison table, rate exposure heatmap (company x vessel_class, colored by delta vs spot)
4. **CONTRACTS** — Contract expiry tracking, grouped by company, rate vs spot comparison, days remaining color-coded (green >180d, yellow 60-180d, red <60d)

### Data Sources
- **Seed data**: Static vessel fleet, positions, contracts, quarterly TCE rates (from company reports)
- **Yahoo Finance**: BDI index (`^BDI`) via `fetch-shipping-rates.ts`
- **Pareto Shipping Daily PDFs**: 16+ rate indices (VLCC, Suezmax, Aframax, LR2, MR, BDI, Capesize, Panamax, Ultramax, VLGC, LNG, Brent, WTI, Iron Ore, Henry Hub, TTF) via `parse-shipping-daily.ts`
- **AISStream.io**: Real-time global AIS positions via WebSocket (`fetch-ais-positions.ts`, needs API key)
- **Digitraffic**: Finnish AIS receiver range, free IMO→MMSI lookup (`fetch-vessel-positions.ts`)
- **Future**: Kystverket AIS (free Norwegian government, Norwegian waters supplement)

### Map Implementation
- `ShippingMap.tsx` wrapper (dynamic import, no SSR) with sector/company filter bars
- `ShippingMapInner.tsx`: react-leaflet `MapContainer` center `[25,20]` zoom 2, dark theme via CSS filter, `FlyToVessel` animation, vessel `CircleMarker` with radius by DWT, rich `Popup` with rate/contract info

---

## UI Style Guide (Standard for All Pages)

All pages must follow this dark terminal theme. Reference: `/portfolio` and `/fx` pages.

### Colors
| Token | Value | Usage |
|-------|-------|-------|
| **Background** | `#0a0a0a` | Page background |
| **Card** | `#161b22` | Card/panel background |
| **Card border** | `#30363d` | Borders, dividers |
| **Inner card** | `#0d1117` | Metric cards, inputs, nested panels |
| **Inner border** | `#21262d` | Subtle inner borders |
| **Accent** | `#3b82f6` | Primary accent (links, active tabs, highlights) |
| **Accent dark** | `#2563eb` | Gradient end for buttons |
| **Success** | `#10b981` | Positive values, green indicators |
| **Danger** | `#ef4444` | Negative values, errors |
| **Warning** | `#f59e0b` | Amber warnings |
| **Text** | `#fff` | Primary text |
| **Muted** | `rgba(255,255,255,0.5)` | Secondary labels, inactive tabs |
| **Dim** | `rgba(255,255,255,0.4)` | Tertiary labels, placeholders |
| **Faint** | `rgba(255,255,255,0.35)` | Subtle hints |

### Typography
- **Font**: `monospace` (system monospace stack)
- **Page title**: `fontSize: 22`, `fontWeight: 700`
- **Section title**: `fontSize: 11`, `fontWeight: 700`, `rgba(255,255,255,0.6)`, `letterSpacing: "0.08em"`, `textTransform: "uppercase"`
- **Table header**: `fontSize: 9`, `fontWeight: 600`, `rgba(255,255,255,0.5)`, `letterSpacing: "0.05em"`, `textTransform: "uppercase"`
- **Body text**: `fontSize: 11-12`
- **Labels**: `fontSize: 9-10`, `rgba(255,255,255,0.4)`
- **Metric values**: `fontSize: 18`, `fontWeight: 800`

### Components
- **Cards**: `background: "#161b22"`, `border: "1px solid #30363d"`, `borderRadius: 8`, `padding: 16`
- **Buttons (primary)**: `background: "linear-gradient(135deg, #3b82f6, #2563eb)"`, `color: "#fff"`, `borderRadius: 6`, `padding: "8px 20px"`, `fontWeight: 700`
- **Buttons (secondary)**: `background: "#21262d"`, `border: "1px solid #30363d"`, `borderRadius: 4`
- **Inputs**: `background: "#0d1117"`, `border: "1px solid #30363d"`, `borderRadius: 5`, `padding: "8px 10px"`
- **Tables**: `borderCollapse: "collapse"`, header border `#30363d`, row border `#30363d`
- **Metric cards**: `background: "#0d1117"`, `border: "1px solid #21262d"`, `borderRadius: 4`, centered text
- **Tabs**: inactive `rgba(255,255,255,0.5)`, active `#3b82f6` with `borderBottom: "2px solid #3b82f6"`

### Layout
- **Container**: `padding: "20px 24px"`, `maxWidth: 1400`, `margin: "0 auto"`
- **Grids**: Use CSS grid with `gap: 8-16`
- **Hover**: Background `rgba(59,130,246,0.08)`, border/text to `#3b82f6`

### Do NOT use
- Orange accent (`#f97316`) — replaced by blue `#3b82f6`
- Old dark grays (`#111`, `#222`, `#333`, `#1a1a1a`) — use `#161b22`, `#30363d`, `#0d1117`
- Old muted text (`#888`, `#666`, `#555`) — use `rgba(255,255,255,0.5/0.4/0.35)`
- Geist Mono font family — use `monospace`

---

## FX Pairs Trading Simulator

**LIVE** — Tab 6 on `/fx` page. Adaptive Kalman filter pairs trading on NOK-denominated FX rates.

### Architecture
| File | Purpose |
|------|---------|
| `apps/web/src/lib/fxKalmanPairs.ts` | 2D Kalman filter engine, trade simulator, equity curve builder |
| `apps/web/src/app/api/fx/pairs-trade/route.ts` | API: fetches aligned spot rates, deduplicates, runs Kalman engine |
| `apps/web/src/app/fx/page.tsx` | Full-page live simulation UI (tab 6) |

### Kalman Filter Implementation
- **State**: θ_t = [α_t, β_t] — intercept + hedge ratio as random walk
- **Evolution**: θ_t = θ_{t-1} + η_t, W = (δ/(1−δ)) × I₂, δ=1e-5
- **Observation**: y_t = [1, x_t]·θ_t + ε_t, Ve=1e-3
- **Covariance update**: Joseph form `P = (I−KH)P(I−KH)ᵀ + K·Ve·Kᵀ` for numerical stability
- **Z-score**: 60-bar rolling std of residuals (Gatev et al. 2006) — NOT Kalman S (which collapses to near-zero post burn-in)
- **Burn-in**: first 100 bars excluded from trading

### Trade Simulation
- **Entry lag**: 1-day (signal at close t → fill at open t+1)
- **Exit**: same-bar (limit orders pre-placed at known spread levels)
- **MIN_HOLD_DAYS = 2**: prevents whipsaw on take-profit exits
- **COOLDOWN_BARS = 1**: one bar pause after any exit
- **P&L formula**: vol-targeted — `pnlPct = netZCapture × (positionSizePct / 10)`; cost floored at 0.15σ to prevent near-free trades in high-vol periods

### Default Parameters
| Parameter | Default | Range |
|-----------|---------|-------|
| Entry z | ±1.6σ | 0.5–5.0 |
| Exit z | ±0.6σ | 0.0–1.5 |
| Stop loss | ±2.8σ | 1.5–5.0 |
| Position size | 10% NAV | 2–40% |
| Bid-ask | 1.0 bps/side | — |
| Speed | 5x | 1x/3x/5x/10x |
| History | 5Y (1260 days) | 3Y/5Y |

### Pair Combinations
| Key | Label | Color | Notes |
|-----|-------|-------|-------|
| NOKGBP_NOKEUR | GBP ↔ EUR | #10b981 | Most signals — post-Brexit BoE/ECB divergence |
| NOKEUR_NOKUSD | EUR ↔ USD | #3b82f6 | Fed/ECB policy divergence |
| NOKGBP_NOKUSD | GBP ↔ USD | #9C27B0 | Tightly co-integrated, fewer trades |

### UI Features
- Live animated simulation (PLAY/PAUSE/RESET with auto-reset on replay)
- Z-score chart (trailing 90 days, entry/exit/stop bands, trade dots)
- Position monitor: bell-curve showing current z vs thresholds
- Equity curve (closed trades only, indexed 100)
- Rolling hedge ratio β chart
- Live performance panel: portfolio value, trade count, win rate, max DD
- Kalman state readout: β, α, z-score, spread vol
- Signal proximity bars (% approach to long/short entry)
- Trade log table (entry/exit date, direction, z, days held, P&L)
- Collapsible how-it-works guide (3-column: strategy / charts / parameters)

### Data Notes
- Source: `fx_spot_rates` table, `source = 'norgesbank'` (correct, ~3200 rows/pair back to 2013)
- **CRITICAL**: Old `source = 'norges_bank'` rows had EUR and GBP rates swapped — deleted March 2026
- API deduplicates with `DISTINCT ON (date) ... ORDER BY date, spot_rate DESC` + JS-level Set filter

---

## Planned Features

### OSE Equity ML Trading Simulator

Planned extension of the pairs trading simulator concept to single-stock and multi-factor ML signals on Oslo Børs equities. See `ML_SIMULATOR_PROMPT.md` in project root for full build specification.

---

## Security

- Rate limiting: 100 req/min (public), 500 req/min (authenticated)
- JWT authentication for protected endpoints
- Password hashing with bcryptjs (research portal)
- Parameterized SQL queries (injection prevention)
- Ticker validation (alphanumeric, max 10 chars)
- Secure error handling (no internal details exposed)
