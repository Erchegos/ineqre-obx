import {
  pgTable,
  bigserial,
  varchar,
  integer,
  smallint,
  numeric,
  timestamp,
  boolean,
  jsonb,
  text,
  unique,
  index,
} from "drizzle-orm/pg-core";

import { sql } from "drizzle-orm";

/**
 * Orderflow Ticks — every trade event captured from Nordnet feed
 *
 * Primary intraday data store. Each row is a single trade on Oslo Børs.
 * Side classification: 1=buy, -1=sell, 0=unknown (via BVC or Lee-Ready).
 * Volume estimate: ~12,500 ticks/day for 25 tickers (~500 trades/ticker/day).
 */
export const orderflowTicks = pgTable(
  "orderflow_ticks",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    price: numeric("price", { precision: 14, scale: 4 }).notNull(),
    size: integer("size").notNull(),
    side: smallint("side"), // 1=buy, -1=sell, 0=unknown
    tradeId: text("trade_id"),
    vwap: numeric("vwap", { precision: 14, scale: 4 }),
    turnover: numeric("turnover", { precision: 18, scale: 2 }),
    turnoverVolume: integer("turnover_volume"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tickerTsIdx: index("idx_orderflow_ticks_ticker_ts").on(
      table.ticker,
      table.ts
    ),
    tsIdx: index("idx_orderflow_ticks_ts").on(table.ts),
  })
);

/**
 * Orderflow Depth Snapshots — orderbook state at 1-second intervals
 *
 * Stores 5-level depth (bid/ask prices, sizes, order counts) as JSONB arrays.
 * Used for OFI computation (Cont et al. 2014) and iceberg detection.
 * Volume estimate: ~675,000 snapshots/day (25 tickers × 1/sec × 7.5h).
 */
export const orderflowDepthSnapshots = pgTable(
  "orderflow_depth_snapshots",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    bidPrices: jsonb("bid_prices"), // number[5]: best bid → 5th level
    bidSizes: jsonb("bid_sizes"), // number[5]
    bidOrders: jsonb("bid_orders"), // number[5]: order count per level
    askPrices: jsonb("ask_prices"), // number[5]
    askSizes: jsonb("ask_sizes"), // number[5]
    askOrders: jsonb("ask_orders"), // number[5]
    spreadBps: numeric("spread_bps", { precision: 8, scale: 2 }),
    midPrice: numeric("mid_price", { precision: 14, scale: 4 }),
    bookImbalance: numeric("book_imbalance", { precision: 6, scale: 4 }), // (bid_vol - ask_vol) / (bid_vol + ask_vol)
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tickerTsIdx: index("idx_orderflow_depth_ticker_ts").on(
      table.ticker,
      table.ts
    ),
  })
);

/**
 * Orderflow Bars — pre-aggregated intraday bars (time-based and volume-based)
 *
 * bar_type: 'time_1m', 'time_5m', 'volume'
 * Volume bars use VBS = ADV / 50 (per Easley et al. 2012).
 * buy_volume/sell_volume classified via Bulk Volume Classification (BVC).
 */
export const orderflowBars = pgTable(
  "orderflow_bars",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    barType: varchar("bar_type", { length: 10 }).notNull(), // time_1m, time_5m, volume
    barOpenTs: timestamp("bar_open_ts", { withTimezone: true }).notNull(),
    barCloseTs: timestamp("bar_close_ts", { withTimezone: true }).notNull(),
    open: numeric("open", { precision: 14, scale: 4 }).notNull(),
    high: numeric("high", { precision: 14, scale: 4 }).notNull(),
    low: numeric("low", { precision: 14, scale: 4 }).notNull(),
    close: numeric("close", { precision: 14, scale: 4 }).notNull(),
    volume: integer("volume").notNull(),
    turnover: numeric("turnover", { precision: 18, scale: 2 }),
    tradeCount: integer("trade_count").notNull(),
    vwap: numeric("vwap", { precision: 14, scale: 4 }),
    buyVolume: integer("buy_volume"),
    sellVolume: integer("sell_volume"),
    ofi: numeric("ofi", { precision: 14, scale: 2 }),
    vpin: numeric("vpin", { precision: 6, scale: 4 }),
    kyleLambda: numeric("kyle_lambda", { precision: 12, scale: 6 }),
    spreadMeanBps: numeric("spread_mean_bps", { precision: 8, scale: 2 }),
    depthImbalanceMean: numeric("depth_imbalance_mean", { precision: 6, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tickerBarTypeOpenIdx: index("idx_orderflow_bars_ticker_type_open").on(
      table.ticker,
      table.barType,
      table.barOpenTs
    ),
  })
);

