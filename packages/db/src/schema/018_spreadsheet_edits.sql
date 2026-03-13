-- Spreadsheet edits: stores per-user per-ticker Fortune-Sheet state
-- Used by the Financial Model tab on /stocks/[ticker]

CREATE TABLE IF NOT EXISTS spreadsheet_edits (
  id BIGSERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL,
  profile VARCHAR(50) NOT NULL,
  sheet_data JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ticker, profile)
);

CREATE INDEX IF NOT EXISTS idx_spreadsheet_edits_ticker ON spreadsheet_edits (ticker);
CREATE INDEX IF NOT EXISTS idx_spreadsheet_edits_profile ON spreadsheet_edits (profile);
CREATE INDEX IF NOT EXISTS idx_spreadsheet_edits_updated ON spreadsheet_edits (updated_at DESC);
