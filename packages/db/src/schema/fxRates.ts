// FX Rates Schema - Currency exchange rates and forward prices
import { pgTable, varchar, date, numeric, timestamp, bigserial, index, uniqueIndex, integer } from "drizzle-orm/pg-core";

/**
 * Daily FX spot rates (NOK as base currency)
 * Format: NOK/USD means 1 USD = X NOK
 */
export const fxSpotRates = pgTable(
  "fx_spot_rates",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    currencyPair: varchar("currency_pair", { length: 10 }).notNull(), // 'NOKUSD', 'NOKEUR', 'NOKGBP'
    date: date("date").notNull(),
    spotRate: numeric("spot_rate", { precision: 12, scale: 6 }).notNull(), // NOK per 1 foreign currency
    bid: numeric("bid", { precision: 12, scale: 6 }), // Buy foreign currency
    ask: numeric("ask", { precision: 12, scale: 6 }), // Sell foreign currency
    mid: numeric("mid", { precision: 12, scale: 6 }), // Mid-market rate
    source: varchar("source", { length: 50 }).notNull().default("ibkr"),
    insertedAt: timestamp("inserted_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    currencyDateSourceIdx: uniqueIndex("fx_spot_rates_currency_date_source_idx").on(
      table.currencyPair,
      table.date,
      table.source
    ),
    currencyDateIdx: index("fx_spot_rates_currency_date_idx").on(table.currencyPair, table.date.desc()),
  })
);

/**
 * Interest rates for Interest Rate Parity calculations
 */
export const interestRates = pgTable(
  "interest_rates",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    currency: varchar("currency", { length: 3 }).notNull(), // 'NOK', 'USD', 'EUR', 'GBP'
    date: date("date").notNull(),
    tenor: varchar("tenor", { length: 10 }).notNull(), // 'OVERNIGHT', '1M', '3M', '6M', '12M'
    rate: numeric("rate", { precision: 8, scale: 6 }).notNull(), // Annualized rate (e.g., 0.0450 = 4.50%)
    rateType: varchar("rate_type", { length: 50 }).notNull(), // 'POLICY_RATE', 'IBOR', 'OIS', 'GOVT_BOND'
    source: varchar("source", { length: 50 }).notNull(),
    insertedAt: timestamp("inserted_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    currencyDateTenorTypeSourceIdx: uniqueIndex("interest_rates_unique_idx").on(
      table.currency,
      table.date,
      table.tenor,
      table.rateType,
      table.source
    ),
    currencyDateIdx: index("interest_rates_currency_date_idx").on(table.currency, table.date.desc(), table.tenor),
  })
);

/**
 * Synthetic forward rates computed via Interest Rate Parity
 */
export const fxForwardRates = pgTable(
  "fx_forward_rates",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    currencyPair: varchar("currency_pair", { length: 10 }).notNull(),
    date: date("date").notNull(),
    tenor: varchar("tenor", { length: 10 }).notNull(), // '1M', '3M', '6M', '12M'
    spotRate: numeric("spot_rate", { precision: 12, scale: 6 }).notNull(),
    domesticRate: numeric("domestic_rate", { precision: 8, scale: 6 }).notNull(), // NOK rate
    foreignRate: numeric("foreign_rate", { precision: 8, scale: 6 }).notNull(), // USD/EUR/GBP rate
    forwardRate: numeric("forward_rate", { precision: 12, scale: 6 }).notNull(),
    forwardPoints: numeric("forward_points", { precision: 12, scale: 6 }), // (Forward - Spot) in pips
    annualizedCarry: numeric("annualized_carry", { precision: 8, scale: 6 }), // Annual carry return
    daysToMaturity: integer("days_to_maturity").notNull(),
    bidAskSpread: numeric("bid_ask_spread", { precision: 12, scale: 6 }), // Transaction cost
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    currencyDateTenorIdx: uniqueIndex("fx_forward_rates_unique_idx").on(table.currencyPair, table.date, table.tenor),
    currencyDateIdx: index("fx_forward_rates_currency_date_idx").on(table.currencyPair, table.date.desc(), table.tenor),
  })
);

/**
 * Commodity prices (for correlation and regime analysis)
 */
export const commodityPrices = pgTable(
  "commodity_prices",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(), // 'CL' (Brent), 'NG' (Nat Gas)
    contractType: varchar("contract_type", { length: 20 }).notNull(), // 'SPOT', 'FRONT_MONTH', 'CONTINUOUS'
    date: date("date").notNull(),
    open: numeric("open", { precision: 12, scale: 4 }),
    high: numeric("high", { precision: 12, scale: 4 }),
    low: numeric("low", { precision: 12, scale: 4 }),
    close: numeric("close", { precision: 12, scale: 4 }).notNull(),
    volume: bigserial("volume", { mode: "bigint" }),
    currency: varchar("currency", { length: 3 }).default("USD"),
    unit: varchar("unit", { length: 20 }), // 'BARREL', 'MMBTU', 'MT'
    source: varchar("source", { length: 50 }).notNull().default("ibkr"),
    insertedAt: timestamp("inserted_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    symbolContractDateSourceIdx: uniqueIndex("commodity_prices_unique_idx").on(
      table.symbol,
      table.contractType,
      table.date,
      table.source
    ),
    symbolDateIdx: index("commodity_prices_symbol_date_idx").on(table.symbol, table.date.desc()),
  })
);
