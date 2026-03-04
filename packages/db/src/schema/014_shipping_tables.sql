-- Shipping intelligence tables for OSE-listed shipping companies
-- Covers fleet registry, AIS positions, charter contracts, market rates, and ports

-- 1. Shipping Companies — OSE-listed shipping companies with fleet metadata
CREATE TABLE IF NOT EXISTS shipping_companies (
  id            BIGSERIAL PRIMARY KEY,
  ticker        VARCHAR(20)  NOT NULL,
  company_name  VARCHAR(255) NOT NULL,
  sector        VARCHAR(30)  NOT NULL,  -- tanker, dry_bulk, container, car_carrier, chemical, gas
  fleet_size    INTEGER,
  fleet_owned   INTEGER,
  fleet_chartered_in INTEGER,
  avg_vessel_age NUMERIC(5,1),
  total_dwt     NUMERIC(14,0),
  headquarters  VARCHAR(100),
  website       TEXT,
  color_hex     VARCHAR(7),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker)
);

CREATE INDEX IF NOT EXISTS idx_shipping_companies_ticker ON shipping_companies (ticker);
CREATE INDEX IF NOT EXISTS idx_shipping_companies_sector ON shipping_companies (sector);


-- 2. Shipping Vessels — individual vessel registry
CREATE TABLE IF NOT EXISTS shipping_vessels (
  id              BIGSERIAL PRIMARY KEY,
  imo             VARCHAR(20)  NOT NULL,
  mmsi            VARCHAR(20),
  vessel_name     VARCHAR(255) NOT NULL,
  vessel_type     VARCHAR(50)  NOT NULL,  -- vlcc, suezmax, aframax_lr2, capesize, panamax_bulk, etc.
  company_ticker  VARCHAR(20)  NOT NULL,
  flag            VARCHAR(60),
  dwt             INTEGER,
  teu             INTEGER,     -- container ships only
  cbm             INTEGER,     -- gas carriers only
  built_year      INTEGER,
  builder         VARCHAR(255),
  class_society   VARCHAR(50),
  ice_class       VARCHAR(10),
  scrubber_fitted BOOLEAN DEFAULT FALSE,
  status          VARCHAR(30) NOT NULL DEFAULT 'active',  -- active, laid_up, drydock, scrapped, sold
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (imo)
);

CREATE INDEX IF NOT EXISTS idx_shipping_vessels_imo    ON shipping_vessels (imo);
CREATE INDEX IF NOT EXISTS idx_shipping_vessels_ticker ON shipping_vessels (company_ticker);
CREATE INDEX IF NOT EXISTS idx_shipping_vessels_type   ON shipping_vessels (vessel_type);


