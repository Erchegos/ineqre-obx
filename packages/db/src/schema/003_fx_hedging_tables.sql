-- Migration 003: FX Hedging Analytics Tables
-- Created: 2026-01-23
-- Purpose: Add tables for FX exposure tracking, hedging analytics, and currency risk management

-- ============================================================================
-- FX MARKET DATA
-- ============================================================================

-- Daily FX spot rates (NOK as base currency)
CREATE TABLE IF NOT EXISTS fx_spot_rates (
  id BIGSERIAL PRIMARY KEY,
  currency_pair VARCHAR(10) NOT NULL,
  date DATE NOT NULL,
  spot_rate NUMERIC(12, 6) NOT NULL,
  bid NUMERIC(12, 6),
  ask NUMERIC(12, 6),
  mid NUMERIC(12, 6),
  source VARCHAR(50) NOT NULL DEFAULT 'ibkr',
  inserted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (currency_pair, date, source)
);

CREATE INDEX idx_fx_spot_currency_date ON fx_spot_rates (currency_pair, date DESC);

COMMENT ON TABLE fx_spot_rates IS 'Daily FX spot rates with NOK as base currency';
COMMENT ON COLUMN fx_spot_rates.currency_pair IS 'Format: NOKUSD (1 USD = X NOK)';
COMMENT ON COLUMN fx_spot_rates.spot_rate IS 'NOK per 1 unit of foreign currency';

-- ============================================================================
-- INTEREST RATE DATA
-- ============================================================================

-- Risk-free/policy rates for interest rate parity calculations
CREATE TABLE IF NOT EXISTS interest_rates (
  id BIGSERIAL PRIMARY KEY,
  currency VARCHAR(3) NOT NULL,
  date DATE NOT NULL,
  tenor VARCHAR(10) NOT NULL,
  rate NUMERIC(8, 6) NOT NULL,
  rate_type VARCHAR(50) NOT NULL,
  source VARCHAR(50) NOT NULL,
  inserted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (currency, date, tenor, rate_type, source)
);

CREATE INDEX idx_interest_rates_currency_date ON interest_rates (currency, date DESC, tenor);

COMMENT ON TABLE interest_rates IS 'Interest rates for IRP calculations';
COMMENT ON COLUMN interest_rates.rate IS 'Annualized rate in decimal (0.0450 = 4.50%)';
COMMENT ON COLUMN interest_rates.tenor IS 'Term: OVERNIGHT, 1M, 3M, 6M, 12M';

-- ============================================================================
-- FX FORWARD PRICING
-- ============================================================================

-- Synthetic forward rates computed via Interest Rate Parity
CREATE TABLE IF NOT EXISTS fx_forward_rates (
  id BIGSERIAL PRIMARY KEY,
  currency_pair VARCHAR(10) NOT NULL,
  date DATE NOT NULL,
  tenor VARCHAR(10) NOT NULL,
  spot_rate NUMERIC(12, 6) NOT NULL,
  domestic_rate NUMERIC(8, 6) NOT NULL,
  foreign_rate NUMERIC(8, 6) NOT NULL,
  forward_rate NUMERIC(12, 6) NOT NULL,
  forward_points NUMERIC(12, 6),
  annualized_carry NUMERIC(8, 6),
  days_to_maturity INTEGER NOT NULL,
  bid_ask_spread NUMERIC(12, 6),
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (currency_pair, date, tenor)
);

CREATE INDEX idx_fx_forward_currency_date ON fx_forward_rates (currency_pair, date DESC, tenor);

COMMENT ON TABLE fx_forward_rates IS 'Forward rates derived from Interest Rate Parity';
COMMENT ON COLUMN fx_forward_rates.forward_points IS 'Forward - Spot (in pips)';
COMMENT ON COLUMN fx_forward_rates.annualized_carry IS 'Annual carry return (%)';

-- ============================================================================
-- COMMODITY PRICES
-- ============================================================================

CREATE TABLE IF NOT EXISTS commodity_prices (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  contract_type VARCHAR(20) NOT NULL,
  date DATE NOT NULL,
  open NUMERIC(12, 4),
  high NUMERIC(12, 4),
  low NUMERIC(12, 4),
  close NUMERIC(12, 4) NOT NULL,
  volume BIGINT,
  currency VARCHAR(3) DEFAULT 'USD',
  unit VARCHAR(20),
  source VARCHAR(50) NOT NULL DEFAULT 'ibkr',
  inserted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (symbol, contract_type, date, source)
);

CREATE INDEX idx_commodity_prices_symbol_date ON commodity_prices (symbol, date DESC);

COMMENT ON TABLE commodity_prices IS 'Commodity futures for correlation and regime analysis';
COMMENT ON COLUMN commodity_prices.symbol IS 'CL (Brent), NG (Nat Gas), etc.';
COMMENT ON COLUMN commodity_prices.contract_type IS 'SPOT, FRONT_MONTH, CONTINUOUS';

-- ============================================================================
-- EQUITY FX EXPOSURE METADATA
-- ============================================================================

-- Currency revenue breakdown per stock
CREATE TABLE IF NOT EXISTS stock_fx_exposure (
  ticker VARCHAR(20) PRIMARY KEY REFERENCES stocks(ticker) ON DELETE CASCADE,
  usd_revenue_pct NUMERIC(5, 4),
  eur_revenue_pct NUMERIC(5, 4),
  gbp_revenue_pct NUMERIC(5, 4),
  nok_revenue_pct NUMERIC(5, 4),
  other_revenue_pct NUMERIC(5, 4),
  last_updated DATE NOT NULL,
  source VARCHAR(100),
  notes TEXT,
  CHECK (
    COALESCE(usd_revenue_pct, 0) +
    COALESCE(eur_revenue_pct, 0) +
    COALESCE(gbp_revenue_pct, 0) +
    COALESCE(nok_revenue_pct, 0) +
    COALESCE(other_revenue_pct, 0) <= 1.01
  )
);

