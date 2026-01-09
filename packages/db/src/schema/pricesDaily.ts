import {
  pgTable,
  varchar,
  date,
  numeric,
  bigint,
  timestamp,
} from "drizzle-orm/pg-core";

export const pricesDaily = pgTable("prices_daily", {
  id: bigint("id", { mode: "bigint" }).primaryKey(),
  ticker: varchar("ticker", { length: 20 }).notNull(),
  date: date("date").notNull(),

  open: numeric("open", { precision: 12, scale: 4 }),
  high: numeric("high", { precision: 12, scale: 4 }),
  low: numeric("low", { precision: 12, scale: 4 }),
  close: numeric("close", { precision: 12, scale: 4 }).notNull(),
  adjClose: numeric("adj_close", { precision: 12, scale: 4 }),

  volume: bigint("volume", { mode: "bigint" }).notNull(),
  source: varchar("source", { length: 50 }).notNull(),

  insertedAt: timestamp("inserted_at", { withTimezone: true }),
});
