-- Harvest Tracker Tables
-- Tracks wellboat trips from fish farms to slaughterhouses
-- to estimate per-company quarterly harvest volumes and price realization.

-- 1. Wellboat/harvest vessel registry
CREATE TABLE IF NOT EXISTS harvest_vessels (
  id BIGSERIAL PRIMARY KEY,
  vessel_name VARCHAR(255) NOT NULL,
  imo VARCHAR(20),
  mmsi VARCHAR(20),
  owner_company VARCHAR(255),
  operator_ticker VARCHAR(20),
  capacity_tonnes NUMERIC(8,0),
  vessel_type VARCHAR(30) NOT NULL DEFAULT 'wellboat',
  built_year INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (vessel_name)
);
CREATE INDEX IF NOT EXISTS idx_harvest_vessels_mmsi ON harvest_vessels(mmsi);
CREATE INDEX IF NOT EXISTS idx_harvest_vessels_owner ON harvest_vessels(owner_company);

-- 2. Slaughterhouse / processing plant locations
CREATE TABLE IF NOT EXISTS harvest_slaughterhouses (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  ticker VARCHAR(20) NOT NULL,
  lat NUMERIC(10,6),
  lng NUMERIC(10,6),
  municipality VARCHAR(100),
  production_area_number INTEGER,
  capacity_tonnes_day NUMERIC(8,0),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (name)
);
CREATE INDEX IF NOT EXISTS idx_harvest_slaughterhouses_ticker ON harvest_slaughterhouses(ticker);
CREATE INDEX IF NOT EXISTS idx_harvest_slaughterhouses_area ON harvest_slaughterhouses(production_area_number);

-- 3. Detected harvest trips (farm → slaughterhouse)
CREATE TABLE IF NOT EXISTS harvest_trips (
  id BIGSERIAL PRIMARY KEY,
  vessel_id INTEGER,
  vessel_name VARCHAR(255) NOT NULL,
  origin_locality_id INTEGER,
  origin_name VARCHAR(255),
  origin_ticker VARCHAR(20),
  destination_slaughterhouse_id INTEGER,
  destination_name VARCHAR(255),
  departure_time TIMESTAMPTZ NOT NULL,
  arrival_time TIMESTAMPTZ,
  duration_hours NUMERIC(6,1),
  estimated_volume_tonnes NUMERIC(10,1),
  load_factor NUMERIC(3,2) DEFAULT 0.80,
  spot_price_at_harvest NUMERIC(8,2),
  production_area_number INTEGER,
  status VARCHAR(20) DEFAULT 'detected',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (vessel_name, departure_time)
);
CREATE INDEX IF NOT EXISTS idx_harvest_trips_origin_ticker ON harvest_trips(origin_ticker);
CREATE INDEX IF NOT EXISTS idx_harvest_trips_departure ON harvest_trips(departure_time);
CREATE INDEX IF NOT EXISTS idx_harvest_trips_area ON harvest_trips(production_area_number);

-- 4. Quarterly harvest estimates per company
CREATE TABLE IF NOT EXISTS harvest_quarterly_estimates (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  year INTEGER NOT NULL,
  quarter INTEGER NOT NULL,
  estimated_harvest_tonnes NUMERIC(12,0),
  trip_count INTEGER,
  estimated_avg_price_nok NUMERIC(8,2),
  actual_harvest_tonnes NUMERIC(12,0),
  actual_price_realization NUMERIC(8,2),
  estimation_accuracy_pct NUMERIC(6,2),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker, year, quarter)
);
CREATE INDEX IF NOT EXISTS idx_harvest_estimates_ticker ON harvest_quarterly_estimates(ticker);
CREATE INDEX IF NOT EXISTS idx_harvest_estimates_yq ON harvest_quarterly_estimates(year, quarter);
