-- Data Edge Intelligence Tables
-- Short positions, commodity prices, NewsWeb filings, insider transactions

-- ═══════════════════════════════════════════════════
-- Short Positions (Finanstilsynet SSR)
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS short_positions (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL,
  isin VARCHAR(12) NOT NULL,
  date DATE NOT NULL,
  short_pct NUMERIC(8, 4) NOT NULL CHECK (short_pct >= 0 AND short_pct <= 100),
  total_short_shares NUMERIC(20, 0),
  active_positions INTEGER NOT NULL,
  prev_short_pct NUMERIC(8, 4),
  change_pct NUMERIC(8, 4),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker, date)
);

CREATE INDEX IF NOT EXISTS idx_short_positions_ticker ON short_positions(ticker);
CREATE INDEX IF NOT EXISTS idx_short_positions_date ON short_positions(date);
CREATE INDEX IF NOT EXISTS idx_short_positions_short_pct ON short_positions(short_pct DESC);

CREATE TABLE IF NOT EXISTS short_position_holders (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL,
  isin VARCHAR(12) NOT NULL,
  date DATE NOT NULL,
  position_holder VARCHAR(255) NOT NULL,
  short_pct NUMERIC(8, 4) NOT NULL,
  short_shares NUMERIC(20, 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker, date, position_holder)
);

CREATE INDEX IF NOT EXISTS idx_short_holders_ticker ON short_position_holders(ticker);
CREATE INDEX IF NOT EXISTS idx_short_holders_date ON short_position_holders(date);
CREATE INDEX IF NOT EXISTS idx_short_holders_holder ON short_position_holders(position_holder);

-- ═══════════════════════════════════════════════════
-- Commodity Prices
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS commodity_prices (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  date DATE NOT NULL,
  open NUMERIC(14, 4),
  high NUMERIC(14, 4),
  low NUMERIC(14, 4),
  close NUMERIC(14, 4) NOT NULL,
  volume BIGINT,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  source VARCHAR(50) NOT NULL DEFAULT 'yahoo',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_commodity_prices_symbol ON commodity_prices(symbol);
CREATE INDEX IF NOT EXISTS idx_commodity_prices_date ON commodity_prices(date);

CREATE TABLE IF NOT EXISTS commodity_stock_sensitivity (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL,
  commodity_symbol VARCHAR(20) NOT NULL,
  beta NUMERIC(10, 6) NOT NULL,
  correlation_60d NUMERIC(8, 6),
  correlation_252d NUMERIC(8, 6),
  r_squared NUMERIC(8, 6),
  as_of_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker, commodity_symbol, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_commodity_sensitivity_ticker ON commodity_stock_sensitivity(ticker);
CREATE INDEX IF NOT EXISTS idx_commodity_sensitivity_commodity ON commodity_stock_sensitivity(commodity_symbol);

-- ═══════════════════════════════════════════════════
-- NewsWeb Filings (Oslo Børs)
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS newsweb_filings (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20),
  issuer_name VARCHAR(255) NOT NULL,
  category VARCHAR(40) NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  headline TEXT NOT NULL,
  body TEXT,
  url TEXT,
  newsweb_id VARCHAR(50) UNIQUE,

  -- AI classification
  severity INTEGER CHECK (severity >= 1 AND severity <= 5),
  sentiment NUMERIC(4, 3) CHECK (sentiment >= -1 AND sentiment <= 1),
  confidence NUMERIC(4, 3),
  ai_summary TEXT,
  structured_facts JSONB,

  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_newsweb_filings_ticker ON newsweb_filings(ticker);
CREATE INDEX IF NOT EXISTS idx_newsweb_filings_published ON newsweb_filings(published_at);
CREATE INDEX IF NOT EXISTS idx_newsweb_filings_category ON newsweb_filings(category);

-- ═══════════════════════════════════════════════════
-- Insider Transactions
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS insider_transactions (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL,
  filing_id BIGINT NOT NULL REFERENCES newsweb_filings(id) ON DELETE CASCADE,
  transaction_date TIMESTAMPTZ NOT NULL,
  person_name VARCHAR(255) NOT NULL,
  person_role VARCHAR(100),
  transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('BUY', 'SELL', 'EXERCISE', 'GRANT', 'OTHER')),
  shares NUMERIC(20, 0) NOT NULL,
  price_per_share NUMERIC(14, 4),
  total_value_nok NUMERIC(20, 2),
  holdings_after NUMERIC(20, 0),
  is_related_party BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insider_transactions_ticker ON insider_transactions(ticker);
CREATE INDEX IF NOT EXISTS idx_insider_transactions_date ON insider_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_insider_transactions_person ON insider_transactions(person_name);
CREATE INDEX IF NOT EXISTS idx_insider_transactions_type ON insider_transactions(transaction_type);
