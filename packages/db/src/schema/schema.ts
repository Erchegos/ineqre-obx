import {
  pgTable,
  date,
  numeric,
  integer,
  varchar
} from "drizzle-orm/pg-core";

export const equities = pgTable("equities", {
  date: date("date").notNull(),
  ticker: varchar("ticker", { length: 16 }).notNull(),

  open: numeric("open"),
  high: numeric("high"),
  low: numeric("low"),
  close: numeric("close"),

  numberOfShares: integer("number_of_shares"),
  numberOfTrades: integer("number_of_trades"),
  turnover: numeric("turnover"),
  vwap: numeric("vwap"),
});

export { obxEquities } from "./schema/obxEquities";
export { obxFeatures } from "./schema/obxFeatures";
