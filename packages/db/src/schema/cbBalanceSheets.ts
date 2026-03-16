/**
 * Central Bank Balance Sheet Data
 *
 * Used in the FX Terminal to show the Funding Regime Indicator —
 * a card per currency showing CB balance sheet as % of GDP, which
 * compresses domestic funding costs and increases demand for synthetic
 * USD via FX swaps.
 *
 * Source: Rime, Schrimpf & Syrstad (RFS 2022) Table 4:
 *   Large CB balance sheets → compressed domestic funding spreads
 *   → increased FX swap demand → wider cross-currency basis
 *
 * Data is static/quarterly — update manually each quarter.
 */

import { pgTable, serial, varchar, numeric, date, timestamp } from "drizzle-orm/pg-core";

export const cbBalanceSheets = pgTable("cb_balance_sheets", {
  id: serial("id").primaryKey(),
  currency: varchar("currency", { length: 3 }).notNull(),          // ISO currency code
  cbName: varchar("cb_name", { length: 100 }).notNull(),           // e.g. "Federal Reserve"
  balanceSheetPctGdp: numeric("balance_sheet_pct_gdp", { precision: 8, scale: 2 }).notNull(),
  asOfDate: date("as_of_date").notNull(),
  source: varchar("source", { length: 200 }),                       // e.g. "Fed H.4.1, BEA GDP"
  createdAt: timestamp("created_at").defaultNow(),
});
