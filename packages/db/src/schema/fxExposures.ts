// FX Exposures Schema - Currency exposure metadata and computed analytics
import { pgTable, varchar, date, numeric, timestamp, bigserial, index, uniqueIndex, integer, text, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Currency revenue breakdown per stock (fundamental data)
 */
export const stockFxExposure = pgTable(
  "stock_fx_exposure",
  {
    ticker: varchar("ticker", { length: 20 }).primaryKey(), // FK to stocks(ticker)
    usdRevenuePct: numeric("usd_revenue_pct", { precision: 5, scale: 4 }), // 0.7500 = 75%
    eurRevenuePct: numeric("eur_revenue_pct", { precision: 5, scale: 4 }),
    gbpRevenuePct: numeric("gbp_revenue_pct", { precision: 5, scale: 4 }),
    nokRevenuePct: numeric("nok_revenue_pct", { precision: 5, scale: 4 }),
    otherRevenuePct: numeric("other_revenue_pct", { precision: 5, scale: 4 }),
    lastUpdated: date("last_updated").notNull(),
    source: varchar("source", { length: 100 }), // 'ANNUAL_REPORT_2025', 'ANALYST_ESTIMATE'
    notes: text("notes"),
  },
  (table) => ({
    // Ensure total exposure sums to ~100% (allow 1% rounding tolerance)
    totalExposureCheck: check(
      "total_exposure_check",
      sql`COALESCE(${table.usdRevenuePct}, 0) +
          COALESCE(${table.eurRevenuePct}, 0) +
          COALESCE(${table.gbpRevenuePct}, 0) +
          COALESCE(${table.nokRevenuePct}, 0) +
          COALESCE(${table.otherRevenuePct}, 0) <= 1.01`
    ),
  })
);

/**
 * Pre-computed currency betas (rolling regressions)
 * R_equity = alpha + beta_FX * ΔFX + epsilon
 */
export const fxCurrencyBetas = pgTable(
  "fx_currency_betas",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(), // FK to stocks(ticker)
    currencyPair: varchar("currency_pair", { length: 10 }).notNull(), // 'NOKUSD', 'NOKEUR', 'NOKGBP'
    date: date("date").notNull(), // End date of rolling window
    windowDays: integer("window_days").notNull(), // 20, 63, 252
    beta: numeric("beta", { precision: 10, scale: 6 }), // Currency beta coefficient
    rSquared: numeric("r_squared", { precision: 6, scale: 4 }), // R² (0-1)
    stdError: numeric("std_error", { precision: 10, scale: 6 }), // Standard error of beta
    tStat: numeric("t_stat", { precision: 10, scale: 4 }), // t-statistic
    pValue: numeric("p_value", { precision: 8, scale: 6 }), // Statistical significance
    observations: integer("observations").notNull(), // Sample size
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tickerDateCurrencyWindowIdx: uniqueIndex("fx_currency_betas_unique_idx").on(
      table.ticker,
      table.currencyPair,
      table.date,
      table.windowDays
    ),
    tickerDateIdx: index("fx_currency_betas_ticker_date_idx").on(table.ticker, table.date.desc(), table.currencyPair),
  })
);

/**
 * FX exposure decomposition (daily)
 * R_NOK = R_local + ΔFX + (R_local × ΔFX)
 */
export const fxExposureDecomposition = pgTable(
  "fx_exposure_decomposition",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    date: date("date").notNull(),
    totalReturnNok: numeric("total_return_nok", { precision: 10, scale: 6 }), // Total return in NOK (%)
    pureEquityReturn: numeric("pure_equity_return", { precision: 10, scale: 6 }), // Pure asset return (%)
    fxContribution: numeric("fx_contribution", { precision: 10, scale: 6 }), // FX contribution (%)
    interactionTerm: numeric("interaction_term", { precision: 10, scale: 6 }), // R × FX (%)

    // Individual currency contributions
    usdFxContribution: numeric("usd_fx_contribution", { precision: 10, scale: 6 }),
    eurFxContribution: numeric("eur_fx_contribution", { precision: 10, scale: 6 }),
    gbpFxContribution: numeric("gbp_fx_contribution", { precision: 10, scale: 6 }),

    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tickerDateIdx: uniqueIndex("fx_exposure_decomp_unique_idx").on(table.ticker, table.date),
    tickerDateLookupIdx: index("fx_exposure_decomp_ticker_date_idx").on(table.ticker, table.date.desc()),
  })
);

/**
 * Hedge P&L attribution
 */
