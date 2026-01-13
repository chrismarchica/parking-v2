-- ============================================================================
-- Address Backfill SQL Queries
-- ============================================================================
-- 
-- This file contains all SQL statements for the address backfill process.
-- Can be run manually or used as reference for the TypeScript script.
--
-- Prerequisites:
--   1. Run init-db/03-add-house-number.sql to create schema
--   2. Run the ingestion script to populate staging table
-- ============================================================================

-- ============================================================================
-- VALIDATION QUERIES (Run Before Backfill)
-- ============================================================================

-- 1. Count total records in parking_ticket
SELECT 'Total parking_ticket records' as metric, COUNT(*) as count 
FROM parking_ticket;

-- 2. Count records already having house_number
SELECT 'Records with house_number' as metric, COUNT(*) as count 
FROM parking_ticket 
WHERE house_number IS NOT NULL AND house_number != '';

-- 3. Count records missing house_number
SELECT 'Records missing house_number' as metric, COUNT(*) as count 
FROM parking_ticket 
WHERE house_number IS NULL OR house_number = '';

-- 4. Count staging table records
SELECT 'Staging table records' as metric, COUNT(*) as count 
FROM parking_violations_issued_staging;

-- 5. Count how many rows CAN be updated (the key metric)
SELECT 'Rows that CAN be updated' as metric, COUNT(*) as count
FROM parking_ticket pt
JOIN parking_violations_issued_staging staging 
  ON pt.summons_number = staging.summons_number
WHERE (pt.house_number IS NULL OR pt.house_number = '')
  AND staging.house_number IS NOT NULL 
  AND staging.house_number != '';

-- 6. Staging table breakdown by source year
SELECT source_year, COUNT(*) as count
FROM parking_violations_issued_staging
GROUP BY source_year
ORDER BY source_year DESC;


-- ============================================================================
-- BACKFILL UPDATE (The Main Query)
-- ============================================================================

-- Option A: Single UPDATE for smaller datasets (<500K rows)
-- 
-- This updates ALL matching rows in one transaction.
-- Safe and simple, but may lock table for a while on large datasets.

BEGIN;

UPDATE parking_ticket pt
SET 
  -- Always set house_number from staging (we only update where it's NULL)
  house_number = staging.house_number,
  
  -- Only update street_name if currently missing
  street_name = CASE 
    WHEN pt.street_name IS NULL OR pt.street_name = '' 
    THEN staging.street_name 
    ELSE pt.street_name 
  END,
  
  -- Only update county/borough if currently missing
  county = CASE 
    WHEN pt.county IS NULL OR pt.county = '' 
    THEN staging.borough 
    ELSE pt.county 
  END
  
  -- NOTE: geom is NOT touched - this is address enrichment only
FROM parking_violations_issued_staging staging
WHERE pt.summons_number = staging.summons_number
  AND (pt.house_number IS NULL OR pt.house_number = '')
  AND staging.house_number IS NOT NULL 
  AND staging.house_number != '';

-- Check how many were updated
-- SELECT statement after UPDATE shows rowcount in psql

COMMIT;


-- Option B: Batched UPDATE using keyset pagination (for large datasets)
--
-- Run this in a loop, passing the last summons_number each iteration.
-- Prevents table lock and allows monitoring progress.
-- 
-- Parameters:
--   $1 = last_summons_number (start with '' for first batch)
--   $2 = batch_size (e.g., 50000)

WITH to_update AS (
  SELECT pt.summons_number
  FROM parking_ticket pt
  JOIN parking_violations_issued_staging staging 
    ON pt.summons_number = staging.summons_number
  WHERE (pt.house_number IS NULL OR pt.house_number = '')
    AND staging.house_number IS NOT NULL 
    AND staging.house_number != ''
    AND pt.summons_number > $1  -- keyset pagination
  ORDER BY pt.summons_number
  LIMIT $2
)
UPDATE parking_ticket pt
SET 
  house_number = staging.house_number,
  street_name = CASE 
    WHEN pt.street_name IS NULL OR pt.street_name = '' 
    THEN staging.street_name 
    ELSE pt.street_name 
  END,
  county = CASE 
    WHEN pt.county IS NULL OR pt.county = '' 
    THEN staging.borough 
    ELSE pt.county 
  END
FROM parking_violations_issued_staging staging, to_update
WHERE pt.summons_number = staging.summons_number
  AND pt.summons_number = to_update.summons_number
RETURNING pt.summons_number;

-- The last returned summons_number becomes $1 for the next batch
-- Repeat until 0 rows returned


-- ============================================================================
-- VALIDATION QUERIES (Run After Backfill)
-- ============================================================================

-- 1. Count records now having house_number
SELECT 'Records with house_number (after)' as metric, COUNT(*) as count 
FROM parking_ticket 
WHERE house_number IS NOT NULL AND house_number != '';

-- 2. Count records STILL missing house_number
SELECT 'Records still missing house_number' as metric, COUNT(*) as count 
FROM parking_ticket 
WHERE house_number IS NULL OR house_number = '';

-- 3. Of those missing, how many have street_name (can use intersection geocoding)
SELECT 'Missing house_number but have street_name' as metric, COUNT(*) as count 
FROM parking_ticket 
WHERE (house_number IS NULL OR house_number = '')
  AND street_name IS NOT NULL 
  AND street_name != '';

-- 4. Coverage percentage
SELECT 
  'Coverage' as metric,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE house_number IS NOT NULL AND house_number != '') 
    / NULLIF(COUNT(*), 0), 
    1
  ) as percentage
FROM parking_ticket;

-- 5. Geocoding readiness summary
SELECT 
  'Ready for address geocoding' as method,
  COUNT(*) as count
FROM parking_ticket
WHERE house_number IS NOT NULL AND house_number != ''
  AND street_name IS NOT NULL AND street_name != ''
  AND county IS NOT NULL
  AND geom IS NULL

UNION ALL

SELECT 
  'Ready for intersection geocoding' as method,
  COUNT(*) as count
FROM parking_ticket
WHERE street_name IS NOT NULL AND street_name != ''
  AND intersecting_street IS NOT NULL AND intersecting_street != ''
  AND county IS NOT NULL
  AND geom IS NULL

UNION ALL

SELECT 
  'Already geocoded' as method,
  COUNT(*) as count
FROM parking_ticket
WHERE geom IS NOT NULL;


-- ============================================================================
-- CLEANUP (Optional - after confirming backfill is complete)
-- ============================================================================

-- Drop the staging table when no longer needed
-- DROP TABLE IF EXISTS parking_violations_issued_staging;

-- Or truncate to reuse for future backfills
-- TRUNCATE TABLE parking_violations_issued_staging;
