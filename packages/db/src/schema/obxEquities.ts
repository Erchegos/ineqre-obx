// packages/db/src/schema/obxEquities.ts
import { pgTable, varchar, date, numeric, integer } from "drizzle-orm/pg-core";

export const obxEquities = pgTable("obx_equities", {
  date: date("date").notNull(),
  ticker: varchar("ticker", { length: 20 }).notNull(),

  open: numeric("open"),
  high: numeric("high"),
  low: numeric("low"),
  close: numeric("close"),

  numberOfShares: numeric("number_of_shares"),
  numberOfTrades: integer("number_of_trades"),
  turnover: numeric("turnover"),
  vwap: numeric("vwap"),
});
