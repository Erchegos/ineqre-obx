import {
  pgTable,
  date,
  text,
  integer,
  bigint,
  numeric,
} from "drizzle-orm/pg-core";

export const obxEquities = pgTable("obx_equities", {
  ticker: text("ticker").notNull(),
  date: date("date").notNull(),

  open: numeric("open", { precision: 18, scale: 6 }),
  high: numeric("high", { precision: 18, scale: 6 }),
  low: numeric("low", { precision: 18, scale: 6 }),
  close: numeric("close", { precision: 18, scale: 6 }),

  numberOfShares: bigint("number_of_shares", { mode: "number" }),
  numberOfTrades: integer("number_of_trades"),
  turnover: bigint("turnover", { mode: "number" }),
  vwap: numeric("vwap", { precision: 18, scale: 6 }),
});

export const obxFeatures = pgTable("obx_features", {
  ticker: text("ticker").notNull(),
  date: date("date").notNull(),

  ret1d: numeric("ret_1d", { precision: 18, scale: 10 }),
  vol20d: numeric("vol_20d", { precision: 18, scale: 10 }),
});

export const obxMarketProxy = pgTable("obx_market_proxy", {
  date: date("date").notNull(),
  close: numeric("close", { precision: 18, scale: 6 }),
});
