-- ============================================================================
-- Predictive Factors Module - Database Schema
--
-- This schema supports 19 research-backed predictive factors for equity returns:
-- - 5 momentum factors (mom1m, mom6m, mom11m, mom36m, chgmom)
-- - 6 volatility factors (vol1m, vol3m, vol12m, maxret, beta, ivol)
-- - 7 fundamental factors (bm, nokvol, ep, dy, sp, sg, mktcap)
-- - 1 categorical factor (dum_jan)
-- ============================================================================

-- ============================================================================
-- Technical Factors Table (Daily Frequency)
-- ============================================================================

CREATE TABLE IF NOT EXISTS factor_technical (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL REFERENCES stocks(ticker) ON DELETE CASCADE,
  date DATE NOT NULL,

  -- Momentum factors (from adj_close, log returns)
  mom1m NUMERIC(12, 6),          -- 1-month momentum (t-1 to t)
  mom6m NUMERIC(12, 6),          -- 6-month momentum (t-7 to t-1, skipping most recent month)
  mom11m NUMERIC(12, 6),         -- 11-month momentum (t-12 to t-1)
  mom36m NUMERIC(12, 6),         -- 36-month momentum (t-48 to t-12)
  chgmom NUMERIC(12, 6),         -- Change in 6-month momentum

  -- Volatility factors (annualized with sqrt(252))
  vol1m NUMERIC(12, 6),          -- 1-month volatility (21 trading days)
  vol3m NUMERIC(12, 6),          -- 3-month volatility (63 trading days)
  vol12m NUMERIC(12, 6),         -- 12-month volatility (252 trading days)
  maxret NUMERIC(12, 6),         -- Maximum daily return in past month
  beta NUMERIC(12, 6),           -- Market beta vs OBX (252-day rolling regression)
  ivol NUMERIC(12, 6),           -- Idiosyncratic volatility (residual from market model)

  -- Categorical factor
  dum_jan SMALLINT,              -- January dummy (1 if January, 0 otherwise)

  -- Metadata
  inserted_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  UNIQUE (ticker, date)
);

-- Indexes for efficient time-series queries
CREATE INDEX idx_factor_technical_ticker_date ON factor_technical (ticker, date DESC);
CREATE INDEX idx_factor_technical_date ON factor_technical (date DESC);

-- ============================================================================
-- Fundamental Factors Table (Monthly Frequency, Forward-Filled)
-- ============================================================================

CREATE TABLE IF NOT EXISTS factor_fundamentals (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL REFERENCES stocks(ticker) ON DELETE CASCADE,
  date DATE NOT NULL,

  -- Fundamental factors
  bm NUMERIC(12, 6),             -- Book-to-market ratio (1 / PB ratio)
  nokvol NUMERIC(20, 2),         -- Trading volume in NOK (20-day average)
  ep NUMERIC(12, 6),             -- Earnings yield (1 / PE ratio)
  dy NUMERIC(12, 6),             -- Dividend yield
  sp NUMERIC(12, 6),             -- Sales-to-price ratio (Revenue / Market cap)
  sg NUMERIC(12, 6),             -- Sales growth (YoY)
  mktcap NUMERIC(20, 2),         -- Market capitalization in NOK

  -- Metadata
  report_date DATE,              -- Original quarterly/annual report date
  is_forward_filled BOOLEAN DEFAULT false,
  data_quality JSONB,            -- Track data completeness and source

  inserted_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  UNIQUE (ticker, date)
);

-- Indexes
CREATE INDEX idx_factor_fundamentals_ticker_date ON factor_fundamentals (ticker, date DESC);
CREATE INDEX idx_factor_fundamentals_report_date ON factor_fundamentals (report_date DESC);

