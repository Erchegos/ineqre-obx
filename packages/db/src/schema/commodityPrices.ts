import {
  pgTable,
  bigserial,
  varchar,
  date,
  numeric,
  bigint,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";

/**
 * Commodity Prices — daily OHLCV for key commodities
 *
 * Tracks commodities critical to OSE sectors:
 * - BZ=F (Brent Crude) → EQNR, AKRBP, SUBC, DNO
 * - CL=F (WTI Crude) → reference
 * - NG=F (Natural Gas) → energy sector
 * - ALI=F (Aluminium) → NHY
 * - GC=F (Gold) → reference
 *
 * Source: Yahoo Finance via yahoo-finance2
 */
export const commodityPrices = pgTable(
  "commodity_prices",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    date: date("date").notNull(),
    open: numeric("open", { precision: 14, scale: 4 }),
    high: numeric("high", { precision: 14, scale: 4 }),
    low: numeric("low", { precision: 14, scale: 4 }),
    close: numeric("close", { precision: 14, scale: 4 }).notNull(),
    volume: bigint("volume", { mode: "bigint" }),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    source: varchar("source", { length: 50 }).notNull().default("yahoo"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      symbolDateUnique: unique().on(table.symbol, table.date),
      symbolIdx: index("idx_commodity_prices_symbol").on(table.symbol),
      dateIdx: index("idx_commodity_prices_date").on(table.date),
    };
  }
);

/**
 * Commodity-Stock Sensitivity — regression of stock returns on commodity returns
 *
 * For each (ticker, commodity) pair, stores:
 * - beta: OLS coefficient (stock return per 1% commodity return)
 * - correlation at 60d and 252d horizons
 * - R² of regression
 *
 * Updated daily after commodity + stock prices are available.
 */
export const commodityStockSensitivity = pgTable(
  "commodity_stock_sensitivity",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    commoditySymbol: varchar("commodity_symbol", { length: 20 }).notNull(),
    beta: numeric("beta", { precision: 10, scale: 6 }).notNull(),
    correlation60d: numeric("correlation_60d", { precision: 8, scale: 6 }),
    correlation252d: numeric("correlation_252d", { precision: 8, scale: 6 }),
    rSquared: numeric("r_squared", { precision: 8, scale: 6 }),
    asOfDate: date("as_of_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      sensitivityUnique: unique().on(
        table.ticker,
        table.commoditySymbol,
        table.asOfDate
      ),
      tickerIdx: index("idx_commodity_sensitivity_ticker").on(table.ticker),
      commodityIdx: index("idx_commodity_sensitivity_commodity").on(
        table.commoditySymbol
      ),
    };
  }
);

export type CommodityPrice = typeof commodityPrices.$inferSelect;
export type NewCommodityPrice = typeof commodityPrices.$inferInsert;

export type CommodityStockSensitivity =
  typeof commodityStockSensitivity.$inferSelect;
export type NewCommodityStockSensitivity =
  typeof commodityStockSensitivity.$inferInsert;
