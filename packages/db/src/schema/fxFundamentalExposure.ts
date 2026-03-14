// FX Fundamental Exposure - Revenue/cost currency breakdown with sensitivity metrics
import { pgTable, varchar, numeric, timestamp, bigserial, uniqueIndex, integer, text } from "drizzle-orm/pg-core";

/**
 * Detailed currency exposure from fundamental analysis (annual reports)
 * Extends stockFxExposure (revenue-only) with cost breakdown and EBITDA/EPS sensitivity
 */
export const fxFundamentalExposure = pgTable(
  "fx_fundamental_exposure",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    fiscalYear: integer("fiscal_year").notNull(),

    // Revenue breakdown (as decimal, e.g. 0.80 = 80%)
    revenueUsdPct: numeric("revenue_usd_pct", { precision: 5, scale: 4 }),
    revenueEurPct: numeric("revenue_eur_pct", { precision: 5, scale: 4 }),
    revenueGbpPct: numeric("revenue_gbp_pct", { precision: 5, scale: 4 }),
    revenueNokPct: numeric("revenue_nok_pct", { precision: 5, scale: 4 }),
    revenueSekPct: numeric("revenue_sek_pct", { precision: 5, scale: 4 }),
    revenueOtherPct: numeric("revenue_other_pct", { precision: 5, scale: 4 }),

    // Cost breakdown (as decimal)
    costUsdPct: numeric("cost_usd_pct", { precision: 5, scale: 4 }),
    costEurPct: numeric("cost_eur_pct", { precision: 5, scale: 4 }),
    costGbpPct: numeric("cost_gbp_pct", { precision: 5, scale: 4 }),
    costNokPct: numeric("cost_nok_pct", { precision: 5, scale: 4 }),
    costSekPct: numeric("cost_sek_pct", { precision: 5, scale: 4 }),
    costOtherPct: numeric("cost_other_pct", { precision: 5, scale: 4 }),

    // Net exposure per currency: (revenue% - cost%) — can be negative
    netUsdPct: numeric("net_usd_pct", { precision: 6, scale: 4 }),
    netEurPct: numeric("net_eur_pct", { precision: 6, scale: 4 }),
    netGbpPct: numeric("net_gbp_pct", { precision: 6, scale: 4 }),
    netSekPct: numeric("net_sek_pct", { precision: 6, scale: 4 }),

    // EBITDA sensitivity: % EBITDA change per 1% FX move
    ebitdaSensitivityUsd: numeric("ebitda_sensitivity_usd", { precision: 10, scale: 4 }),
    ebitdaSensitivityEur: numeric("ebitda_sensitivity_eur", { precision: 10, scale: 4 }),
    ebitdaSensitivityGbp: numeric("ebitda_sensitivity_gbp", { precision: 10, scale: 4 }),

    // EPS sensitivity: % EPS change per 1% FX move
    epsSensitivityUsd: numeric("eps_sensitivity_usd", { precision: 10, scale: 4 }),
    epsSensitivityEur: numeric("eps_sensitivity_eur", { precision: 10, scale: 4 }),
    epsSensitivityGbp: numeric("eps_sensitivity_gbp", { precision: 10, scale: 4 }),

    source: varchar("source", { length: 100 }), // 'annual_report', 'estimate', 'regression'
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tickerFiscalYearIdx: uniqueIndex("fx_fundamental_exposure_unique_idx").on(
      table.ticker,
      table.fiscalYear
    ),
  })
);

export type FxFundamentalExposure = typeof fxFundamentalExposure.$inferSelect;
export type NewFxFundamentalExposure = typeof fxFundamentalExposure.$inferInsert;