-- ============================================================================
-- ML Predictions Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ml_predictions (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL REFERENCES stocks(ticker) ON DELETE CASCADE,
  prediction_date DATE NOT NULL,
  target_date DATE NOT NULL,     -- Date of predicted return (prediction_date + ~1 month)
  model_version VARCHAR(50) NOT NULL,

  -- Model predictions
  gb_prediction NUMERIC(12, 6),  -- Gradient Boosting prediction
  rf_prediction NUMERIC(12, 6),  -- Random Forest prediction
  ensemble_prediction NUMERIC(12, 6), -- Weighted average (60% GB, 40% RF)

  -- Probability distribution (percentiles)
  p05 NUMERIC(12, 6),            -- 5th percentile
  p25 NUMERIC(12, 6),            -- 25th percentile (Q1)
  p50 NUMERIC(12, 6),            -- 50th percentile (median)
  p75 NUMERIC(12, 6),            -- 75th percentile (Q3)
  p95 NUMERIC(12, 6),            -- 95th percentile

  -- Model metadata
  feature_importance JSONB,      -- Top features and their importance scores
  confidence_score NUMERIC(5, 4), -- Prediction confidence (0-1 scale)
  factors_used JSONB,            -- Snapshot of factor values used for prediction

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  UNIQUE (ticker, prediction_date, model_version),
  CHECK (confidence_score >= 0 AND confidence_score <= 1)
);

-- Indexes
CREATE INDEX idx_ml_predictions_ticker_target ON ml_predictions (ticker, target_date DESC);
CREATE INDEX idx_ml_predictions_date ON ml_predictions (prediction_date DESC);
CREATE INDEX idx_ml_predictions_model_version ON ml_predictions (model_version);

