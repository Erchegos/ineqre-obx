-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Master stock reference table
CREATE TABLE IF NOT EXISTS stocks (
  ticker VARCHAR(20) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  isin VARCHAR(12),
  sector VARCHAR(100),
  currency VARCHAR(3) DEFAULT 'NOK',
  exchange VARCHAR(20) DEFAULT 'OSE',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily price data with source tracking
CREATE TABLE IF NOT EXISTS prices_daily (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL REFERENCES stocks(ticker) ON DELETE CASCADE,
  date DATE NOT NULL,
  open NUMERIC(12, 4),
  high NUMERIC(12, 4),
  low NUMERIC(12, 4),
  close NUMERIC(12, 4) NOT NULL,
  adj_close NUMERIC(12, 4),
  volume BIGINT NOT NULL CHECK (volume >= 0),
  source VARCHAR(50) NOT NULL DEFAULT 'yfinance',
  inserted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker, date, source)
);

-- Fundamentals as point-in-time snapshots
CREATE TABLE IF NOT EXISTS fundamentals_snapshot (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL REFERENCES stocks(ticker) ON DELETE CASCADE,
  as_of_date DATE NOT NULL,
  pe_ratio NUMERIC(10, 2),
  ev_ebitda NUMERIC(10, 2),
  pb_ratio NUMERIC(10, 2),
  dividend_yield NUMERIC(10, 4),
  market_cap NUMERIC(20, 2),
  shares_outstanding NUMERIC(20, 2),
  net_debt NUMERIC(20, 2),
  revenue_ttm NUMERIC(20, 2),
  ebitda_ttm NUMERIC(20, 2),
  source VARCHAR(50) NOT NULL DEFAULT 'yfinance',
  inserted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker, as_of_date, source)
);

-- Raw news with dedupe hash
CREATE TABLE IF NOT EXISTS news_raw (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticker VARCHAR(20) REFERENCES stocks(ticker) ON DELETE SET NULL,
  source VARCHAR(100) NOT NULL,
  url TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  title TEXT NOT NULL,
  body TEXT,
  hash VARCHAR(64) NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (hash)
);

-- AI briefs with reproducibility
CREATE TABLE IF NOT EXISTS summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticker VARCHAR(20) NOT NULL REFERENCES stocks(ticker) ON DELETE CASCADE,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  summary_json JSONB NOT NULL,
  model VARCHAR(100) NOT NULL,
  prompt_version VARCHAR(50) NOT NULL,
  input_hash VARCHAR(64) NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker, window_start, window_end, model, prompt_version)
);

-- Change events
CREATE TABLE IF NOT EXISTS changes (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) REFERENCES stocks(ticker) ON DELETE SET NULL,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  change_type VARCHAR(50) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  source_ref TEXT
);

-- Job run tracking for observability
CREATE TABLE IF NOT EXISTS job_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_name VARCHAR(100) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL,
  rows_inserted INT DEFAULT 0,
  rows_updated INT DEFAULT 0,
  rows_skipped INT DEFAULT 0,
  errors INT DEFAULT 0,
  error TEXT
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_prices_daily_ticker_date ON prices_daily (ticker, date DESC);
CREATE INDEX IF NOT EXISTS idx_news_raw_ticker_published ON news_raw (ticker, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_changes_detected ON changes (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_summaries_ticker_window ON summaries (ticker, window_end DESC);
