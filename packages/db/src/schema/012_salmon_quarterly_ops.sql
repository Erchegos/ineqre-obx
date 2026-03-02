-- 012: Salmon Quarterly Operations
-- Company-level quarterly financial/operational data from earnings reports

CREATE TABLE IF NOT EXISTS salmon_quarterly_ops (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL,
  year INTEGER NOT NULL,
  quarter INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  harvest_tonnes_gwt NUMERIC(12, 0),
  revenue_m NUMERIC(12, 1),
  ebit_operational_m NUMERIC(12, 1),
  ebit_per_kg NUMERIC(8, 2),
  cost_per_kg NUMERIC(8, 2),
  price_realization_per_kg NUMERIC(8, 2),
  mortality_pct NUMERIC(6, 2),
  currency VARCHAR(3) NOT NULL DEFAULT 'NOK',
  source VARCHAR(100),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker, year, quarter)
);

CREATE INDEX IF NOT EXISTS idx_salmon_qops_ticker ON salmon_quarterly_ops (ticker);
CREATE INDEX IF NOT EXISTS idx_salmon_qops_year_quarter ON salmon_quarterly_ops (year, quarter);
