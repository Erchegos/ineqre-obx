-- Migration to support dual-listed stocks (same ticker on multiple exchanges)
-- This changes the primary key from ticker to (ticker, exchange)

-- Step 1: Add asset_type column if it doesn't exist
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS asset_type VARCHAR(50) DEFAULT 'equity';

-- Step 2: Drop the old primary key constraint
ALTER TABLE stocks DROP CONSTRAINT IF EXISTS stocks_pkey;

-- Step 3: Create new composite primary key
ALTER TABLE stocks ADD PRIMARY KEY (ticker, exchange, currency);

-- Step 4: Update foreign key in prices_daily to reference the composite key
-- First, add exchange and currency columns to prices_daily if they don't exist
ALTER TABLE prices_daily ADD COLUMN IF NOT EXISTS exchange VARCHAR(20) DEFAULT 'OSE';
ALTER TABLE prices_daily ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'NOK';

-- Step 5: Update existing prices_daily records with exchange and currency from stocks table
UPDATE prices_daily p
SET exchange = s.exchange, currency = s.currency
FROM stocks s
WHERE p.ticker = s.ticker
AND p.exchange = 'OSE'; -- Only update if not already set

-- Step 6: Drop old foreign key constraint
ALTER TABLE prices_daily DROP CONSTRAINT IF EXISTS prices_daily_ticker_fkey;

-- Step 7: Add new foreign key constraint with composite key
ALTER TABLE prices_daily ADD CONSTRAINT prices_daily_ticker_exchange_currency_fkey
  FOREIGN KEY (ticker, exchange, currency)
  REFERENCES stocks(ticker, exchange, currency)
  ON DELETE CASCADE;

-- Step 8: Update unique constraint to include exchange and currency
ALTER TABLE prices_daily DROP CONSTRAINT IF EXISTS prices_daily_ticker_date_source_key;
ALTER TABLE prices_daily ADD CONSTRAINT prices_daily_ticker_exchange_currency_date_source_key
  UNIQUE (ticker, exchange, currency, date, source);

-- Step 9: Create helpful indexes
CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker);
CREATE INDEX IF NOT EXISTS idx_stocks_exchange ON stocks(exchange);
CREATE INDEX IF NOT EXISTS idx_prices_daily_ticker_exchange ON prices_daily(ticker, exchange, currency, date DESC);

-- Step 10: Update other tables that reference stocks
-- fundamentals_snapshot
ALTER TABLE fundamentals_snapshot ADD COLUMN IF NOT EXISTS exchange VARCHAR(20) DEFAULT 'OSE';
ALTER TABLE fundamentals_snapshot ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'NOK';

UPDATE fundamentals_snapshot f
SET exchange = s.exchange, currency = s.currency
FROM stocks s
WHERE f.ticker = s.ticker
AND f.exchange = 'OSE';

ALTER TABLE fundamentals_snapshot DROP CONSTRAINT IF EXISTS fundamentals_snapshot_ticker_fkey;
ALTER TABLE fundamentals_snapshot ADD CONSTRAINT fundamentals_snapshot_ticker_exchange_currency_fkey
  FOREIGN KEY (ticker, exchange, currency)
  REFERENCES stocks(ticker, exchange, currency)
  ON DELETE CASCADE;

ALTER TABLE fundamentals_snapshot DROP CONSTRAINT IF EXISTS fundamentals_snapshot_ticker_as_of_date_source_key;
ALTER TABLE fundamentals_snapshot ADD CONSTRAINT fundamentals_snapshot_ticker_exchange_currency_as_of_date_source_key
  UNIQUE (ticker, exchange, currency, as_of_date, source);

-- news_raw - make ticker nullable and don't require composite key
-- (news can be about a company in general, not specific to an exchange)

-- summaries - similar to news, make it general
ALTER TABLE summaries ADD COLUMN IF NOT EXISTS exchange VARCHAR(20);
ALTER TABLE summaries ADD COLUMN IF NOT EXISTS currency VARCHAR(3);

ALTER TABLE summaries DROP CONSTRAINT IF EXISTS summaries_ticker_fkey;
-- Don't add foreign key for summaries - they're about companies in general

-- changes - similar approach
ALTER TABLE changes ADD COLUMN IF NOT EXISTS exchange VARCHAR(20);
ALTER TABLE changes ADD COLUMN IF NOT EXISTS currency VARCHAR(3);

ALTER TABLE changes DROP CONSTRAINT IF EXISTS changes_ticker_fkey;
-- Don't add foreign key for changes - they're about companies in general
