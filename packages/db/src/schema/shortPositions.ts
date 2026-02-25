import {
  pgTable,
  bigserial,
  varchar,
  date,
  numeric,
  integer,
  timestamp,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Short Positions — daily aggregate per stock
 *
 * Data from Finanstilsynet SSR (Short Sale Register).
 * https://ssr.finanstilsynet.no/api/v2/instruments
 *
 * Stores aggregate short interest per ticker per day:
 * total short %, number of active position holders, and day-over-day change.
 */
export const shortPositions = pgTable(
  "short_positions",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    isin: varchar("isin", { length: 12 }).notNull(),
    date: date("date").notNull(),
    shortPct: numeric("short_pct", { precision: 8, scale: 4 }).notNull(),
    totalShortShares: numeric("total_short_shares", { precision: 20, scale: 0 }),
    activePositions: integer("active_positions").notNull(),
    prevShortPct: numeric("prev_short_pct", { precision: 8, scale: 4 }),
    changePct: numeric("change_pct", { precision: 8, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      tickerDateUnique: unique().on(table.ticker, table.date),
      tickerIdx: index("idx_short_positions_ticker").on(table.ticker),
      dateIdx: index("idx_short_positions_date").on(table.date),
      shortPctIdx: index("idx_short_positions_short_pct").on(table.shortPct),
      shortPctCheck: check(
        "short_positions_pct_check",
        sql`${table.shortPct} >= 0 AND ${table.shortPct} <= 100`
      ),
    };
  }
);

/**
 * Short Position Holders — individual holder positions
 *
 * Each row is one position holder's short position in one stock on one day.
 * Finanstilsynet requires disclosure when short position >= 0.5% of issued shares.
 */
export const shortPositionHolders = pgTable(
  "short_position_holders",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    isin: varchar("isin", { length: 12 }).notNull(),
    date: date("date").notNull(),
    positionHolder: varchar("position_holder", { length: 255 }).notNull(),
    shortPct: numeric("short_pct", { precision: 8, scale: 4 }).notNull(),
    shortShares: numeric("short_shares", { precision: 20, scale: 0 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      holderUnique: unique().on(table.ticker, table.date, table.positionHolder),
      tickerIdx: index("idx_short_holders_ticker").on(table.ticker),
      dateIdx: index("idx_short_holders_date").on(table.date),
      holderIdx: index("idx_short_holders_holder").on(table.positionHolder),
    };
  }
);

export type ShortPosition = typeof shortPositions.$inferSelect;
export type NewShortPosition = typeof shortPositions.$inferInsert;

export type ShortPositionHolder = typeof shortPositionHolders.$inferSelect;
export type NewShortPositionHolder = typeof shortPositionHolders.$inferInsert;
