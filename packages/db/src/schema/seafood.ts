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
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";

/**
 * Seafood Production Areas — 13 Norwegian coastal zones
 *
 * Each area has a traffic light status (green/yellow/red) set by
 * Nærings- og fiskeridepartementet every ~2 years based on
 * environmental impact of aquaculture (primarily salmon lice on wild salmon).
 */
export const seafoodProductionAreas = pgTable(
  "seafood_production_areas",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    areaNumber: integer("area_number").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    trafficLight: varchar("traffic_light", { length: 10 }).notNull(), // green, yellow, red
    decisionDate: date("decision_date"),
    nextReviewDate: date("next_review_date"),
    capacityChangePct: numeric("capacity_change_pct", { precision: 6, scale: 2 }),
    boundaryGeoJson: jsonb("boundary_geojson"), // simplified polygon
    centerLat: numeric("center_lat", { precision: 10, scale: 6 }),
    centerLng: numeric("center_lng", { precision: 10, scale: 6 }),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    areaNumberUnique: unique().on(table.areaNumber),
    areaNumberIdx: index("idx_seafood_prod_areas_number").on(table.areaNumber),
  })
);

/**
 * Seafood Localities — fish farm sites along Norway's coast
 *
 * Source: BarentsWatch / Fiskeridirektoratet
 * Each locality has a unique ID, company owner, and geographic coordinates.
 */
export const seafoodLocalities = pgTable(
  "seafood_localities",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    localityId: integer("locality_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    companyName: varchar("company_name", { length: 255 }),
    ticker: varchar("ticker", { length: 20 }), // mapped OSE ticker
    municipalityName: varchar("municipality_name", { length: 100 }),
    municipalityNumber: varchar("municipality_number", { length: 10 }),
    productionAreaNumber: integer("production_area_number"),
    lat: numeric("lat", { precision: 10, scale: 6 }),
    lng: numeric("lng", { precision: 10, scale: 6 }),
    hasBiomass: boolean("has_biomass").default(false),
    isActive: boolean("is_active").default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    localityIdUnique: unique().on(table.localityId),
    localityIdIdx: index("idx_seafood_localities_locality_id").on(table.localityId),
    tickerIdx: index("idx_seafood_localities_ticker").on(table.ticker),
    productionAreaIdx: index("idx_seafood_localities_prod_area").on(table.productionAreaNumber),
  })
);

/**
 * Seafood Lice Reports — weekly sea lice counts per locality
 *
 * Source: BarentsWatch Fish Health API
 * Key metric: avgAdultFemaleLice (treatment threshold = 0.5)
 */
export const seafoodLiceReports = pgTable(
  "seafood_lice_reports",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    localityId: integer("locality_id").notNull(),
    year: integer("year").notNull(),
    week: integer("week").notNull(),
    avgAdultFemaleLice: numeric("avg_adult_female_lice", { precision: 8, scale: 4 }),
    avgMobileLice: numeric("avg_mobile_lice", { precision: 8, scale: 4 }),
    avgStationaryLice: numeric("avg_stationary_lice", { precision: 8, scale: 4 }),
    seaTemperature: numeric("sea_temperature", { precision: 5, scale: 2 }),
    hasCleaning: boolean("has_cleaning").default(false),
    hasMechanicalRemoval: boolean("has_mechanical_removal").default(false),
    hasMedicinalTreatment: boolean("has_medicinal_treatment").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    localityWeekUnique: unique().on(table.localityId, table.year, table.week),
    localityIdx: index("idx_seafood_lice_locality").on(table.localityId),
    yearWeekIdx: index("idx_seafood_lice_year_week").on(table.year, table.week),
  })
);

/**
 * Seafood Diseases — disease outbreak reports
 *
 * Source: BarentsWatch Fish Health API
 * Tracks ISA, PD, IHN and other notifiable diseases.
 */
export const seafoodDiseases = pgTable(
  "seafood_diseases",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    localityId: integer("locality_id").notNull(),
    diseaseName: varchar("disease_name", { length: 100 }).notNull(),
    reportDate: date("report_date").notNull(),
    status: varchar("status", { length: 40 }), // confirmed, suspected, resolved
    severity: integer("severity"), // 1-5
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    localityDiseaseUnique: unique().on(table.localityId, table.diseaseName, table.reportDate),
    localityIdx: index("idx_seafood_diseases_locality").on(table.localityId),
    reportDateIdx: index("idx_seafood_diseases_date").on(table.reportDate),
    diseaseIdx: index("idx_seafood_diseases_name").on(table.diseaseName),
  })
);

/**
 * Seafood Company Metrics — aggregated per-company seafood risk metrics
 *
 * Computed from lice reports + locality data. Updated weekly.
 */
