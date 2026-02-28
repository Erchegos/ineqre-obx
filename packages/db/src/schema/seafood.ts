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
