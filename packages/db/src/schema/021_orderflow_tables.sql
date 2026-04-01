-- Order Flow Intelligence Tables
-- Microstructure analytics for Oslo Børs: VPIN, Kyle's Lambda, OFI, iceberg detection

-- 1. Tick-level trade data
CREATE TABLE IF NOT EXISTS orderflow_ticks (
  id            BIGSERIAL PRIMARY KEY,
  ticker        VARCHAR(20) NOT NULL,
  ts            TIMESTAMPTZ NOT NULL,
  price         NUMERIC(14,4) NOT NULL,
  size          INTEGER NOT NULL,
  side          SMALLINT,                -- 1=buy, -1=sell, 0=unknown
  trade_id      BIGINT,
  vwap          NUMERIC(14,4),
  turnover      NUMERIC(18,2),
  turnover_volume INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orderflow_ticks_ticker_ts ON orderflow_ticks (ticker, ts);
CREATE INDEX IF NOT EXISTS idx_orderflow_ticks_ts ON orderflow_ticks (ts);

-- 2. Orderbook depth snapshots (5-level, 1/sec)
CREATE TABLE IF NOT EXISTS orderflow_depth_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  ticker          VARCHAR(20) NOT NULL,
  ts              TIMESTAMPTZ NOT NULL,
  bid_prices      JSONB,               -- number[5]
  bid_sizes       JSONB,               -- number[5]
  bid_orders      JSONB,               -- number[5]
  ask_prices      JSONB,               -- number[5]
  ask_sizes       JSONB,               -- number[5]
  ask_orders      JSONB,               -- number[5]
  spread_bps      NUMERIC(8,2),
  mid_price       NUMERIC(14,4),
  book_imbalance  NUMERIC(6,4),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orderflow_depth_ticker_ts ON orderflow_depth_snapshots (ticker, ts);

-- 3. Pre-aggregated intraday bars
CREATE TABLE IF NOT EXISTS orderflow_bars (
  id                  BIGSERIAL PRIMARY KEY,
  ticker              VARCHAR(20) NOT NULL,
  bar_type            VARCHAR(10) NOT NULL,  -- time_1m, time_5m, volume
  bar_open_ts         TIMESTAMPTZ NOT NULL,
  bar_close_ts        TIMESTAMPTZ NOT NULL,
  open                NUMERIC(14,4) NOT NULL,
  high                NUMERIC(14,4) NOT NULL,
  low                 NUMERIC(14,4) NOT NULL,
  close               NUMERIC(14,4) NOT NULL,
  volume              INTEGER NOT NULL,
  turnover            NUMERIC(18,2),
  trade_count         INTEGER NOT NULL,
  vwap                NUMERIC(14,4),
  buy_volume          INTEGER,
  sell_volume         INTEGER,
  ofi                 NUMERIC(14,2),
  vpin                NUMERIC(6,4),
  kyle_lambda         NUMERIC(12,6),
  spread_mean_bps     NUMERIC(8,2),
  depth_imbalance_mean NUMERIC(6,4),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orderflow_bars_ticker_type_open ON orderflow_bars (ticker, bar_type, bar_open_ts);

-- 4. Computed signals per ticker (every 5 min)
CREATE TABLE IF NOT EXISTS orderflow_signals (
  id                  BIGSERIAL PRIMARY KEY,
  ticker              VARCHAR(20) NOT NULL,
  ts                  TIMESTAMPTZ NOT NULL,
  vpin_50             NUMERIC(6,4),
  vpin_percentile     NUMERIC(5,2),
  kyle_lambda_60m     NUMERIC(12,6),
  ofi_cumulative      NUMERIC(14,2),
  ofi_5m              NUMERIC(14,2),
  toxicity_score      NUMERIC(5,2),
  iceberg_probability NUMERIC(5,4),
  block_alert         BOOLEAN DEFAULT FALSE,
  block_est_size      INTEGER,
  block_est_direction SMALLINT,
  regime              VARCHAR(20),
  spread_regime       VARCHAR(20),
  intraday_forecast   NUMERIC(8,4),
  forecast_confidence NUMERIC(5,4),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ticker, ts)
);
CREATE INDEX IF NOT EXISTS idx_orderflow_signals_ticker_ts ON orderflow_signals (ticker, ts);

-- 5. Iceberg / fragmented block trade detections
CREATE TABLE IF NOT EXISTS orderflow_iceberg_detections (
  id                BIGSERIAL PRIMARY KEY,
  ticker            VARCHAR(20) NOT NULL,
  detected_at       TIMESTAMPTZ NOT NULL,
  start_ts          TIMESTAMPTZ NOT NULL,
  end_ts            TIMESTAMPTZ NOT NULL,
  direction         SMALLINT NOT NULL,
  total_volume      INTEGER NOT NULL,
  trade_count       INTEGER NOT NULL,
  avg_trade_size    NUMERIC(10,2),
  median_trade_size INTEGER,
  price_range_bps   NUMERIC(8,2),
  vwap              NUMERIC(14,4),
  est_block_pct     NUMERIC(5,2),
  detection_method  VARCHAR(30),
  confidence        NUMERIC(5,4),
  features          JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orderflow_icebergs_ticker_detected ON orderflow_iceberg_detections (ticker, detected_at);