-- 3. Shipping Positions — AIS-derived vessel positions
CREATE TABLE IF NOT EXISTS shipping_positions (
  id                   BIGSERIAL PRIMARY KEY,
  imo                  VARCHAR(20)  NOT NULL,
  latitude             NUMERIC(9,6) NOT NULL,
  longitude            NUMERIC(10,6) NOT NULL,
  speed_knots          NUMERIC(5,1),
  heading              INTEGER,
  course               INTEGER,
  draught              NUMERIC(4,1),
  destination          TEXT,
  destination_port_name TEXT,
  eta                  TIMESTAMPTZ,
  nav_status           VARCHAR(40)  DEFAULT 'unknown',  -- under_way, at_anchor, moored, etc.
  operational_status   VARCHAR(30)  DEFAULT 'unknown',  -- at_sea, anchored, in_port, loading, discharging, waiting, idle
  current_region       VARCHAR(60),
  reported_at          TIMESTAMPTZ  NOT NULL,
  source               VARCHAR(30)  DEFAULT 'mock',     -- mock, kystverket, marinetraffic
  created_at           TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipping_positions_imo_ts ON shipping_positions (imo, reported_at);
CREATE INDEX IF NOT EXISTS idx_shipping_positions_imo    ON shipping_positions (imo);


-- 4. Shipping Vessel Contracts — per-vessel charter employment
CREATE TABLE IF NOT EXISTS shipping_vessel_contracts (
  id                      BIGSERIAL PRIMARY KEY,
  imo                     VARCHAR(20)  NOT NULL,
  contract_type           VARCHAR(30)  NOT NULL,          -- time_charter, voyage_charter, spot, coa, pool, bareboat, idle
  rate_usd_per_day        NUMERIC(10,2),
  rate_worldscale         NUMERIC(6,1),
  charterer               VARCHAR(255),
  contract_start          DATE,
  contract_end            DATE,
  contract_duration_months INTEGER,
  is_current              BOOLEAN DEFAULT TRUE,
  option_periods          TEXT,
  profit_share_pct        NUMERIC(5,2),
  source_quarter          VARCHAR(20)  NOT NULL,          -- e.g. "Q4 2024"
  source_document         TEXT,
  notes                   TEXT,
  updated_at              TIMESTAMPTZ  DEFAULT NOW(),
  created_at              TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipping_contracts_imo     ON shipping_vessel_contracts (imo);
CREATE INDEX IF NOT EXISTS idx_shipping_contracts_current ON shipping_vessel_contracts (is_current);


-- 5. Shipping Company Rates — aggregated company-level rate data from quarterly reports
CREATE TABLE IF NOT EXISTS shipping_company_rates (
  id                    BIGSERIAL PRIMARY KEY,
  ticker                VARCHAR(20) NOT NULL,
  vessel_class          VARCHAR(50) NOT NULL,             -- VLCC, Suezmax, Capesize, etc.
  rate_type             VARCHAR(30) NOT NULL,             -- tc_equivalent, spot_average, blended
  rate_usd_per_day      NUMERIC(10,2) NOT NULL,
  contract_coverage_pct NUMERIC(5,1),
  spot_exposure_pct     NUMERIC(5,1),
  vessels_in_class      INTEGER,
  quarter               VARCHAR(10) NOT NULL,             -- Q1 2024
  period_start          DATE,
  period_end            DATE,
  is_guidance           BOOLEAN DEFAULT FALSE,
  source_label          TEXT,
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker, quarter, vessel_class)
);

CREATE INDEX IF NOT EXISTS idx_shipping_company_rates_ticker  ON shipping_company_rates (ticker);
CREATE INDEX IF NOT EXISTS idx_shipping_company_rates_quarter ON shipping_company_rates (quarter);


-- 6. Shipping Market Rates — benchmark freight rate indices
CREATE TABLE IF NOT EXISTS shipping_market_rates (
  id                 BIGSERIAL PRIMARY KEY,
  index_name         VARCHAR(50)  NOT NULL,               -- BDI, BDTI, BCTI, VLCC_TD3C_TCE, CAPESIZE_5TC, etc.
  index_display_name VARCHAR(100) NOT NULL,
  rate_value         NUMERIC(12,2) NOT NULL,
  rate_unit          VARCHAR(20)  NOT NULL,               -- index_points, usd_per_day, worldscale
  rate_date          DATE         NOT NULL,
  source             VARCHAR(50)  DEFAULT 'manual',
  created_at         TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (index_name, rate_date)
);

CREATE INDEX IF NOT EXISTS idx_shipping_market_rates_index ON shipping_market_rates (index_name);
CREATE INDEX IF NOT EXISTS idx_shipping_market_rates_date  ON shipping_market_rates (rate_date);


-- 7. Shipping Ports — reference table for major ports
CREATE TABLE IF NOT EXISTS shipping_ports (
  id         BIGSERIAL PRIMARY KEY,
  unlocode   VARCHAR(10),
  port_name  VARCHAR(255) NOT NULL,
  country    VARCHAR(60)  NOT NULL,
  latitude   NUMERIC(9,6),
  longitude  NUMERIC(10,6),
  port_type  VARCHAR(30),             -- crude_terminal, product_terminal, dry_bulk, container, lng, lpg, multipurpose
  region     VARCHAR(60),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (unlocode)
);

CREATE INDEX IF NOT EXISTS idx_shipping_ports_type   ON shipping_ports (port_type);
CREATE INDEX IF NOT EXISTS idx_shipping_ports_region ON shipping_ports (region);
