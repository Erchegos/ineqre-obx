-- Volatility Models Cache Table
-- Stores pre-computed ML volatility model outputs (GARCH, MSGARCH, VaR, Jumps)
-- so per-stock volatility pages load instantly without a live Python ML service.

CREATE TABLE IF NOT EXISTS volatility_models (
  id            BIGSERIAL PRIMARY KEY,
  ticker        VARCHAR(20) NOT NULL,
  computed_date DATE NOT NULL,
  -- Full model output from /volatility/full endpoint
  model_data    JSONB NOT NULL,
  -- Individual model status (quick filtering)
  has_garch     BOOLEAN DEFAULT false,
  has_regime    BOOLEAN DEFAULT false,
  has_var       BOOLEAN DEFAULT false,
  has_jumps     BOOLEAN DEFAULT false,
  n_observations INTEGER,
  created_at    TIMESTAMPTZ DEFAULT now(),

  -- One result per ticker per day
  CONSTRAINT volatility_models_ticker_date_uq UNIQUE (ticker, computed_date)
);

-- Fast lookups by ticker (most recent first)
CREATE INDEX IF NOT EXISTS idx_volatility_models_ticker_date
  ON volatility_models (ticker, computed_date DESC);

-- Date-based queries for batch operations
CREATE INDEX IF NOT EXISTS idx_volatility_models_date
  ON volatility_models (computed_date DESC);
