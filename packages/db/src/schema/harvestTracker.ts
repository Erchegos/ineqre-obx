import {
  pgTable,
  bigserial,
  varchar,
  text,
  integer,
  numeric,
  doublePrecision,
  timestamp,
  boolean,
  unique,
  index,
} from "drizzle-orm/pg-core";

/**
 * Harvest Vessels — wellboat/brønnbåt registry
 *
 * Norwegian wellboats that transport live salmon from farm locations
 * to slaughterhouses. Used for harvest tracking and volume estimation.
 * Major operators: Sølvtrans, Rostein, and company-owned fleets.
 */
export const harvestVessels = pgTable(
  "harvest_vessels",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    vesselName: varchar("vessel_name", { length: 255 }).notNull(),
    imo: varchar("imo", { length: 20 }),
    mmsi: varchar("mmsi", { length: 20 }),
    ownerCompany: varchar("owner_company", { length: 255 }),
    operatorTicker: varchar("operator_ticker", { length: 20 }), // MOWI, SALM, etc. if company-owned
    capacityTonnes: numeric("capacity_tonnes", { precision: 8, scale: 0 }),
    vesselType: varchar("vessel_type", { length: 30 }).notNull().default("wellboat"), // wellboat, harvest_boat, transport
    builtYear: integer("built_year"),
    isActive: boolean("is_active").default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    vesselNameUnique: unique().on(table.vesselName),
    mmsiIdx: index("idx_harvest_vessels_mmsi").on(table.mmsi),
    ownerIdx: index("idx_harvest_vessels_owner").on(table.ownerCompany),
  })
);

/**
 * Harvest Slaughterhouses — salmon processing plant locations
 *
 * Major Norwegian slaughterhouse facilities where harvested salmon
 * is processed. Used as trip destinations for harvest tracking.
 */
export const harvestSlaughterhouses = pgTable(
  "harvest_slaughterhouses",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    companyName: varchar("company_name", { length: 255 }).notNull(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    lat: numeric("lat", { precision: 10, scale: 6 }),
    lng: numeric("lng", { precision: 10, scale: 6 }),
    municipality: varchar("municipality", { length: 100 }),
    productionAreaNumber: integer("production_area_number"),
    capacityTonnesDay: numeric("capacity_tonnes_day", { precision: 8, scale: 0 }),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    nameUnique: unique().on(table.name),
    tickerIdx: index("idx_harvest_slaughterhouses_ticker").on(table.ticker),
    areaIdx: index("idx_harvest_slaughterhouses_area").on(table.productionAreaNumber),
  })
);

/**
 * Harvest Trips — detected farm → slaughterhouse transport trips
 *
 * Each row represents a wellboat trip from a fish farm to a slaughterhouse.
 * Detected via AIS proximity analysis or manually entered.
 * Volume estimated from vessel capacity × load factor.
 * Price matched to SISALMON spot price for the departure week.
 */
export const harvestTrips = pgTable(
  "harvest_trips",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    vesselId: integer("vessel_id"),
    vesselName: varchar("vessel_name", { length: 255 }).notNull(),
    originLocalityId: integer("origin_locality_id"),
    originName: varchar("origin_name", { length: 255 }),
    originTicker: varchar("origin_ticker", { length: 20 }),
    destinationSlaughterhouseId: integer("destination_slaughterhouse_id"),
    destinationName: varchar("destination_name", { length: 255 }),
    departureTime: timestamp("departure_time", { withTimezone: true }).notNull(),
    arrivalTime: timestamp("arrival_time", { withTimezone: true }),
    durationHours: numeric("duration_hours", { precision: 6, scale: 1 }),
    estimatedVolumeTonnes: numeric("estimated_volume_tonnes", { precision: 10, scale: 1 }),
    loadFactor: numeric("load_factor", { precision: 3, scale: 2 }).default("0.80"),
    spotPriceAtHarvest: numeric("spot_price_at_harvest", { precision: 8, scale: 2 }),
    productionAreaNumber: integer("production_area_number"),
    status: varchar("status", { length: 20 }).default("detected"), // detected, confirmed, manual
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    vesselDepartureUnique: unique().on(table.vesselName, table.departureTime),
    originTickerIdx: index("idx_harvest_trips_origin_ticker").on(table.originTicker),
    departureIdx: index("idx_harvest_trips_departure").on(table.departureTime),
    areaIdx: index("idx_harvest_trips_area").on(table.productionAreaNumber),
  })
);

/**
 * Harvest Quarterly Estimates — aggregated per-company per-quarter
 *
 * Combines trip data to estimate harvest volumes and average price
 * achieved per company per quarter. Compared against actual reported
 * figures from salmon_quarterly_ops after earnings.
 */
export const harvestQuarterlyEstimates = pgTable(
  "harvest_quarterly_estimates",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ticker: varchar("ticker", { length: 20 }).notNull(),
    companyName: varchar("company_name", { length: 255 }).notNull(),
    year: integer("year").notNull(),
    quarter: integer("quarter").notNull(),
    estimatedHarvestTonnes: numeric("estimated_harvest_tonnes", { precision: 12, scale: 0 }),
    tripCount: integer("trip_count"),
    estimatedAvgPriceNok: numeric("estimated_avg_price_nok", { precision: 8, scale: 2 }),
    actualHarvestTonnes: numeric("actual_harvest_tonnes", { precision: 12, scale: 0 }),
    actualPriceRealization: numeric("actual_price_realization", { precision: 8, scale: 2 }),
    estimationAccuracyPct: numeric("estimation_accuracy_pct", { precision: 6, scale: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    tickerYearQuarterUnique: unique().on(table.ticker, table.year, table.quarter),
    tickerIdx: index("idx_harvest_estimates_ticker").on(table.ticker),
    yearQuarterIdx: index("idx_harvest_estimates_yq").on(table.year, table.quarter),
  })
);

/**
 * Harvest Vessel Positions — AIS position history for route visualization
 *
 * Stores position updates from AISStream.io WebSocket for wellboats.
 * Used for route trail display on map and trip detection state machine.
 */
export const harvestVesselPositions = pgTable(
  "harvest_vessel_positions",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    vesselId: integer("vessel_id").notNull(),
    mmsi: varchar("mmsi", { length: 20 }),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    speedKnots: doublePrecision("speed_knots"),
    heading: integer("heading"),
    course: doublePrecision("course"),
    navStatus: varchar("nav_status", { length: 50 }),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    vesselTimestampIdx: index("idx_hvp_vessel_timestamp").on(table.vesselId, table.timestamp),
    mmsiTimestampIdx: index("idx_hvp_mmsi_timestamp").on(table.mmsi, table.timestamp),
    timestampIdx: index("idx_hvp_timestamp").on(table.timestamp),
  })
);

// Type exports
export type HarvestVessel = typeof harvestVessels.$inferSelect;
export type NewHarvestVessel = typeof harvestVessels.$inferInsert;

export type HarvestSlaughterhouse = typeof harvestSlaughterhouses.$inferSelect;
export type NewHarvestSlaughterhouse = typeof harvestSlaughterhouses.$inferInsert;

export type HarvestTrip = typeof harvestTrips.$inferSelect;
export type NewHarvestTrip = typeof harvestTrips.$inferInsert;

export type HarvestQuarterlyEstimate = typeof harvestQuarterlyEstimates.$inferSelect;
export type NewHarvestQuarterlyEstimate = typeof harvestQuarterlyEstimates.$inferInsert;

export type HarvestVesselPosition = typeof harvestVesselPositions.$inferSelect;
export type NewHarvestVesselPosition = typeof harvestVesselPositions.$inferInsert;
