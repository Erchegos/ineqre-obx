-- Research documents from Pareto and other sources
CREATE TABLE IF NOT EXISTS research_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticker VARCHAR(20) REFERENCES stocks(ticker) ON DELETE SET NULL,
  email_message_id VARCHAR(255) UNIQUE, -- Email Message-ID header for deduplication
  source VARCHAR(100) NOT NULL, -- 'Pareto Securities', 'DNB Markets', etc.
  sender_email VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT,
  received_date TIMESTAMPTZ NOT NULL,
  processed_date TIMESTAMPTZ DEFAULT NOW(),

  -- Document metadata
  has_attachments BOOLEAN DEFAULT false,
  attachment_count INT DEFAULT 0,

  -- Storage
  raw_email_path TEXT, -- Path to raw email file if stored

  -- Categorization
  document_type VARCHAR(50), -- 'morning_brief', 'company_update', 'sector_report', etc.
  tags TEXT[], -- Array of tags for filtering

  -- Full-text search
  search_vector tsvector,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Attachments (PDFs, images, etc.)
CREATE TABLE IF NOT EXISTS research_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES research_documents(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  file_size BIGINT NOT NULL,
  file_path TEXT NOT NULL, -- S3 or local storage path
  file_url TEXT, -- Presigned URL (regenerated on access)

  -- PDF-specific metadata
  page_count INT,
  extracted_text TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Access control - simple password protection for now
CREATE TABLE IF NOT EXISTS research_access_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_hash VARCHAR(255) NOT NULL UNIQUE, -- bcrypt hash of password
  description TEXT NOT NULL, -- e.g., 'Main research portal access'
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ, -- NULL = no expiration
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by VARCHAR(100),
  last_used_at TIMESTAMPTZ
);

-- Access logs for security audit
CREATE TABLE IF NOT EXISTS research_access_logs (
  id BIGSERIAL PRIMARY KEY,
  token_id UUID REFERENCES research_access_tokens(id) ON DELETE SET NULL,
  document_id UUID REFERENCES research_documents(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL, -- 'view', 'download', 'list'
  ip_address VARCHAR(45),
  user_agent TEXT,
  accessed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_research_documents_ticker ON research_documents (ticker, received_date DESC);
CREATE INDEX IF NOT EXISTS idx_research_documents_source ON research_documents (source, received_date DESC);
CREATE INDEX IF NOT EXISTS idx_research_documents_received ON research_documents (received_date DESC);
CREATE INDEX IF NOT EXISTS idx_research_documents_email_id ON research_documents (email_message_id);
CREATE INDEX IF NOT EXISTS idx_research_attachments_document ON research_attachments (document_id);
CREATE INDEX IF NOT EXISTS idx_research_access_logs_accessed ON research_access_logs (accessed_at DESC);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_research_documents_search ON research_documents USING GIN (search_vector);

-- Trigger to update search_vector automatically
CREATE OR REPLACE FUNCTION research_documents_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.subject, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.body_text, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.source, '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER research_documents_search_update
  BEFORE INSERT OR UPDATE ON research_documents
  FOR EACH ROW
  EXECUTE FUNCTION research_documents_search_trigger();

-- Insert default access token (password: "research2024" - CHANGE THIS!)
-- Hash generated with bcrypt, rounds=10
INSERT INTO research_access_tokens (token_hash, description, is_active)
VALUES ('$2b$10$rKj5mXGzQvH4YnPvFx7P8uN9FJ0.vZGxKH8XFa3qXF5NKj0P8rFKq', 'Default research portal access', true)
ON CONFLICT DO NOTHING;
