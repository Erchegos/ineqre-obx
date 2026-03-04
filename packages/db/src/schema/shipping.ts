import {
  pgTable,
  bigserial,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  date,
  boolean,
  unique,
  index,
} from "drizzle-orm/pg-core";

/**
 * Shipping Companies — OSE-listed shipping companies with fleet metadata
 *
 * Links to the existing `stocks` table via ticker.
 * Covers tanker, dry bulk, container, car carrier, chemical, and gas segments.
 */
export const shippingCompanies = pgTable(
  "shipping_companies",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    companyName: varchar("company_name", { length: 255 }).notNull(),
    sector: varchar("sector", { length: 30 }).notNull(), // tanker, dry_bulk, container, car_carrier, chemical, gas
    fleetSize: integer("fleet_size"),
    fleetOwned: integer("fleet_owned"),
    fleetCharteredIn: integer("fleet_chartered_in"),
    avgVesselAge: numeric("avg_vessel_age", { precision: 5, scale: 1 }),
    totalDwt: numeric("total_dwt", { precision: 14, scale: 0 }),
    headquarters: varchar("headquarters", { length: 100 }),
    website: text("website"),
    colorHex: varchar("color_hex", { length: 7 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tickerUnique: unique().on(table.ticker),
    tickerIdx: index("idx_shipping_companies_ticker").on(table.ticker),
    sectorIdx: index("idx_shipping_companies_sector").on(table.sector),
  })
);

/**
 * Shipping Vessels — individual vessel registry
 *
 * Each vessel belongs to a company (via ticker) and has an IMO number
 * (universal vessel identifier). Vessel types span all covered segments.
 */
export const shippingVessels = pgTable(
  "shipping_vessels",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    imo: varchar("imo", { length: 20 }).notNull(),
    mmsi: varchar("mmsi", { length: 20 }),
    vesselName: varchar("vessel_name", { length: 255 }).notNull(),
    vesselType: varchar("vessel_type", { length: 50 }).notNull(), // vlcc, suezmax, aframax_lr2, capesize, panamax_bulk, etc.
    companyTicker: varchar("company_ticker", { length: 20 }).notNull(),
    flag: varchar("flag", { length: 60 }),
    dwt: integer("dwt"),
    teu: integer("teu"), // container ships only
    cbm: integer("cbm"), // gas carriers only
    builtYear: integer("built_year"),
    builder: varchar("builder", { length: 255 }),
    classSociety: varchar("class_society", { length: 50 }),
    iceClass: varchar("ice_class", { length: 10 }),
    scrubberFitted: boolean("scrubber_fitted").default(false),
    status: varchar("status", { length: 30 }).notNull().default("active"), // active, laid_up, drydock, scrapped, sold
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    imoUnique: unique().on(table.imo),
    imoIdx: index("idx_shipping_vessels_imo").on(table.imo),
    tickerIdx: index("idx_shipping_vessels_ticker").on(table.companyTicker),
    typeIdx: index("idx_shipping_vessels_type").on(table.vesselType),
  })
);

/**
 * Shipping Positions — AIS-derived vessel positions
 *
 * Each row is a point-in-time snapshot. For initial build, one row per vessel.
 * Structure supports a real AIS feed writing new rows on a schedule.
 */
export const shippingPositions = pgTable(
  "shipping_positions",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    imo: varchar("imo", { length: 20 }).notNull(),
    latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
    longitude: numeric("longitude", { precision: 10, scale: 6 }).notNull(),
    speedKnots: numeric("speed_knots", { precision: 5, scale: 1 }),
    heading: integer("heading"),
    course: integer("course"),
    draught: numeric("draught", { precision: 4, scale: 1 }),
    destination: text("destination"),
    destinationPortName: text("destination_port_name"),
    eta: timestamp("eta", { withTimezone: true }),
    navStatus: varchar("nav_status", { length: 40 }).default("unknown"), // under_way, at_anchor, moored, etc.
    operationalStatus: varchar("operational_status", { length: 30 }).default("unknown"), // at_sea, anchored, in_port, loading, discharging, waiting, idle
    currentRegion: varchar("current_region", { length: 60 }),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull(),
    source: varchar("source", { length: 30 }).default("mock"), // mock, kystverket, marinetraffic
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    imoTimestampIdx: index("idx_shipping_positions_imo_ts").on(table.imo, table.reportedAt),
    imoIdx: index("idx_shipping_positions_imo").on(table.imo),
  })
);

/**
 * Shipping Vessel Contracts — per-vessel charter employment
 *
 * Links each vessel to its current running rate. The core value proposition:
 * seeing what revenue each ship is earning per day.
 */
