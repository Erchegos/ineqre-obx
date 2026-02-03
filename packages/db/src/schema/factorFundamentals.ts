import {
  pgTable,
  bigserial,
  varchar,
  date,
  numeric,
  boolean,
  jsonb,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { stocks } from "./001_initial";

/**
 * Fundamental Factors Table (Monthly Frequency, Forward-Filled)
 *
 * Stores fundamental valuation ratios and company metrics:
 * - bm: Book-to-market ratio
 * - nokvol: Trading volume in NOK
 * - ep: Earnings yield
 * - dy: Dividend yield
 * - sp: Sales-to-price ratio
 * - sg: Sales growth
 * - mktcap: Market capitalization
 *
 * Data is forward-filled between quarterly/annual reporting dates.
 */
export const factorFundamentals = pgTable(
  "factor_fundamentals",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 })
      .notNull()
      .references(() => stocks.ticker, { onDelete: "cascade" }),
    date: date("date").notNull(),

    // Fundamental factors
    bm: numeric("bm", { precision: 12, scale: 6 }),
    nokvol: numeric("nokvol", { precision: 20, scale: 2 }),
    ep: numeric("ep", { precision: 12, scale: 6 }),
    dy: numeric("dy", { precision: 12, scale: 6 }),
    sp: numeric("sp", { precision: 12, scale: 6 }),
    sg: numeric("sg", { precision: 12, scale: 6 }),
    mktcap: numeric("mktcap", { precision: 20, scale: 2 }),

    // Metadata
    reportDate: date("report_date"),
    isForwardFilled: boolean("is_forward_filled").default(false),
    dataQuality: jsonb("data_quality"),

    insertedAt: timestamp("inserted_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      // Unique constraint on ticker + date
      tickerDateUnique: unique().on(table.ticker, table.date),

      // Indexes
      tickerDateIdx: index("idx_factor_fundamentals_ticker_date").on(
        table.ticker,
        table.date
      ),
      reportDateIdx: index("idx_factor_fundamentals_report_date").on(
        table.reportDate
      ),
    };
  }
);

export type FactorFundamentals = typeof factorFundamentals.$inferSelect;
export type NewFactorFundamentals = typeof factorFundamentals.$inferInsert;
