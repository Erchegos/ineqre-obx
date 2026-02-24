import {
  pgTable,
  bigserial,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { stocks } from "./001_initial";

/**
 * News Events Table
 *
 * Stores classified news events from IBKR (Dow Jones, Briefing, FLY)
 * and other sources (NewsWeb, manual).
 * Each event is AI-classified with severity, sentiment, and event type.
 */
export const newsEvents = pgTable(
  "news_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    source: varchar("source", { length: 30 }).notNull(),
    headline: text("headline").notNull(),
    summary: text("summary"),
    url: text("url"),
    rawContent: text("raw_content"),
    articleId: varchar("article_id", { length: 100 }),

    // AI classification
    eventType: varchar("event_type", { length: 30 }).notNull(),
    severity: integer("severity").notNull(),
    sentiment: numeric("sentiment", { precision: 4, scale: 3 }),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),

    // IBKR metadata (parsed from headline tags)
    providerCode: varchar("provider_code", { length: 20 }),
    ibkrSentiment: numeric("ibkr_sentiment", { precision: 4, scale: 3 }),
    ibkrConfidence: numeric("ibkr_confidence", { precision: 4, scale: 3 }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      articleSourceUnique: unique().on(table.articleId, table.source),
      publishedIdx: index("idx_news_events_published").on(table.publishedAt),
      eventTypeIdx: index("idx_news_events_type").on(table.eventType),
      sourceIdx: index("idx_news_events_source").on(table.source),
      severityCheck: check(
        "news_events_severity_check",
        sql`${table.severity} >= 1 AND ${table.severity} <= 5`
      ),
      sentimentCheck: check(
        "news_events_sentiment_check",
        sql`${table.sentiment} >= -1 AND ${table.sentiment} <= 1`
      ),
      confidenceCheck: check(
        "news_events_confidence_check",
        sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`
      ),
    };
  }
);

/**
 * News ↔ Ticker Mapping
 *
 * Links news events to affected stock tickers with relevance scores.
 */
export const newsTickerMap = pgTable(
  "news_ticker_map",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    newsEventId: bigserial("news_event_id", { mode: "bigint" })
      .notNull()
      .references(() => newsEvents.id, { onDelete: "cascade" }),
    ticker: varchar("ticker", { length: 20 })
      .notNull()
      .references(() => stocks.ticker, { onDelete: "cascade" }),
    relevanceScore: numeric("relevance_score", { precision: 4, scale: 3 }),
    impactDirection: varchar("impact_direction", { length: 10 }).notNull(),
  },
  (table) => {
    return {
      eventTickerUnique: unique().on(table.newsEventId, table.ticker),
      tickerIdx: index("idx_news_ticker_map_ticker").on(
        table.ticker,
        table.newsEventId
      ),
    };
  }
);

/**
 * News ↔ Sector Mapping
 *
 * Links news events to affected sectors with impact scores.
 */
export const newsSectorMap = pgTable(
  "news_sector_map",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    newsEventId: bigserial("news_event_id", { mode: "bigint" })
      .notNull()
      .references(() => newsEvents.id, { onDelete: "cascade" }),
    sector: text("sector").notNull(),
    impactScore: numeric("impact_score", { precision: 4, scale: 3 }),
  },
  (table) => {
    return {
      eventSectorUnique: unique().on(table.newsEventId, table.sector),
      sectorIdx: index("idx_news_sector_map_sector").on(table.sector),
    };
  }
);

export type NewsEvent = typeof newsEvents.$inferSelect;
export type NewNewsEvent = typeof newsEvents.$inferInsert;

export type NewsTickerMap = typeof newsTickerMap.$inferSelect;
export type NewNewsTickerMap = typeof newsTickerMap.$inferInsert;

export type NewsSectorMap = typeof newsSectorMap.$inferSelect;
export type NewNewsSectorMap = typeof newsSectorMap.$inferInsert;