export const shippingVesselContracts = pgTable(
  "shipping_vessel_contracts",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    imo: varchar("imo", { length: 20 }).notNull(),
    contractType: varchar("contract_type", { length: 30 }).notNull(), // time_charter, voyage_charter, spot, coa, pool, bareboat, idle
    rateUsdPerDay: numeric("rate_usd_per_day", { precision: 10, scale: 2 }),
    rateWorldscale: numeric("rate_worldscale", { precision: 6, scale: 1 }),
    charterer: varchar("charterer", { length: 255 }),
    contractStart: date("contract_start"),
    contractEnd: date("contract_end"),
    contractDurationMonths: integer("contract_duration_months"),
    isCurrent: boolean("is_current").default(true),
    optionPeriods: text("option_periods"),
    profitSharePct: numeric("profit_share_pct", { precision: 5, scale: 2 }),
    sourceQuarter: varchar("source_quarter", { length: 20 }).notNull(), // e.g. "Q4 2024"
    sourceDocument: text("source_document"),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    imoIdx: index("idx_shipping_contracts_imo").on(table.imo),
    currentIdx: index("idx_shipping_contracts_current").on(table.isCurrent),
  })
);

/**
 * Shipping Company Rates — aggregated company-level rate data from quarterly reports
 *
 * Supplements vessel-level data when individual contracts aren't disclosed.
 */
export const shippingCompanyRates = pgTable(
  "shipping_company_rates",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    vesselClass: varchar("vessel_class", { length: 50 }).notNull(), // VLCC, Suezmax, Capesize, etc.
    rateType: varchar("rate_type", { length: 30 }).notNull(), // tc_equivalent, spot_average, blended
    rateUsdPerDay: numeric("rate_usd_per_day", { precision: 10, scale: 2 }).notNull(),
    contractCoveragePct: numeric("contract_coverage_pct", { precision: 5, scale: 1 }),
    spotExposurePct: numeric("spot_exposure_pct", { precision: 5, scale: 1 }),
    vesselsInClass: integer("vessels_in_class"),
    quarter: varchar("quarter", { length: 10 }).notNull(), // Q1 2024
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    isGuidance: boolean("is_guidance").default(false),
    sourceLabel: text("source_label"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tickerQuarterClassUnique: unique().on(table.ticker, table.quarter, table.vesselClass),
    tickerIdx: index("idx_shipping_company_rates_ticker").on(table.ticker),
    quarterIdx: index("idx_shipping_company_rates_quarter").on(table.quarter),
  })
);

/**
 * Shipping Market Rates — benchmark freight rate indices
 *
 * Baltic Exchange indices, Worldscale assessments, and vessel-class TCE benchmarks.
 * Used for comparison against company contracted rates.
 */
export const shippingMarketRates = pgTable(
  "shipping_market_rates",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    indexName: varchar("index_name", { length: 50 }).notNull(), // BDI, BDTI, BCTI, VLCC_TD3C_TCE, CAPESIZE_5TC, etc.
    indexDisplayName: varchar("index_display_name", { length: 100 }).notNull(),
    rateValue: numeric("rate_value", { precision: 12, scale: 2 }).notNull(),
    rateUnit: varchar("rate_unit", { length: 20 }).notNull(), // index_points, usd_per_day, worldscale
    rateDate: date("rate_date").notNull(),
    source: varchar("source", { length: 50 }).default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    indexDateUnique: unique().on(table.indexName, table.rateDate),
    indexNameIdx: index("idx_shipping_market_rates_index").on(table.indexName),
    rateDateIdx: index("idx_shipping_market_rates_date").on(table.rateDate),
  })
);

/**
 * Shipping Ports — reference table for major ports
 *
 * Used for map labels and destination resolution.
 */
export const shippingPorts = pgTable(
  "shipping_ports",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    unlocode: varchar("unlocode", { length: 10 }),
    portName: varchar("port_name", { length: 255 }).notNull(),
    country: varchar("country", { length: 60 }).notNull(),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 10, scale: 6 }),
    portType: varchar("port_type", { length: 30 }), // crude_terminal, product_terminal, dry_bulk, container, lng, lpg, multipurpose
    region: varchar("region", { length: 60 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    unlocodeUnique: unique().on(table.unlocode),
    portTypeIdx: index("idx_shipping_ports_type").on(table.portType),
    regionIdx: index("idx_shipping_ports_region").on(table.region),
  })
);

// Type exports
export type ShippingCompany = typeof shippingCompanies.$inferSelect;
export type NewShippingCompany = typeof shippingCompanies.$inferInsert;
export type ShippingVessel = typeof shippingVessels.$inferSelect;
export type NewShippingVessel = typeof shippingVessels.$inferInsert;
export type ShippingPosition = typeof shippingPositions.$inferSelect;
export type NewShippingPosition = typeof shippingPositions.$inferInsert;
export type ShippingVesselContract = typeof shippingVesselContracts.$inferSelect;
export type NewShippingVesselContract = typeof shippingVesselContracts.$inferInsert;
export type ShippingCompanyRate = typeof shippingCompanyRates.$inferSelect;
export type NewShippingCompanyRate = typeof shippingCompanyRates.$inferInsert;
export type ShippingMarketRate = typeof shippingMarketRates.$inferSelect;
export type NewShippingMarketRate = typeof shippingMarketRates.$inferInsert;
export type ShippingPort = typeof shippingPorts.$inferSelect;
export type NewShippingPort = typeof shippingPorts.$inferInsert;