-- ============================================================================
-- ML Model Metadata Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ml_model_metadata (
  id SERIAL PRIMARY KEY,
  model_version VARCHAR(50) NOT NULL UNIQUE,

  -- Training metadata
  trained_at TIMESTAMPTZ NOT NULL,
  training_start_date DATE NOT NULL,
  training_end_date DATE NOT NULL,
  n_training_samples INTEGER,

  -- Model hyperparameters
  gb_params JSONB,               -- Gradient Boosting hyperparameters
  rf_params JSONB,               -- Random Forest hyperparameters
  ensemble_weights JSONB,        -- Ensemble weights (e.g., {"gb": 0.6, "rf": 0.4})

  -- Performance metrics
  train_r2 NUMERIC(8, 6),        -- Training R²
  test_r2 NUMERIC(8, 6),         -- Test R² (out-of-sample)
  train_mse NUMERIC(12, 6),      -- Training MSE
  test_mse NUMERIC(12, 6),       -- Test MSE
  sharpe_ratio NUMERIC(8, 4),    -- Backtest Sharpe ratio

  -- Feature engineering
  features_selected JSONB,       -- List of features used in training
  feature_importance_avg JSONB,  -- Average feature importance across trees

  -- Model status
  is_active BOOLEAN DEFAULT true,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Combined Factor View (Materialized View for ML Training)
-- ============================================================================

CREATE MATERIALIZED VIEW factor_combined_view AS
SELECT
  ft.ticker,
  ft.date,

  -- Technical factors (momentum)
  ft.mom1m,
  ft.mom6m,
  ft.mom11m,
  ft.mom36m,
  ft.chgmom,

  -- Technical factors (volatility)
  ft.vol1m,
  ft.vol3m,
  ft.vol12m,
  ft.maxret,
  ft.beta,
  ft.ivol,

  -- Categorical
  ft.dum_jan,

  -- Fundamental factors (forward-filled from most recent available)
  ff.bm,
  ff.nokvol,
  ff.ep,
  ff.dy,
  ff.sp,
  ff.sg,
  ff.mktcap,

  -- Target variable (1-month forward return, ~21 trading days)
  LEAD(ft.mom1m, 21) OVER (PARTITION BY ft.ticker ORDER BY ft.date) AS target_return_1m,

  -- Metadata
  ff.is_forward_filled,
  ff.report_date

FROM factor_technical ft
LEFT JOIN LATERAL (
  -- Get the most recent fundamental data as of the technical factor date
  SELECT * FROM factor_fundamentals ff2
  WHERE ff2.ticker = ft.ticker AND ff2.date <= ft.date
  ORDER BY ff2.date DESC
  LIMIT 1
) ff ON true
WHERE ft.date >= '2010-01-01';

-- Indexes on materialized view
CREATE UNIQUE INDEX idx_factor_combined_ticker_date ON factor_combined_view (ticker, date);
CREATE INDEX idx_factor_combined_date ON factor_combined_view (date DESC);
CREATE INDEX idx_factor_combined_target_not_null ON factor_combined_view (ticker, date)
  WHERE target_return_1m IS NOT NULL;

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TABLE factor_technical IS 'Daily technical factors: momentum and volatility measures calculated from OHLCV data';
COMMENT ON TABLE factor_fundamentals IS 'Monthly fundamental factors: valuation ratios and company metrics, forward-filled between reporting dates';
COMMENT ON TABLE ml_predictions IS 'ML model predictions for 1-month forward returns with probability distributions';
COMMENT ON TABLE ml_model_metadata IS 'Metadata and performance metrics for trained ML models';
COMMENT ON MATERIALIZED VIEW factor_combined_view IS 'Combined view of all factors joined for ML training, includes target variable';

-- Momentum factor comments
COMMENT ON COLUMN factor_technical.mom1m IS '1-month momentum: log return from t-1 to t';
COMMENT ON COLUMN factor_technical.mom6m IS '6-month momentum: log return from t-7 to t-1 (skips most recent month)';
COMMENT ON COLUMN factor_technical.mom11m IS '11-month momentum: log return from t-12 to t-1';
COMMENT ON COLUMN factor_technical.mom36m IS '36-month momentum: log return from t-48 to t-12';
COMMENT ON COLUMN factor_technical.chgmom IS 'Change in 6-month momentum: mom6m(t) - mom6m(t-6)';

-- Volatility factor comments
COMMENT ON COLUMN factor_technical.vol1m IS '1-month volatility: annualized standard deviation of daily returns (21 days)';
COMMENT ON COLUMN factor_technical.vol3m IS '3-month volatility: annualized standard deviation of daily returns (63 days)';
COMMENT ON COLUMN factor_technical.vol12m IS '12-month volatility: annualized standard deviation of daily returns (252 days)';
COMMENT ON COLUMN factor_technical.maxret IS 'Maximum daily return in past month (highest single-day gain)';
COMMENT ON COLUMN factor_technical.beta IS 'Market beta: 252-day rolling regression coefficient vs OBX index';
COMMENT ON COLUMN factor_technical.ivol IS 'Idiosyncratic volatility: annualized std dev of residuals from market model';

-- Fundamental factor comments
COMMENT ON COLUMN factor_fundamentals.bm IS 'Book-to-market ratio: 1 / (Price-to-book ratio)';
COMMENT ON COLUMN factor_fundamentals.nokvol IS 'Trading volume in NOK: 20-day average of (price × volume)';
COMMENT ON COLUMN factor_fundamentals.ep IS 'Earnings yield: 1 / (Price-to-earnings ratio)';
COMMENT ON COLUMN factor_fundamentals.dy IS 'Dividend yield: annual dividend / price';
COMMENT ON COLUMN factor_fundamentals.sp IS 'Sales-to-price ratio: TTM revenue / market capitalization';
COMMENT ON COLUMN factor_fundamentals.sg IS 'Sales growth: YoY revenue growth rate';
COMMENT ON COLUMN factor_fundamentals.mktcap IS 'Market capitalization in NOK';

-- ============================================================================
-- Helper Function: Refresh Materialized View
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_factor_combined_view()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY factor_combined_view;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_factor_combined_view() IS 'Refresh the factor_combined_view materialized view (call after inserting new factor data)';

-- ============================================================================
-- End of Schema
-- ============================================================================
