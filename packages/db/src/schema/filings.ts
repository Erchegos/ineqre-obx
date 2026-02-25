import {
  pgTable,
  bigserial,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  boolean,
  jsonb,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * NewsWeb Filings — regulatory filings from Oslo Børs
 *
 * Source: newsweb.oslobors.no (Euronext Oslo)
 * Categories: insider_trade, mandatory_notification, earnings, buyback,
 *             dividend, management_change, other
 *
 * AI-classified with severity, sentiment, and structured facts extraction.
 */
export const newswebFilings = pgTable(
  "newsweb_filings",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }),
    issuerName: varchar("issuer_name", { length: 255 }).notNull(),
    category: varchar("category", { length: 40 }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    headline: text("headline").notNull(),
    body: text("body"),
    url: text("url"),
    newswebId: varchar("newsweb_id", { length: 50 }),

    // AI classification
    severity: integer("severity"),
    sentiment: numeric("sentiment", { precision: 4, scale: 3 }),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    aiSummary: text("ai_summary"),
    structuredFacts: jsonb("structured_facts"),

    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      newswebIdUnique: unique().on(table.newswebId),
      tickerIdx: index("idx_newsweb_filings_ticker").on(table.ticker),
      publishedIdx: index("idx_newsweb_filings_published").on(
        table.publishedAt
      ),
      categoryIdx: index("idx_newsweb_filings_category").on(table.category),
      severityCheck: check(
        "newsweb_filings_severity_check",
        sql`${table.severity} >= 1 AND ${table.severity} <= 5`
      ),
      sentimentCheck: check(
        "newsweb_filings_sentiment_check",
        sql`${table.sentiment} >= -1 AND ${table.sentiment} <= 1`
      ),
    };
  }
);

/**
 * Insider Transactions — structured insider trade data
 *
 * Extracted from NewsWeb filings of category 'insider_trade'.
 * Each row is one transaction (buy/sell/exercise) by one person.
 */
export const insiderTransactions = pgTable(
  "insider_transactions",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    filingId: bigserial("filing_id", { mode: "bigint" })
      .notNull()
      .references(() => newswebFilings.id, { onDelete: "cascade" }),
    transactionDate: timestamp("transaction_date", {
      withTimezone: true,
    }).notNull(),
    personName: varchar("person_name", { length: 255 }).notNull(),
    personRole: varchar("person_role", { length: 100 }),
    transactionType: varchar("transaction_type", { length: 20 }).notNull(),
    shares: numeric("shares", { precision: 20, scale: 0 }).notNull(),
    pricePerShare: numeric("price_per_share", { precision: 14, scale: 4 }),
    totalValueNok: numeric("total_value_nok", { precision: 20, scale: 2 }),
    holdingsAfter: numeric("holdings_after", { precision: 20, scale: 0 }),
    isRelatedParty: boolean("is_related_party").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      tickerIdx: index("idx_insider_transactions_ticker").on(table.ticker),
      dateIdx: index("idx_insider_transactions_date").on(
        table.transactionDate
      ),
      personIdx: index("idx_insider_transactions_person").on(table.personName),
      typeIdx: index("idx_insider_transactions_type").on(
        table.transactionType
      ),
      typeCheck: check(
        "insider_transactions_type_check",
        sql`${table.transactionType} IN ('BUY', 'SELL', 'EXERCISE', 'GRANT', 'OTHER')`
      ),
    };
  }
);

export type NewswebFiling = typeof newswebFilings.$inferSelect;
export type NewNewswebFiling = typeof newswebFilings.$inferInsert;

export type InsiderTransaction = typeof insiderTransactions.$inferSelect;
export type NewInsiderTransaction = typeof insiderTransactions.$inferInsert;