/**
 * Orderflow Signals — computed microstructure signals per ticker
 *
 * Updated every 5 minutes during market hours. Aggregates VPIN, OFI,
 * Kyle's Lambda, regime classification, and intraday forecasts.
 */
export const orderflowSignals = pgTable(
  "orderflow_signals",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    vpin50: numeric("vpin_50", { precision: 6, scale: 4 }),
    vpinPercentile: numeric("vpin_percentile", { precision: 5, scale: 2 }),
    kyleLambda60m: numeric("kyle_lambda_60m", { precision: 12, scale: 6 }),
    ofiCumulative: numeric("ofi_cumulative", { precision: 14, scale: 2 }),
    ofi5m: numeric("ofi_5m", { precision: 14, scale: 2 }),
    toxicityScore: numeric("toxicity_score", { precision: 5, scale: 2 }),
    icebergProbability: numeric("iceberg_probability", { precision: 5, scale: 4 }),
    blockAlert: boolean("block_alert").default(false),
    blockEstSize: integer("block_est_size"),
    blockEstDirection: smallint("block_est_direction"), // 1=buy, -1=sell
    regime: varchar("regime", { length: 20 }), // informed_buying, informed_selling, market_making, retail, neutral
    spreadRegime: varchar("spread_regime", { length: 20 }), // tight, normal, wide, crisis
    intradayForecast: numeric("intraday_forecast", { precision: 8, scale: 4 }),
    forecastConfidence: numeric("forecast_confidence", { precision: 5, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tickerTsUnique: unique().on(table.ticker, table.ts),
    tickerTsIdx: index("idx_orderflow_signals_ticker_ts").on(
      table.ticker,
      table.ts
    ),
  })
);

/**
 * Orderflow Iceberg Detections — individual iceberg / fragmented block trade detections
 *
 * Each row is a detected cluster of trades that likely represents a single
 * large institutional order being executed algorithmically (TWAP/VWAP/iceberg).
 */
export const orderflowIcebergDetections = pgTable(
  "orderflow_iceberg_detections",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    startTs: timestamp("start_ts", { withTimezone: true }).notNull(),
    endTs: timestamp("end_ts", { withTimezone: true }).notNull(),
    direction: smallint("direction").notNull(), // 1=buy, -1=sell
    totalVolume: integer("total_volume").notNull(),
    tradeCount: integer("trade_count").notNull(),
    avgTradeSize: numeric("avg_trade_size", { precision: 10, scale: 2 }),
    medianTradeSize: integer("median_trade_size"),
    priceRangeBps: numeric("price_range_bps", { precision: 8, scale: 2 }),
    vwap: numeric("vwap", { precision: 14, scale: 4 }),
    estBlockPct: numeric("est_block_pct", { precision: 5, scale: 2 }), // % of ADV
    detectionMethod: varchar("detection_method", { length: 30 }), // clustering, ml, pattern, size_anomaly, book_reload
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    features: jsonb("features"), // raw feature vector for ML
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tickerDetectedIdx: index("idx_orderflow_icebergs_ticker_detected").on(
      table.ticker,
      table.detectedAt
    ),
  })
);

// Type exports
export type OrderflowTick = typeof orderflowTicks.$inferSelect;
export type NewOrderflowTick = typeof orderflowTicks.$inferInsert;
export type OrderflowDepthSnapshot = typeof orderflowDepthSnapshots.$inferSelect;
export type NewOrderflowDepthSnapshot = typeof orderflowDepthSnapshots.$inferInsert;
export type OrderflowBar = typeof orderflowBars.$inferSelect;
export type NewOrderflowBar = typeof orderflowBars.$inferInsert;
export type OrderflowSignal = typeof orderflowSignals.$inferSelect;
export type NewOrderflowSignal = typeof orderflowSignals.$inferInsert;
export type OrderflowIcebergDetection = typeof orderflowIcebergDetections.$inferSelect;
export type NewOrderflowIcebergDetection = typeof orderflowIcebergDetections.$inferInsert;
