-- Seafood Intelligence Tables
-- Run: psql $DATABASE_URL -f packages/db/src/schema/011_seafood_tables.sql

-- 1. Production Areas (13 Norwegian coastal zones)
CREATE TABLE IF NOT EXISTS seafood_production_areas (
  id BIGSERIAL PRIMARY KEY,
  area_number INTEGER NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  traffic_light VARCHAR(10) NOT NULL, -- green, yellow, red
  decision_date DATE,
  next_review_date DATE,
  capacity_change_pct NUMERIC(6,2),
  boundary_geojson JSONB,
  center_lat NUMERIC(10,6),
  center_lng NUMERIC(10,6),
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seafood_prod_areas_number ON seafood_production_areas(area_number);

-- 2. Localities (fish farm sites)
CREATE TABLE IF NOT EXISTS seafood_localities (
  id BIGSERIAL PRIMARY KEY,
  locality_id INTEGER NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  company_name VARCHAR(255),
  ticker VARCHAR(20),
  municipality_name VARCHAR(100),
  municipality_number VARCHAR(10),
  production_area_number INTEGER,
  lat NUMERIC(10,6),
  lng NUMERIC(10,6),
  has_biomass BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seafood_localities_locality_id ON seafood_localities(locality_id);
CREATE INDEX IF NOT EXISTS idx_seafood_localities_ticker ON seafood_localities(ticker);
CREATE INDEX IF NOT EXISTS idx_seafood_localities_prod_area ON seafood_localities(production_area_number);

-- 3. Lice Reports (weekly per locality)
CREATE TABLE IF NOT EXISTS seafood_lice_reports (
  id BIGSERIAL PRIMARY KEY,
  locality_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  week INTEGER NOT NULL,
  avg_adult_female_lice NUMERIC(8,4),
  avg_mobile_lice NUMERIC(8,4),
  avg_stationary_lice NUMERIC(8,4),
  sea_temperature NUMERIC(5,2),
  has_cleaning BOOLEAN DEFAULT FALSE,
  has_mechanical_removal BOOLEAN DEFAULT FALSE,
  has_medicinal_treatment BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(locality_id, year, week)
);

CREATE INDEX IF NOT EXISTS idx_seafood_lice_locality ON seafood_lice_reports(locality_id);
CREATE INDEX IF NOT EXISTS idx_seafood_lice_year_week ON seafood_lice_reports(year, week);

-- 4. Diseases
CREATE TABLE IF NOT EXISTS seafood_diseases (
  id BIGSERIAL PRIMARY KEY,
  locality_id INTEGER NOT NULL,
  disease_name VARCHAR(100) NOT NULL,
  report_date DATE NOT NULL,
  status VARCHAR(40),
  severity INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(locality_id, disease_name, report_date)
);

CREATE INDEX IF NOT EXISTS idx_seafood_diseases_locality ON seafood_diseases(locality_id);
CREATE INDEX IF NOT EXISTS idx_seafood_diseases_date ON seafood_diseases(report_date);
CREATE INDEX IF NOT EXISTS idx_seafood_diseases_name ON seafood_diseases(disease_name);

-- 5. Company Metrics (aggregated)
CREATE TABLE IF NOT EXISTS seafood_company_metrics (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  as_of_date DATE NOT NULL,
  active_sites INTEGER,
  avg_lice_4w NUMERIC(8,4),
  pct_above_threshold NUMERIC(6,2),
  treatment_rate NUMERIC(6,2),
  avg_sea_temp NUMERIC(5,2),
  risk_score NUMERIC(5,2),
  production_areas JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ticker, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_seafood_company_metrics_ticker ON seafood_company_metrics(ticker);
CREATE INDEX IF NOT EXISTS idx_seafood_company_metrics_date ON seafood_company_metrics(as_of_date);