export const fxHedgePnl = pgTable(
  "fx_hedge_pnl",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    date: date("date").notNull(),
    currencyPair: varchar("currency_pair", { length: 10 }).notNull(),
    hedgeRatio: numeric("hedge_ratio", { precision: 5, scale: 4 }).notNull(), // 0.0000 to 1.0000
    tenor: varchar("tenor", { length: 10 }).notNull(), // '1M', '3M', '6M', '12M'

    // P&L Components (%)
    unhedgedReturn: numeric("unhedged_return", { precision: 10, scale: 6 }),
    hedgedReturn: numeric("hedged_return", { precision: 10, scale: 6 }),
    spotPnl: numeric("spot_pnl", { precision: 10, scale: 6 }),
    forwardPnl: numeric("forward_pnl", { precision: 10, scale: 6 }),
    carryComponent: numeric("carry_component", { precision: 10, scale: 6 }),
    residualFxRisk: numeric("residual_fx_risk", { precision: 10, scale: 6 }),
    transactionCost: numeric("transaction_cost", { precision: 10, scale: 6 }),

    // Risk Metrics (%)
    unhedgedVolatility: numeric("unhedged_volatility", { precision: 10, scale: 6 }),
    hedgedVolatility: numeric("hedged_volatility", { precision: 10, scale: 6 }),
    volatilityReduction: numeric("volatility_reduction", { precision: 10, scale: 6 }), // Percentage reduction

    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tickerDateCurrencyHedgeIdx: uniqueIndex("fx_hedge_pnl_unique_idx").on(
      table.ticker,
      table.date,
      table.currencyPair,
      table.hedgeRatio,
      table.tenor
    ),
    tickerDateIdx: index("fx_hedge_pnl_ticker_idx").on(table.ticker, table.date.desc(), table.currencyPair),
  })
);

/**
 * Optimal hedge ratios (minimum variance)
 */
export const fxOptimalHedges = pgTable(
  "fx_optimal_hedges",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    currencyPair: varchar("currency_pair", { length: 10 }).notNull(),
    date: date("date").notNull(),
    windowDays: integer("window_days").notNull(), // Estimation window (e.g., 252)

    // Hedge Ratio Estimates
    minVarianceHedge: numeric("min_variance_hedge", { precision: 6, scale: 4 }),
    regressionHedge: numeric("regression_hedge", { precision: 6, scale: 4 }),
    stabilityAdjustedHedge: numeric("stability_adjusted_hedge", { precision: 6, scale: 4 }),

    // Comparison Metrics (%)
    hedge0pctVol: numeric("hedge_0pct_vol", { precision: 10, scale: 6 }),
    hedge50pctVol: numeric("hedge_50pct_vol", { precision: 10, scale: 6 }),
    hedge100pctVol: numeric("hedge_100pct_vol", { precision: 10, scale: 6 }),
    hedgeOptimalVol: numeric("hedge_optimal_vol", { precision: 10, scale: 6 }),

    maxDrawdownUnhedged: numeric("max_drawdown_unhedged", { precision: 10, scale: 6 }),
    maxDrawdownHedged: numeric("max_drawdown_hedged", { precision: 10, scale: 6 }),

    opportunityCost: numeric("opportunity_cost", { precision: 10, scale: 6 }), // Carry sacrifice (%)

    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tickerCurrencyDateWindowIdx: uniqueIndex("fx_optimal_hedges_unique_idx").on(
      table.ticker,
      table.currencyPair,
      table.date,
      table.windowDays
    ),
    tickerDateIdx: index("fx_optimal_hedges_idx").on(table.ticker, table.date.desc(), table.currencyPair),
  })
);

/**
 * FX market regime classification
 */
export const fxMarketRegimes = pgTable(
  "fx_market_regimes",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    date: date("date").notNull().unique(),
    regime: varchar("regime", { length: 50 }).notNull(), // 'RISK_ON', 'RISK_OFF', 'ENERGY_SHOCK', 'CARRY_TRADE', 'NORMAL'
    nokRegime: varchar("nok_regime", { length: 50 }), // 'STRONG', 'WEAK', 'NEUTRAL'
    vixLevel: numeric("vix_level", { precision: 8, scale: 4 }), // Market volatility
    oilPriceUsd: numeric("oil_price_usd", { precision: 10, scale: 4 }), // Brent crude reference

    // Regime indicators
    usdStrengthZscore: numeric("usd_strength_zscore", { precision: 8, scale: 4 }),
    riskSentimentScore: numeric("risk_sentiment_score", { precision: 6, scale: 4 }),

    source: varchar("source", { length: 100 }),
    notes: text("notes"),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    dateIdx: index("fx_regimes_date_idx").on(table.date.desc()),
  })
);