COMMENT ON TABLE stock_fx_exposure IS 'Revenue currency breakdown by stock';
COMMENT ON COLUMN stock_fx_exposure.usd_revenue_pct IS 'Percentage as decimal (0.75 = 75%)';

-- ============================================================================
-- COMPUTED FX ANALYTICS
-- ============================================================================

-- Pre-computed currency betas (rolling windows)
CREATE TABLE IF NOT EXISTS fx_currency_betas (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL REFERENCES stocks(ticker) ON DELETE CASCADE,
  currency_pair VARCHAR(10) NOT NULL,
  date DATE NOT NULL,
  window_days INTEGER NOT NULL,
  beta NUMERIC(10, 6),
  r_squared NUMERIC(6, 4),
  std_error NUMERIC(10, 6),
  t_stat NUMERIC(10, 4),
  p_value NUMERIC(8, 6),
  observations INTEGER NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker, currency_pair, date, window_days)
);

CREATE INDEX idx_fx_betas_ticker_date ON fx_currency_betas (ticker, date DESC, currency_pair);

COMMENT ON TABLE fx_currency_betas IS 'Currency exposure betas from rolling regressions';
COMMENT ON COLUMN fx_currency_betas.beta IS 'R_equity = alpha + beta * ΔFX + epsilon';

-- FX exposure decomposition (daily)
CREATE TABLE IF NOT EXISTS fx_exposure_decomposition (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL REFERENCES stocks(ticker) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_return_nok NUMERIC(10, 6),
  pure_equity_return NUMERIC(10, 6),
  fx_contribution NUMERIC(10, 6),
  interaction_term NUMERIC(10, 6),
  usd_fx_contribution NUMERIC(10, 6),
  eur_fx_contribution NUMERIC(10, 6),
  gbp_fx_contribution NUMERIC(10, 6),
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker, date)
);

CREATE INDEX idx_fx_decomp_ticker_date ON fx_exposure_decomposition (ticker, date DESC);

COMMENT ON TABLE fx_exposure_decomposition IS 'Daily return decomposition: R_NOK = R_local + ΔFX + interaction';

-- Hedge P&L attribution
CREATE TABLE IF NOT EXISTS fx_hedge_pnl (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL REFERENCES stocks(ticker) ON DELETE CASCADE,
  date DATE NOT NULL,
  currency_pair VARCHAR(10) NOT NULL,
  hedge_ratio NUMERIC(5, 4) NOT NULL,
  tenor VARCHAR(10) NOT NULL,
  unhedged_return NUMERIC(10, 6),
  hedged_return NUMERIC(10, 6),
  spot_pnl NUMERIC(10, 6),
  forward_pnl NUMERIC(10, 6),
  carry_component NUMERIC(10, 6),
  residual_fx_risk NUMERIC(10, 6),
  transaction_cost NUMERIC(10, 6),
  unhedged_volatility NUMERIC(10, 6),
  hedged_volatility NUMERIC(10, 6),
  volatility_reduction NUMERIC(10, 6),
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker, date, currency_pair, hedge_ratio, tenor)
);

CREATE INDEX idx_fx_hedge_pnl_ticker ON fx_hedge_pnl (ticker, date DESC, currency_pair);

COMMENT ON TABLE fx_hedge_pnl IS 'Hedge P&L breakdown and volatility impact';

-- Optimal hedge ratios (minimum variance)
CREATE TABLE IF NOT EXISTS fx_optimal_hedges (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL REFERENCES stocks(ticker) ON DELETE CASCADE,
  currency_pair VARCHAR(10) NOT NULL,
  date DATE NOT NULL,
  window_days INTEGER NOT NULL,
  min_variance_hedge NUMERIC(6, 4),
  regression_hedge NUMERIC(6, 4),
  stability_adjusted_hedge NUMERIC(6, 4),
  hedge_0pct_vol NUMERIC(10, 6),
  hedge_50pct_vol NUMERIC(10, 6),
  hedge_100pct_vol NUMERIC(10, 6),
  hedge_optimal_vol NUMERIC(10, 6),
  max_drawdown_unhedged NUMERIC(10, 6),
  max_drawdown_hedged NUMERIC(10, 6),
  opportunity_cost NUMERIC(10, 6),
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker, currency_pair, date, window_days)
);

CREATE INDEX idx_fx_optimal_hedges ON fx_optimal_hedges (ticker, date DESC, currency_pair);

COMMENT ON TABLE fx_optimal_hedges IS 'Optimal hedge ratios via variance minimization';

-- ============================================================================
-- FX REGIME CLASSIFICATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS fx_market_regimes (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  regime VARCHAR(50) NOT NULL,
  nok_regime VARCHAR(50),
  vix_level NUMERIC(8, 4),
  oil_price_usd NUMERIC(10, 4),
  usd_strength_zscore NUMERIC(8, 4),
  risk_sentiment_score NUMERIC(6, 4),
  source VARCHAR(100),
  notes TEXT,
  calculated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fx_regimes_date ON fx_market_regimes (date DESC);

COMMENT ON TABLE fx_market_regimes IS 'FX market regime classification (RISK_ON, RISK_OFF, etc.)';
