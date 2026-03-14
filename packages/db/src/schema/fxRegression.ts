// FX Multi-Currency Regression Results
// R_stock = α + β_mkt×R_OBX + β_usd×R_USDNOK + β_eur×R_EURNOK + β_gbp×R_GBPNOK + β_sek×R_SEKNOK + ε
import { pgTable, varchar, date, numeric, timestamp, bigserial, index, uniqueIndex, integer } from "drizzle-orm/pg-core";

/**
 * Multi-currency regression results (joint OLS with market + FX factors)
 * Extends fxCurrencyBetas which stores single-pair regressions
 */
export const fxRegressionResults = pgTable(
  "fx_regression_results",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    windowEnd: date("window_end").notNull(),
    windowDays: integer("window_days").notNull(), // 63, 126, 252

    // Market beta
    betaMarket: numeric("beta_market", { precision: 10, scale: 6 }),
    tstatMarket: numeric("tstat_market", { precision: 10, scale: 4 }),

    // Currency betas (joint regression coefficients)
    betaUsd: numeric("beta_usd", { precision: 10, scale: 6 }),
    tstatUsd: numeric("tstat_usd", { precision: 10, scale: 4 }),
    betaEur: numeric("beta_eur", { precision: 10, scale: 6 }),
    tstatEur: numeric("tstat_eur", { precision: 10, scale: 4 }),
    betaGbp: numeric("beta_gbp", { precision: 10, scale: 6 }),
    tstatGbp: numeric("tstat_gbp", { precision: 10, scale: 4 }),
    betaSek: numeric("beta_sek", { precision: 10, scale: 6 }),
    tstatSek: numeric("tstat_sek", { precision: 10, scale: 4 }),

    // Goodness of fit
    rSquared: numeric("r_squared", { precision: 6, scale: 4 }),        // Full model R²
    rSquaredFxOnly: numeric("r_squared_fx_only", { precision: 6, scale: 4 }), // R² from FX factors alone
    residualVol: numeric("residual_vol", { precision: 10, scale: 6 }), // Annualized residual volatility
    observations: integer("observations").notNull(),

    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tickerWindowEndDaysIdx: uniqueIndex("fx_regression_results_unique_idx").on(
      table.ticker,
      table.windowEnd,
      table.windowDays
    ),
    tickerWindowEndIdx: index("fx_regression_results_ticker_idx").on(table.ticker, table.windowEnd.desc()),
  })
);

export type FxRegressionResult = typeof fxRegressionResults.$inferSelect;
export type NewFxRegressionResult = typeof fxRegressionResults.$inferInsert;
