-- ============================================================================
-- Supabase Database Initialization for Parking Ticket Data
-- 
-- Run this in the Supabase SQL Editor to create all required tables.
-- PostGIS is already enabled in Supabase by default.
-- ============================================================================

-- ============================================================================
-- 1. Enable PostGIS (if not already enabled)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================================
-- 2. Main parking_ticket table
-- ============================================================================
CREATE TABLE IF NOT EXISTS parking_ticket (
  -- Identity
  summons_number        TEXT PRIMARY KEY,
  source_dataset        TEXT NOT NULL,           -- Dataset ID (e.g., 'pvqr-7yc4', 'nc67-uf89')

  -- Time
  issue_date            DATE,
  violation_time        TEXT,                    -- Raw format (e.g., '0932A')

  -- Violation metadata
  violation_code        TEXT,
  violation_desc        TEXT,
  issuing_agency        TEXT,

  -- Location (raw address data)
  house_number          TEXT,                    -- For address geocoding
  county                TEXT,
  precinct              TEXT,
  street_name           TEXT,
  intersecting_street   TEXT,

  -- Location (geocoded)
  geom                  GEOGRAPHY(Point, 4326),  -- Populated after geocoding

  -- Financial
  fine_amount           NUMERIC,

  -- Vehicle info
  plate_id              TEXT,
  registration_state    TEXT,
  plate_type            TEXT,

  -- Socrata system fields (for incremental ingestion)
  soda_row_id           TEXT,
  soda_created_at       TIMESTAMPTZ,
  soda_updated_at       TIMESTAMPTZ,

  -- Our metadata
  ingested_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. Indexes for parking_ticket
-- ============================================================================

-- For incremental ingestion based on updated timestamp
CREATE INDEX IF NOT EXISTS parking_ticket_updated_at_idx
  ON parking_ticket (soda_updated_at);

-- Spatial index for geographic queries
CREATE INDEX IF NOT EXISTS parking_ticket_geom_idx
  ON parking_ticket USING GIST (geom);

-- For efficient backfill of records missing house_number
CREATE INDEX IF NOT EXISTS idx_parking_ticket_needs_house_number 
  ON parking_ticket(summons_number) 
  WHERE house_number IS NULL;

-- For queries by issue_date
CREATE INDEX IF NOT EXISTS parking_ticket_issue_date_idx
  ON parking_ticket (issue_date);

-- For queries by county/borough
CREATE INDEX IF NOT EXISTS parking_ticket_county_idx
  ON parking_ticket (county);

-- ============================================================================
-- 4. Cursor table for incremental ingestion
-- ============================================================================
CREATE TABLE IF NOT EXISTS ingest_cursor (
  dataset_id          TEXT PRIMARY KEY,
  last_soda_updated   TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 5. Staging table for address backfill (optional, used by backfill-addresses.ts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS parking_violations_issued_staging (
  summons_number TEXT PRIMARY KEY,
  house_number TEXT,
  street_name TEXT,
  borough TEXT,
  raw_location TEXT,
  source_year TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staging_summons 
  ON parking_violations_issued_staging(summons_number);

CREATE INDEX IF NOT EXISTS idx_staging_has_house_number 
  ON parking_violations_issued_staging(house_number) 
  WHERE house_number IS NOT NULL AND house_number != '';

-- ============================================================================
-- 6. Add comments for documentation
-- ============================================================================
COMMENT ON TABLE parking_ticket IS 
  'NYC parking ticket data from Open Data. Ingested from multiple fiscal year datasets.';

COMMENT ON TABLE ingest_cursor IS 
  'Tracks last ingested timestamp per dataset for incremental sync.';

COMMENT ON TABLE parking_violations_issued_staging IS 
  'Staging table for address enrichment from Parking Violations Issued datasets.';

-- ============================================================================
-- Initialization complete!
-- ============================================================================
SELECT 'Database initialized successfully!' AS status;
SELECT COUNT(*) AS parking_ticket_count FROM parking_ticket;
