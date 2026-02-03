import {
  pgTable,
  bigserial,
  varchar,
  date,
  numeric,
  smallint,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { stocks } from "./001_initial";

/**
 * Technical Factors Table (Daily Frequency)
 *
 * Stores momentum and volatility factors calculated from daily OHLCV data:
 * - Momentum: mom1m, mom6m, mom11m, mom36m, chgmom
 * - Volatility: vol1m, vol3m, vol12m, maxret, beta, ivol
 * - Categorical: dum_jan (January dummy)
 */
export const factorTechnical = pgTable(
  "factor_technical",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 })
      .notNull()
      .references(() => stocks.ticker, { onDelete: "cascade" }),
    date: date("date").notNull(),

    // Momentum factors (log returns)
    mom1m: numeric("mom1m", { precision: 12, scale: 6 }),
    mom6m: numeric("mom6m", { precision: 12, scale: 6 }),
    mom11m: numeric("mom11m", { precision: 12, scale: 6 }),
    mom36m: numeric("mom36m", { precision: 12, scale: 6 }),
    chgmom: numeric("chgmom", { precision: 12, scale: 6 }),

    // Volatility factors (annualized)
    vol1m: numeric("vol1m", { precision: 12, scale: 6 }),
    vol3m: numeric("vol3m", { precision: 12, scale: 6 }),
    vol12m: numeric("vol12m", { precision: 12, scale: 6 }),
    maxret: numeric("maxret", { precision: 12, scale: 6 }),
    beta: numeric("beta", { precision: 12, scale: 6 }),
    ivol: numeric("ivol", { precision: 12, scale: 6 }),

    // Categorical factor
    dumJan: smallint("dum_jan"),

    // Metadata
    insertedAt: timestamp("inserted_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      // Unique constraint on ticker + date
      tickerDateUnique: unique().on(table.ticker, table.date),

      // Indexes for efficient queries
      tickerDateIdx: index("idx_factor_technical_ticker_date").on(
        table.ticker,
        table.date
      ),
      dateIdx: index("idx_factor_technical_date").on(table.date),
    };
  }
);

export type FactorTechnical = typeof factorTechnical.$inferSelect;
export type NewFactorTechnical = typeof factorTechnical.$inferInsert;
