-- Alpha Engine: ML trading signals, model registry, performance tracking, paper trading
-- Migration 020

-- Model registry: catalog of all ML models with hyperparameters
CREATE TABLE IF NOT EXISTS alpha_model_registry (
  id SERIAL PRIMARY KEY,
  model_id VARCHAR(50) UNIQUE NOT NULL,
  model_type VARCHAR(30) NOT NULL, -- xgboost, lightgbm, catboost, tft, cnn, ensemble, combined
  display_name VARCHAR(100) NOT NULL,
  hyperparameters JSONB DEFAULT '{}',
  training_config JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  run_on_vps BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- Per-ticker daily signals from each model
CREATE TABLE IF NOT EXISTS alpha_signals (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL,
  signal_date DATE NOT NULL,
  model_id VARCHAR(50) NOT NULL REFERENCES alpha_model_registry(model_id),
  horizon VARCHAR(10) DEFAULT '20d', -- 1d, 5d, 20d, 60d
  signal_value NUMERIC(8,6) NOT NULL, -- [-1, 1]
  predicted_return NUMERIC(12,6),
  confidence NUMERIC(5,4),
  feature_importance JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker, signal_date, model_id, horizon)
);

CREATE INDEX idx_alpha_signals_date ON alpha_signals (signal_date DESC);
CREATE INDEX idx_alpha_signals_ticker ON alpha_signals (ticker, signal_date DESC);
CREATE INDEX idx_alpha_signals_model ON alpha_signals (model_id, signal_date DESC);

-- Rolling performance metrics per model
CREATE TABLE IF NOT EXISTS alpha_model_performance (
  id BIGSERIAL PRIMARY KEY,
  model_id VARCHAR(50) NOT NULL REFERENCES alpha_model_registry(model_id),
  evaluation_date DATE NOT NULL,
  window_days INTEGER NOT NULL, -- 21, 63, 126, 252
  hit_rate NUMERIC(5,4),
  ic NUMERIC(8,6), -- information coefficient (rank correlation)
  mae NUMERIC(12,6),
  r2 NUMERIC(8,6),
  sharpe NUMERIC(8,4),
  long_short_return NUMERIC(12,6),
  n_predictions INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (model_id, evaluation_date, window_days)
);

CREATE INDEX idx_alpha_perf_model ON alpha_model_performance (model_id, evaluation_date DESC);

-- Paper portfolio definitions
CREATE TABLE IF NOT EXISTS alpha_paper_portfolios (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  strategy VARCHAR(50) NOT NULL DEFAULT 'signal_weighted', -- signal_weighted, top_n_long, long_short, threshold
  model_id VARCHAR(50) REFERENCES alpha_model_registry(model_id),
  initial_capital NUMERIC(14,2) DEFAULT 10000000, -- 10M NOK
  current_value NUMERIC(14,2),
  current_positions JSONB DEFAULT '{}',
  rebalance_freq_days INTEGER DEFAULT 21,
  last_rebalance_date DATE,
  max_positions INTEGER DEFAULT 15,
  max_position_pct NUMERIC(5,4) DEFAULT 0.10,
  cost_bps NUMERIC(6,2) DEFAULT 10,
  is_active BOOLEAN DEFAULT true,
  profile VARCHAR(50) DEFAULT 'default',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual paper trade records
CREATE TABLE IF NOT EXISTS alpha_paper_trades (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id INTEGER NOT NULL REFERENCES alpha_paper_portfolios(id) ON DELETE CASCADE,
  ticker VARCHAR(20) NOT NULL,
  side VARCHAR(4) NOT NULL, -- BUY, SELL
  quantity NUMERIC(12,2) NOT NULL,
  price NUMERIC(12,4) NOT NULL,
  signal_value NUMERIC(8,6),
  model_id VARCHAR(50),
  trade_date DATE NOT NULL,
  trade_type VARCHAR(20) DEFAULT 'REBALANCE', -- ENTRY, EXIT, REBALANCE
  fees_nok NUMERIC(10,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alpha_trades_portfolio ON alpha_paper_trades (portfolio_id, trade_date DESC);

-- Daily NAV snapshots for equity curves
CREATE TABLE IF NOT EXISTS alpha_paper_snapshots (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id INTEGER NOT NULL REFERENCES alpha_paper_portfolios(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  nav NUMERIC(14,2) NOT NULL,
  daily_return NUMERIC(12,6),
  positions_count INTEGER DEFAULT 0,
  gross_exposure NUMERIC(14,2),
  realized_pnl_cumulative NUMERIC(14,2) DEFAULT 0,
  unrealized_pnl NUMERIC(14,2) DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  UNIQUE (portfolio_id, snapshot_date)
);

CREATE INDEX idx_alpha_snapshots_portfolio ON alpha_paper_snapshots (portfolio_id, snapshot_date DESC);

-- Seed initial models
INSERT INTO alpha_model_registry (model_id, model_type, display_name, hyperparameters, training_config, run_on_vps, notes) VALUES
  ('xgb_v3', 'xgboost', 'XGBoost v3',
   '{"max_depth": 6, "n_estimators": 300, "learning_rate": 0.05, "reg_alpha": 0.1, "reg_lambda": 1.0, "subsample": 0.8, "colsample_bytree": 0.8}',
   '{"features": 43, "target": "1m_forward_return", "lookback_days": 1200}',
   false, 'Primary tree model — fast, good on tabular data'),
  ('lgbm_v3', 'lightgbm', 'LightGBM v3',
   '{"num_leaves": 31, "n_estimators": 300, "learning_rate": 0.05, "reg_alpha": 0.1, "reg_lambda": 1.0, "subsample": 0.8, "feature_fraction": 0.8}',
   '{"features": 43, "target": "1m_forward_return", "lookback_days": 1200}',
   false, 'Primary tree model — handles categoricals, fast training'),
  ('ensemble_v3', 'ensemble', 'XGB+LGBM Ensemble',
   '{"xgb_weight": 0.5, "lgbm_weight": 0.5}',
   '{"features": 43, "target": "1m_forward_return"}',
   false, 'Current production model — 50/50 blend'),
  ('cnn_v1', 'cnn', 'CNN+Transformer v1',
   '{"conv_channels": [16, 32, 64], "transformer_heads": 2, "transformer_layers": 1, "dropout": 0.3}',
   '{"window": 60, "target": "5d_forward_return"}',
   true, 'Pattern detection — runs on VPS (PyTorch)'),
  ('combined_v1', 'combined', 'Alpha Signal Combiner',
   '{"ml_weight": 0.25, "cnn_weight": 0.20, "momentum_weight": 0.15, "valuation_weight": 0.15, "cluster_weight": 0.15, "regime_weight": 0.10}',
   '{"crisis_adjustment": true}',
   false, '6-source signal combiner with regime-aware weights')
ON CONFLICT (model_id) DO NOTHING;
