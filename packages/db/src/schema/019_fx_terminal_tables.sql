-- 019: FX Terminal tables (multi-currency regression + fundamental exposure)

-- Multi-currency regression results
CREATE TABLE IF NOT EXISTS fx_regression_results (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL,
  window_end DATE NOT NULL,
  window_days INTEGER NOT NULL,

  beta_market NUMERIC(10,6),
  tstat_market NUMERIC(10,4),

  beta_usd NUMERIC(10,6),
  tstat_usd NUMERIC(10,4),
  beta_eur NUMERIC(10,6),
  tstat_eur NUMERIC(10,4),
  beta_gbp NUMERIC(10,6),
  tstat_gbp NUMERIC(10,4),
  beta_sek NUMERIC(10,6),
  tstat_sek NUMERIC(10,4),

  r_squared NUMERIC(6,4),
  r_squared_fx_only NUMERIC(6,4),
  residual_vol NUMERIC(10,6),
  observations INTEGER NOT NULL,

  calculated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS fx_regression_results_unique_idx
  ON fx_regression_results (ticker, window_end, window_days);
CREATE INDEX IF NOT EXISTS fx_regression_results_ticker_idx
  ON fx_regression_results (ticker, window_end DESC);

-- Fundamental currency exposure (revenue + cost + sensitivity)
CREATE TABLE IF NOT EXISTS fx_fundamental_exposure (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL,
  fiscal_year INTEGER NOT NULL,

  revenue_usd_pct NUMERIC(5,4),
  revenue_eur_pct NUMERIC(5,4),
  revenue_gbp_pct NUMERIC(5,4),
  revenue_nok_pct NUMERIC(5,4),
  revenue_sek_pct NUMERIC(5,4),
  revenue_other_pct NUMERIC(5,4),

  cost_usd_pct NUMERIC(5,4),
  cost_eur_pct NUMERIC(5,4),
  cost_gbp_pct NUMERIC(5,4),
  cost_nok_pct NUMERIC(5,4),
  cost_sek_pct NUMERIC(5,4),
  cost_other_pct NUMERIC(5,4),

  net_usd_pct NUMERIC(6,4),
  net_eur_pct NUMERIC(6,4),
  net_gbp_pct NUMERIC(6,4),
  net_sek_pct NUMERIC(6,4),

  ebitda_sensitivity_usd NUMERIC(10,4),
  ebitda_sensitivity_eur NUMERIC(10,4),
  ebitda_sensitivity_gbp NUMERIC(10,4),

  eps_sensitivity_usd NUMERIC(10,4),
  eps_sensitivity_eur NUMERIC(10,4),
  eps_sensitivity_gbp NUMERIC(10,4),

  source VARCHAR(100),
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS fx_fundamental_exposure_unique_idx
  ON fx_fundamental_exposure (ticker, fiscal_year);