export const seafoodCompanyMetrics = pgTable(
  "seafood_company_metrics",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    companyName: varchar("company_name", { length: 255 }).notNull(),
    asOfDate: date("as_of_date").notNull(),
    activeSites: integer("active_sites"),
    avgLice4w: numeric("avg_lice_4w", { precision: 8, scale: 4 }),
    pctAboveThreshold: numeric("pct_above_threshold", { precision: 6, scale: 2 }),
    treatmentRate: numeric("treatment_rate", { precision: 6, scale: 2 }),
    avgSeaTemp: numeric("avg_sea_temp", { precision: 5, scale: 2 }),
    riskScore: numeric("risk_score", { precision: 5, scale: 2 }),
    productionAreas: jsonb("production_areas"), // array of area numbers
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tickerDateUnique: unique().on(table.ticker, table.asOfDate),
    tickerIdx: index("idx_seafood_company_metrics_ticker").on(table.ticker),
    dateIdx: index("idx_seafood_company_metrics_date").on(table.asOfDate),
  })
);

/**
 * Seafood Biomass Monthly — production area level biomass & harvest data
 *
 * Source: Fiskeridirektoratet CSV downloads (register.fiskeridir.no)
 * Updated monthly on the 20th. Covers all 13 production areas.
 */
export const seafoodBiomassMonthly = pgTable(
  "seafood_biomass_monthly",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    areaNumber: integer("area_number").notNull(),
    month: date("month").notNull(), // first of month: 2025-01-01
    species: varchar("species", { length: 40 }).notNull().default("salmon"), // salmon, trout
    biomasstonnes: numeric("biomass_tonnes", { precision: 12, scale: 2 }),
    harvestTonnes: numeric("harvest_tonnes", { precision: 12, scale: 2 }),
    mortalityTonnes: numeric("mortality_tonnes", { precision: 12, scale: 2 }),
    feedTonnes: numeric("feed_tonnes", { precision: 12, scale: 2 }),
    stockCount: integer("stock_count"), // number of fish
    pensInUse: integer("pens_in_use"),
    sitesInUse: integer("sites_in_use"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    areaMonthSpeciesUnique: unique().on(table.areaNumber, table.month, table.species),
    areaIdx: index("idx_seafood_biomass_area").on(table.areaNumber),
    monthIdx: index("idx_seafood_biomass_month").on(table.month),
  })
);

/**
 * Seafood Export Weekly — SSB salmon export price and volume
 *
 * Source: Statistics Norway (SSB) PxWebApi v2 — Table 03024
 * Weekly data: export price NOK/kg and volume in tonnes.
 */
export const seafoodExportWeekly = pgTable(
  "seafood_export_weekly",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    weekStart: date("week_start").notNull(), // Monday of the week
    priceNokKg: numeric("price_nok_kg", { precision: 8, scale: 2 }),
    volumeTonnes: numeric("volume_tonnes", { precision: 12, scale: 2 }),
    category: varchar("category", { length: 40 }).notNull().default("all"), // all, fresh, frozen
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    weekCategoryUnique: unique().on(table.weekStart, table.category),
    weekIdx: index("idx_seafood_export_week").on(table.weekStart),
  })
);

/**
 * Seafood Ocean Conditions — sea temperature aggregated per production area
 *
 * Source: Aggregated from seafood_lice_reports.sea_temperature field
 * (originally from BarentsWatch FishHealth API)
 */
export const seafoodOceanConditions = pgTable(
  "seafood_ocean_conditions",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    areaNumber: integer("area_number").notNull(),
    year: integer("year").notNull(),
    week: integer("week").notNull(),
    avgSeaTemp: numeric("avg_sea_temp", { precision: 5, scale: 2 }),
    minSeaTemp: numeric("min_sea_temp", { precision: 5, scale: 2 }),
    maxSeaTemp: numeric("max_sea_temp", { precision: 5, scale: 2 }),
    reportingSites: integer("reporting_sites"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    areaYearWeekUnique: unique().on(table.areaNumber, table.year, table.week),
    areaIdx: index("idx_seafood_ocean_area").on(table.areaNumber),
    yearWeekIdx: index("idx_seafood_ocean_year_week").on(table.year, table.week),
  })
);

// Type exports
export type SeafoodProductionArea = typeof seafoodProductionAreas.$inferSelect;
export type NewSeafoodProductionArea = typeof seafoodProductionAreas.$inferInsert;

export type SeafoodLocality = typeof seafoodLocalities.$inferSelect;
export type NewSeafoodLocality = typeof seafoodLocalities.$inferInsert;

export type SeafoodLiceReport = typeof seafoodLiceReports.$inferSelect;
export type NewSeafoodLiceReport = typeof seafoodLiceReports.$inferInsert;

export type SeafoodDisease = typeof seafoodDiseases.$inferSelect;
export type NewSeafoodDisease = typeof seafoodDiseases.$inferInsert;

export type SeafoodCompanyMetric = typeof seafoodCompanyMetrics.$inferSelect;
export type NewSeafoodCompanyMetric = typeof seafoodCompanyMetrics.$inferInsert;

export type SeafoodBiomassMonthly = typeof seafoodBiomassMonthly.$inferSelect;
export type NewSeafoodBiomassMonthly = typeof seafoodBiomassMonthly.$inferInsert;

export type SeafoodExportWeekly = typeof seafoodExportWeekly.$inferSelect;
export type NewSeafoodExportWeekly = typeof seafoodExportWeekly.$inferInsert;

export type SeafoodOceanCondition = typeof seafoodOceanConditions.$inferSelect;
export type NewSeafoodOceanCondition = typeof seafoodOceanConditions.$inferInsert;
