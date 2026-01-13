-- Migration: Add house_number column to parking_ticket table
-- and create staging table for address enrichment backfill

-- ============================================================================
-- Step 1: Add house_number column to parking_ticket (if not exists)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parking_ticket' AND column_name = 'house_number'
  ) THEN
    ALTER TABLE parking_ticket ADD COLUMN house_number TEXT;
    RAISE NOTICE 'Added house_number column to parking_ticket';
  ELSE
    RAISE NOTICE 'house_number column already exists';
  END IF;
END $$;

-- ============================================================================
-- Step 2: Create staging table for Parking Violations Issued data
-- ============================================================================

-- Drop if exists (for idempotency during development)
DROP TABLE IF EXISTS parking_violations_issued_staging;

CREATE TABLE parking_violations_issued_staging (
  -- Identity - must match parking_ticket.summons_number
  summons_number TEXT PRIMARY KEY,
  
  -- Address fields we need for geocoding
  house_number TEXT,
  street_name TEXT,
  borough TEXT,              -- Normalized borough name (Manhattan, Brooklyn, etc.)
  
  -- Optional: raw location string if dataset provides it
  raw_location TEXT,
  
  -- Source tracking for deduplication (e.g., 'FY2024', 'FY2023')
  source_year TEXT,
  
  -- Ingestion metadata
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient JOIN with parking_ticket
CREATE INDEX idx_staging_summons ON parking_violations_issued_staging(summons_number);

-- Useful for filtering/debugging
CREATE INDEX idx_staging_has_house_number ON parking_violations_issued_staging(house_number) 
  WHERE house_number IS NOT NULL AND house_number != '';

COMMENT ON TABLE parking_violations_issued_staging IS 
  'Staging table for address data from NYC Open Data Parking Violations Issued datasets. Used to backfill house_number into parking_ticket table.';

-- ============================================================================
-- Step 3: Create index on parking_ticket for efficient backfill
-- ============================================================================

-- Ensure index on summons_number exists (should already exist as PK)
-- Add partial index for rows needing house_number update
CREATE INDEX IF NOT EXISTS idx_parking_ticket_needs_house_number 
  ON parking_ticket(summons_number) 
  WHERE house_number IS NULL;

-- Migration complete: house_number column and staging table ready
