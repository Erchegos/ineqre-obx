-- Portfolio Optimizer: Saved portfolio configurations
-- Used by /portfolio page for the investment firm's portfolio management

CREATE TABLE IF NOT EXISTS portfolio_configs (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  tickers TEXT[] NOT NULL,
  weights NUMERIC[] NOT NULL,
  optimization_mode VARCHAR(30) NOT NULL DEFAULT 'min_variance',
  constraints JSONB DEFAULT '{}',
  portfolio_value_nok NUMERIC(20, 2) DEFAULT 10000000,
  lookback_days INTEGER DEFAULT 504,
  covariance_method VARCHAR(20) DEFAULT 'shrinkage',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_configs_name ON portfolio_configs (name);
CREATE INDEX IF NOT EXISTS idx_portfolio_configs_updated ON portfolio_configs (updated_at DESC);
