-- Company Fundamentals Schema
-- Stores fundamental data from IBKR for stocks

-- Main table for company fundamentals
CREATE TABLE IF NOT EXISTS company_fundamentals (
  id SERIAL PRIMARY KEY,

  -- Identifiers
  ticker VARCHAR(20) NOT NULL UNIQUE,
  company_name VARCHAR(255),
  isin VARCHAR(50),
  ric VARCHAR(50),
  perm_id VARCHAR(50),

  -- Exchange info
  exchange VARCHAR(100),
  exchange_country VARCHAR(10),

  -- Basic info
  status VARCHAR(50),
  company_type VARCHAR(100),

  -- Operational data
  employees INTEGER,
  employees_last_updated DATE,
  shares_outstanding BIGINT,
  total_float BIGINT,
  shares_date DATE,
  reporting_currency VARCHAR(3),

  -- Industry classification
  sector VARCHAR(100),
  industry VARCHAR(255),
  trbc_code VARCHAR(50),

  -- Descriptions
  business_summary TEXT,
  financial_summary TEXT,

  -- Contact information
  address_street TEXT,
  address_city VARCHAR(100),
  address_state VARCHAR(100),
  address_postal_code VARCHAR(20),
  address_country VARCHAR(100),
  phone_main VARCHAR(50),
  phone_fax VARCHAR(50),
  email VARCHAR(255),
  website VARCHAR(500),

  -- Investor relations
  ir_contact_name VARCHAR(255),
  ir_contact_title VARCHAR(255),
  ir_contact_phone VARCHAR(50),

  -- Financial reporting dates
  latest_annual_date DATE,
  latest_interim_date DATE,
  last_modified DATE,
  last_updated TIMESTAMP,

  -- Raw data storage (for reference)
  raw_xml TEXT,
  raw_json JSONB,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Table for company officers
CREATE TABLE IF NOT EXISTS company_officers (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL REFERENCES company_fundamentals(ticker) ON DELETE CASCADE,

  rank INTEGER,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  age INTEGER,
  title VARCHAR(255),
  since DATE,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Table for industry codes
CREATE TABLE IF NOT EXISTS company_industry_codes (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL REFERENCES company_fundamentals(ticker) ON DELETE CASCADE,

  code_type VARCHAR(20), -- 'NAICS', 'SIC', 'TRBC'
  code VARCHAR(50),
  description VARCHAR(500),

  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_fundamentals_ticker ON company_fundamentals(ticker);
CREATE INDEX IF NOT EXISTS idx_fundamentals_exchange ON company_fundamentals(exchange);
CREATE INDEX IF NOT EXISTS idx_fundamentals_industry ON company_fundamentals(industry);
CREATE INDEX IF NOT EXISTS idx_fundamentals_updated ON company_fundamentals(updated_at);

CREATE INDEX IF NOT EXISTS idx_officers_ticker ON company_officers(ticker);
CREATE INDEX IF NOT EXISTS idx_industry_codes_ticker ON company_industry_codes(ticker);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers
DROP TRIGGER IF EXISTS update_fundamentals_updated_at ON company_fundamentals;
CREATE TRIGGER update_fundamentals_updated_at
  BEFORE UPDATE ON company_fundamentals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_officers_updated_at ON company_officers;
CREATE TRIGGER update_officers_updated_at
  BEFORE UPDATE ON company_officers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- View for easy querying with officers
CREATE OR REPLACE VIEW company_fundamentals_with_officers AS
SELECT
  cf.*,
  json_agg(
    json_build_object(
      'rank', co.rank,
      'name', co.first_name || ' ' || co.last_name,
      'age', co.age,
      'title', co.title,
      'since', co.since
    ) ORDER BY co.rank
  ) FILTER (WHERE co.ticker IS NOT NULL) as officers
FROM company_fundamentals cf
LEFT JOIN company_officers co ON cf.ticker = co.ticker
GROUP BY cf.id;

-- Comments
COMMENT ON TABLE company_fundamentals IS 'Fundamental data for companies from IBKR';
COMMENT ON TABLE company_officers IS 'Key executives and officers for companies';
COMMENT ON TABLE company_industry_codes IS 'Industry classification codes (NAICS, SIC, TRBC)';
COMMENT ON VIEW company_fundamentals_with_officers IS 'Company fundamentals with nested officers JSON';
