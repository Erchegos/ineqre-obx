-- News Event System Tables
-- Stores classified news events from IBKR and other sources

CREATE TABLE IF NOT EXISTS news_events (
  id BIGSERIAL PRIMARY KEY,
  published_at TIMESTAMPTZ NOT NULL,
  source VARCHAR(30) NOT NULL,
  headline TEXT NOT NULL,
  summary TEXT,
  url TEXT,
  raw_content TEXT,
  article_id VARCHAR(100),

  -- AI classification
  event_type VARCHAR(30) NOT NULL,
  severity INTEGER NOT NULL CHECK (severity >= 1 AND severity <= 5),
  sentiment NUMERIC(4,3) CHECK (sentiment >= -1 AND sentiment <= 1),
  confidence NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1),

  -- IBKR metadata
  provider_code VARCHAR(20),
  ibkr_sentiment NUMERIC(4,3),
  ibkr_confidence NUMERIC(4,3),

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (article_id, source)
);

CREATE INDEX IF NOT EXISTS idx_news_events_published ON news_events (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_events_type ON news_events (event_type);
CREATE INDEX IF NOT EXISTS idx_news_events_source ON news_events (source);

-- News ↔ Ticker mapping
CREATE TABLE IF NOT EXISTS news_ticker_map (
  id BIGSERIAL PRIMARY KEY,
  news_event_id BIGINT NOT NULL REFERENCES news_events(id) ON DELETE CASCADE,
  ticker VARCHAR(20) NOT NULL REFERENCES stocks(ticker) ON DELETE CASCADE,
  relevance_score NUMERIC(4,3),
  impact_direction VARCHAR(10) NOT NULL,

  UNIQUE (news_event_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_news_ticker_map_ticker ON news_ticker_map (ticker, news_event_id);

-- News ↔ Sector mapping
CREATE TABLE IF NOT EXISTS news_sector_map (
  id BIGSERIAL PRIMARY KEY,
  news_event_id BIGINT NOT NULL REFERENCES news_events(id) ON DELETE CASCADE,
  sector TEXT NOT NULL,
  impact_score NUMERIC(4,3),

  UNIQUE (news_event_id, sector)
);

CREATE INDEX IF NOT EXISTS idx_news_sector_map_sector ON news_sector_map (sector);
