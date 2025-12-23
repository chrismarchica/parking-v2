-- Create parking ticket table for historical NYC API data
CREATE TABLE parking_ticket (
  -- Identity
  summons_number        text PRIMARY KEY,
  source_dataset        text NOT NULL,           -- 'pvqr-7yc4' or 'nc67-uf89'

  -- Time
  issue_date            date,
  violation_time        text,                    -- raw (e.g. '0932A')

  -- Violation metadata
  violation_code        text,
  violation_desc        text,
  issuing_agency        text,

  -- Location (raw)
  county                text,
  precinct              text,
  street_name           text,
  intersecting_street   text,

  -- Location (geo)
  geom                  geography(Point, 4326),  -- populated after geocoding

  -- Money (ONLY what you want)
  fine_amount           numeric,

  -- Plate (optional but useful for QA / dedup)
  plate_id              text,
  registration_state    text,
  plate_type            text,

  -- Socrata system fields (for incremental ingestion)
  soda_row_id           text,
  soda_created_at       timestamptz,
  soda_updated_at       timestamptz,

  ingested_at           timestamptz NOT NULL DEFAULT now()
);

-- Index for incremental ingestion based on updated timestamp
CREATE INDEX parking_ticket_updated_at_idx
  ON parking_ticket (soda_updated_at);

-- Spatial index for geographic queries
CREATE INDEX parking_ticket_geom_idx
  ON parking_ticket USING GIST (geom);

