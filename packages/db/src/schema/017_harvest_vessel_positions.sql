-- Harvest vessel AIS position history
-- Stores position updates from AISStream.io for route visualization and trip detection

CREATE TABLE IF NOT EXISTS harvest_vessel_positions (
  id BIGSERIAL PRIMARY KEY,
  vessel_id INTEGER NOT NULL REFERENCES harvest_vessels(id),
  mmsi VARCHAR(20),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  speed_knots DOUBLE PRECISION,
  heading INTEGER,
  course DOUBLE PRECISION,
  nav_status VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hvp_vessel_timestamp ON harvest_vessel_positions(vessel_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hvp_mmsi_timestamp ON harvest_vessel_positions(mmsi, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hvp_timestamp ON harvest_vessel_positions(timestamp DESC);
