#!/usr/bin/env node
/**
 * Address Backfill Script for NYC Parking Tickets
 * 
 * Ingests address data (house_number, street_name, borough) from NYC Open Data
 * "Parking Violations Issued" datasets into a staging table, then backfills
 * missing addresses into the main parking_ticket table.
 * 
 * Usage:
 *   npx tsx scripts/backfill-addresses.ts --ingest           # Ingest data into staging
 *   npx tsx scripts/backfill-addresses.ts --backfill         # Backfill from staging to parking_ticket
 *   npx tsx scripts/backfill-addresses.ts --ingest --backfill  # Both steps
 *   npx tsx scripts/backfill-addresses.ts --stats            # Show statistics
 *   npx tsx scripts/backfill-addresses.ts --dry-run          # Preview without changes
 * 
 * Environment Variables Required:
 *   DATABASE_URL          - PostgreSQL connection string
 *   NYC_OPEN_DATA_APP_TOKEN - Socrata app token (optional but recommended)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { Pool } from 'pg';

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

// ============================================================================
// Configuration
// ============================================================================

const DATABASE_URL = process.env.DATABASE_URL;
const APP_TOKEN = process.env.NYC_OPEN_DATA_APP_TOKEN;

const SOCRATA_BASE_URL = 'https://data.cityofnewyork.us/resource';

// Parking Violations Issued datasets (Fiscal Year datasets with address data)
// These datasets contain: summons_number, house_number, street_name, violation_county
const PARKING_VIOLATIONS_DATASETS = [
  { id: 'pvqr-7yc4', name: 'FY2024', year: '2024' },
  { id: 'pvda-ns3a', name: 'FY2023', year: '2023' },
  { id: '869v-vr48', name: 'FY2022', year: '2022' },
  { id: 'p7t3-5i9s', name: 'FY2021', year: '2021' },
  { id: 'jt7v-77mi', name: 'FY2020', year: '2020' },
  { id: 'faiq-9dfq', name: 'FY2019', year: '2019' },
  { id: '9wgk-ev5c', name: 'FY2018', year: '2018' },
  { id: '2bnn-yakx', name: 'FY2017', year: '2017' },
] as const;

// Pagination settings
const PAGE_SIZE = 5000;
const DELAY_BETWEEN_PAGES_MS = 100;
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;

// Batch insert size
const BATCH_INSERT_SIZE = 1000;

// County code to borough name mapping
const COUNTY_TO_BOROUGH: Record<string, string> = {
  'NY': 'Manhattan',
  'MN': 'Manhattan',
  'MANHATTAN': 'Manhattan',
  'K': 'Brooklyn',
  'BK': 'Brooklyn',
  'BROOKLYN': 'Brooklyn',
  'KINGS': 'Brooklyn',
  'Q': 'Queens',
  'QN': 'Queens',
  'QUEENS': 'Queens',
  'BX': 'Bronx',
  'BRONX': 'Bronx',
  'R': 'Staten Island',
  'ST': 'Staten Island',
  'STATEN ISLAND': 'Staten Island',
  'RICHMOND': 'Staten Island',
};

// ============================================================================
// Database Connection
// ============================================================================

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ============================================================================
// Socrata API Functions
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;
  let backoff = INITIAL_BACKOFF_MS;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429 || response.status >= 500) {
        if (attempt < retries) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : backoff;
          console.log(`  Request failed with ${response.status}, retrying in ${waitTime}ms...`);
          await sleep(waitTime);
          backoff *= 2;
          continue;
        }
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) {
        await sleep(backoff);
        backoff *= 2;
      }
    }
  }

  throw lastError || new Error('Request failed after retries');
}

interface SocrataRow {
  summons_number?: string;
  house_number?: string;
  street_name?: string;
  violation_county?: string;
  issue_date?: string;
}

/**
 * Fetch a page of address data from a Parking Violations Issued dataset
 */
async function fetchAddressPage(
  datasetId: string,
  offset: number
): Promise<SocrataRow[]> {
  const params = new URLSearchParams({
    $select: 'summons_number,house_number,street_name,violation_county,issue_date',
    $where: "summons_number IS NOT NULL AND house_number IS NOT NULL AND house_number != ''",
    $order: 'summons_number ASC',
    $limit: PAGE_SIZE.toString(),
    $offset: offset.toString(),
  });

  const url = `${SOCRATA_BASE_URL}/${datasetId}.json?${params.toString()}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (APP_TOKEN) {
    headers['X-App-Token'] = APP_TOKEN;
  }

  const response = await fetchWithRetry(url, { headers });
  return await response.json() as SocrataRow[];
}

/**
 * Get count of records with house_number in a dataset
 */
async function getDatasetCount(datasetId: string): Promise<number> {
  const params = new URLSearchParams({
    $select: 'count(*)',
    $where: "summons_number IS NOT NULL AND house_number IS NOT NULL AND house_number != ''",
  });

  const url = `${SOCRATA_BASE_URL}/${datasetId}.json?${params.toString()}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (APP_TOKEN) {
    headers['X-App-Token'] = APP_TOKEN;
  }

  const response = await fetchWithRetry(url, { headers });
  const data = await response.json() as Array<{ count: string }>;
  return parseInt(data[0]?.count || '0', 10);
}

// ============================================================================
// Database Operations
// ============================================================================

interface StagingRow {
  summons_number: string;
  house_number: string;
  street_name: string;
  borough: string;
  source_year: string;
}

/**
 * Normalize borough from county code
 */
function normalizeBorough(county: string | undefined): string | null {
  if (!county) return null;
  return COUNTY_TO_BOROUGH[county.toUpperCase()] || county.toUpperCase();
}

/**
 * Transform Socrata row to staging row
 */
function transformRow(row: SocrataRow, sourceYear: string): StagingRow | null {
  if (!row.summons_number || !row.house_number) {
    return null;
  }

  const borough = normalizeBorough(row.violation_county);
  if (!borough) {
    return null;
  }

  return {
    summons_number: row.summons_number.trim(),
    house_number: row.house_number.trim().toUpperCase(),
    street_name: (row.street_name || '').trim().toUpperCase(),
    borough,
    source_year: sourceYear,
  };
}

/**
 * Batch upsert rows into staging table
 * Uses ON CONFLICT to prefer newer records (higher source_year)
 */
async function upsertStagingBatch(rows: StagingRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const db = getPool();
  const values: unknown[] = [];
  const valuePlaceholders: string[] = [];

  rows.forEach((row, i) => {
    const offset = i * 5;
    valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
    values.push(
      row.summons_number,
      row.house_number,
      row.street_name,
      row.borough,
      row.source_year
    );
  });

  const query = `
    INSERT INTO parking_violations_issued_staging 
      (summons_number, house_number, street_name, borough, source_year)
    VALUES ${valuePlaceholders.join(', ')}
    ON CONFLICT (summons_number) DO UPDATE SET
      house_number = CASE 
        WHEN EXCLUDED.source_year >= parking_violations_issued_staging.source_year 
        THEN EXCLUDED.house_number 
        ELSE parking_violations_issued_staging.house_number 
      END,
      street_name = CASE 
        WHEN EXCLUDED.source_year >= parking_violations_issued_staging.source_year 
        THEN EXCLUDED.street_name 
        ELSE parking_violations_issued_staging.street_name 
      END,
      borough = CASE 
        WHEN EXCLUDED.source_year >= parking_violations_issued_staging.source_year 
        THEN EXCLUDED.borough 
        ELSE parking_violations_issued_staging.borough 
      END,
      source_year = GREATEST(EXCLUDED.source_year, parking_violations_issued_staging.source_year),
      ingested_at = NOW()
  `;

  const result = await db.query(query, values);
  return result.rowCount || 0;
}

/**
 * Ensure staging table exists
 */
async function ensureStagingTable(): Promise<void> {
  const db = getPool();
  
  await db.query(`
    CREATE TABLE IF NOT EXISTS parking_violations_issued_staging (
      summons_number TEXT PRIMARY KEY,
      house_number TEXT,
      street_name TEXT,
      borough TEXT,
      raw_location TEXT,
      source_year TEXT,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_staging_summons 
    ON parking_violations_issued_staging(summons_number)
  `);
}

/**
 * Ensure house_number column exists in parking_ticket
 */
async function ensureHouseNumberColumn(): Promise<void> {
  const db = getPool();
  
  const result = await db.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'parking_ticket' AND column_name = 'house_number'
  `);
  
  if (result.rows.length === 0) {
    await db.query('ALTER TABLE parking_ticket ADD COLUMN house_number TEXT');
    console.log('Added house_number column to parking_ticket table');
  }
}

// ============================================================================
// Ingestion Process
// ============================================================================

interface IngestOptions {
  dryRun?: boolean;
  datasets?: string[];  // Filter to specific dataset IDs
}

async function ingestDataset(
  datasetId: string,
  datasetName: string,
  sourceYear: string,
  options: IngestOptions = {}
): Promise<{ ingested: number; skipped: number }> {
  const { dryRun = false } = options;
  
  console.log(`\n📥 Ingesting ${datasetName} (${datasetId})...`);
  
  // Get count first
  const totalCount = await getDatasetCount(datasetId);
  console.log(`   Found ${totalCount.toLocaleString()} records with house_number`);
  
  if (totalCount === 0) {
    return { ingested: 0, skipped: 0 };
  }
  
  let offset = 0;
  let ingested = 0;
  let skipped = 0;
  let batch: StagingRow[] = [];
  
  while (offset < totalCount) {
    const page = await fetchAddressPage(datasetId, offset);
    
    if (page.length === 0) break;
    
    for (const row of page) {
      const transformed = transformRow(row, sourceYear);
      if (transformed) {
        batch.push(transformed);
      } else {
        skipped++;
      }
      
      // Batch insert
      if (batch.length >= BATCH_INSERT_SIZE) {
        if (!dryRun) {
          await upsertStagingBatch(batch);
        }
        ingested += batch.length;
        batch = [];
      }
    }
    
    offset += page.length;
    
    // Progress update
    const pct = Math.round((offset / totalCount) * 100);
    process.stdout.write(`\r   Progress: ${offset.toLocaleString()}/${totalCount.toLocaleString()} (${pct}%)`);
    
    // Rate limiting
    if (page.length === PAGE_SIZE) {
      await sleep(DELAY_BETWEEN_PAGES_MS);
    }
  }
  
  // Insert remaining batch
  if (batch.length > 0 && !dryRun) {
    await upsertStagingBatch(batch);
  }
  ingested += batch.length;
  
  console.log(`\n   ✅ Ingested: ${ingested.toLocaleString()}, Skipped: ${skipped.toLocaleString()}`);
  
  return { ingested, skipped };
}

async function runIngestion(options: IngestOptions = {}): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('Address Data Ingestion - Parking Violations Issued');
  console.log('='.repeat(60));
  
  if (options.dryRun) {
    console.log('MODE: DRY RUN (no database writes)');
  }
  
  // Ensure schema exists
  if (!options.dryRun) {
    await ensureStagingTable();
    await ensureHouseNumberColumn();
  }
  
  let totalIngested = 0;
  let totalSkipped = 0;
  
  // Ingest from newest to oldest (prefer recent data)
  const datasets = options.datasets 
    ? PARKING_VIOLATIONS_DATASETS.filter(d => options.datasets!.includes(d.id))
    : PARKING_VIOLATIONS_DATASETS;
  
  for (const dataset of datasets) {
    try {
      const { ingested, skipped } = await ingestDataset(
        dataset.id,
        dataset.name,
        dataset.year,
        options
      );
      totalIngested += ingested;
      totalSkipped += skipped;
    } catch (error) {
      console.error(`\n   ❌ Error ingesting ${dataset.name}: ${error}`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Ingestion Complete');
  console.log('='.repeat(60));
  console.log(`Total ingested: ${totalIngested.toLocaleString()}`);
  console.log(`Total skipped: ${totalSkipped.toLocaleString()}`);
  
  // Show staging table stats
  if (!options.dryRun) {
    const db = getPool();
    const countResult = await db.query('SELECT COUNT(*) as count FROM parking_violations_issued_staging');
    console.log(`Staging table now has: ${parseInt(countResult.rows[0].count).toLocaleString()} records`);
  }
}

// ============================================================================
// Backfill Process
// ============================================================================

interface BackfillOptions {
  dryRun?: boolean;
  batchSize?: number;
}

async function runBackfill(options: BackfillOptions = {}): Promise<void> {
  const { dryRun = false, batchSize = 50000 } = options;
  const db = getPool();
  
  console.log('\n' + '='.repeat(60));
  console.log('Address Backfill - parking_ticket from staging');
  console.log('='.repeat(60));
  
  if (dryRun) {
    console.log('MODE: DRY RUN (no database updates)');
  }
  
  // Ensure house_number column exists
  if (!dryRun) {
    await ensureHouseNumberColumn();
  }
  
  // ========================================================================
  // Pre-update statistics
  // ========================================================================
  console.log('\n📊 Pre-Update Statistics:');
  
  const [
    totalTickets,
    ticketsWithHouseNumber,
    ticketsNeedingUpdate,
    stagingCount,
    matchingRecords
  ] = await Promise.all([
    db.query('SELECT COUNT(*) as count FROM parking_ticket'),
    db.query("SELECT COUNT(*) as count FROM parking_ticket WHERE house_number IS NOT NULL AND house_number != ''"),
    db.query("SELECT COUNT(*) as count FROM parking_ticket WHERE house_number IS NULL OR house_number = ''"),
    db.query('SELECT COUNT(*) as count FROM parking_violations_issued_staging'),
    db.query(`
      SELECT COUNT(*) as count 
      FROM parking_ticket pt
      JOIN parking_violations_issued_staging staging ON pt.summons_number = staging.summons_number
      WHERE (pt.house_number IS NULL OR pt.house_number = '')
        AND staging.house_number IS NOT NULL 
        AND staging.house_number != ''
    `),
  ]);
  
  const total = parseInt(totalTickets.rows[0].count);
  const withHouse = parseInt(ticketsWithHouseNumber.rows[0].count);
  const needsUpdate = parseInt(ticketsNeedingUpdate.rows[0].count);
  const stagingTotal = parseInt(stagingCount.rows[0].count);
  const canUpdate = parseInt(matchingRecords.rows[0].count);
  
  console.log(`   Total parking_ticket rows: ${total.toLocaleString()}`);
  console.log(`   Already have house_number: ${withHouse.toLocaleString()}`);
  console.log(`   Missing house_number:      ${needsUpdate.toLocaleString()}`);
  console.log(`   Staging table records:     ${stagingTotal.toLocaleString()}`);
  console.log(`   Rows that CAN be updated:  ${canUpdate.toLocaleString()}`);
  
  if (canUpdate === 0) {
    console.log('\n✅ No rows to update. All matching records already have house_number.');
    return;
  }
  
  // ========================================================================
  // Perform the UPDATE in batches using keyset pagination
  // ========================================================================
  console.log(`\n🔄 Updating ${canUpdate.toLocaleString()} rows...`);
  
  if (dryRun) {
    console.log('   (Skipping actual update in dry-run mode)');
  } else {
    let totalUpdated = 0;
    let lastSummonsNumber = '';
    
    while (totalUpdated < canUpdate) {
      // Use keyset pagination (NOT offset) for efficiency
      const updateQuery = `
        WITH to_update AS (
          SELECT pt.summons_number
          FROM parking_ticket pt
          JOIN parking_violations_issued_staging staging 
            ON pt.summons_number = staging.summons_number
          WHERE (pt.house_number IS NULL OR pt.house_number = '')
            AND staging.house_number IS NOT NULL 
            AND staging.house_number != ''
            AND pt.summons_number > $1
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
        RETURNING pt.summons_number
      `;
      
      const result = await db.query(updateQuery, [lastSummonsNumber, batchSize]);
      const rowsUpdated = result.rowCount || 0;
      
      if (rowsUpdated === 0) break;
      
      // Get the last summons_number for next batch
      lastSummonsNumber = result.rows[result.rows.length - 1].summons_number;
      totalUpdated += rowsUpdated;
      
      const pct = Math.round((totalUpdated / canUpdate) * 100);
      process.stdout.write(`\r   Progress: ${totalUpdated.toLocaleString()}/${canUpdate.toLocaleString()} (${pct}%)`);
    }
    
    console.log(`\n   ✅ Updated ${totalUpdated.toLocaleString()} rows`);
  }
  
  // ========================================================================
  // Post-update statistics
  // ========================================================================
  console.log('\n📊 Post-Update Statistics:');
  
  const [
    postWithHouseNumber,
    postMissingHouseNumber,
    postMissingWithStreet
  ] = await Promise.all([
    db.query("SELECT COUNT(*) as count FROM parking_ticket WHERE house_number IS NOT NULL AND house_number != ''"),
    db.query("SELECT COUNT(*) as count FROM parking_ticket WHERE house_number IS NULL OR house_number = ''"),
    db.query(`
      SELECT COUNT(*) as count 
      FROM parking_ticket 
      WHERE (house_number IS NULL OR house_number = '')
        AND street_name IS NOT NULL 
        AND street_name != ''
    `),
  ]);
  
  const postWith = parseInt(postWithHouseNumber.rows[0].count);
  const postMissing = parseInt(postMissingHouseNumber.rows[0].count);
  const postMissingStreet = parseInt(postMissingWithStreet.rows[0].count);
  
  const gained = postWith - withHouse;
  const pctWithHouse = ((postWith / total) * 100).toFixed(1);
  
  console.log(`   Now have house_number:     ${postWith.toLocaleString()} (${pctWithHouse}%)`);
  console.log(`   Gained house_number:       +${gained.toLocaleString()}`);
  console.log(`   Still missing house_number: ${postMissing.toLocaleString()}`);
  console.log(`     (of which have street):   ${postMissingStreet.toLocaleString()}`);
  
  console.log('\n' + '='.repeat(60));
  console.log('Backfill Complete');
  console.log('='.repeat(60));
}

// ============================================================================
// Statistics
// ============================================================================

async function showStats(): Promise<void> {
  const db = getPool();
  
  console.log('\n=== Address Backfill Statistics ===\n');
  
  // Check if tables exist
  const parkingTableExists = await db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'parking_ticket'
    ) as exists
  `);
  
  if (!parkingTableExists.rows[0].exists) {
    console.log('parking_ticket table does not exist yet.');
    return;
  }
  
  // Check if house_number column exists
  const columnExists = await db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns 
      WHERE table_name = 'parking_ticket' AND column_name = 'house_number'
    ) as exists
  `);
  
  // Main table stats
  console.log('parking_ticket Table:');
  const totalResult = await db.query('SELECT COUNT(*) as count FROM parking_ticket');
  console.log(`  Total records: ${parseInt(totalResult.rows[0].count).toLocaleString()}`);
  
  if (columnExists.rows[0].exists) {
    const [withHouse, withStreet, withCounty] = await Promise.all([
      db.query("SELECT COUNT(*) as count FROM parking_ticket WHERE house_number IS NOT NULL AND house_number != ''"),
      db.query("SELECT COUNT(*) as count FROM parking_ticket WHERE street_name IS NOT NULL AND street_name != ''"),
      db.query("SELECT COUNT(*) as count FROM parking_ticket WHERE county IS NOT NULL AND county != ''"),
    ]);
    
    console.log(`  With house_number: ${parseInt(withHouse.rows[0].count).toLocaleString()}`);
    console.log(`  With street_name:  ${parseInt(withStreet.rows[0].count).toLocaleString()}`);
    console.log(`  With county:       ${parseInt(withCounty.rows[0].count).toLocaleString()}`);
  } else {
    console.log('  house_number column: NOT ADDED YET');
  }
  
  // Staging table stats
  const stagingExists = await db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'parking_violations_issued_staging'
    ) as exists
  `);
  
  console.log('\nparking_violations_issued_staging Table:');
  
  if (stagingExists.rows[0].exists) {
    const [stagingTotal, byYear] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM parking_violations_issued_staging'),
      db.query(`
        SELECT source_year, COUNT(*) as count 
        FROM parking_violations_issued_staging 
        GROUP BY source_year 
        ORDER BY source_year DESC
      `),
    ]);
    
    console.log(`  Total records: ${parseInt(stagingTotal.rows[0].count).toLocaleString()}`);
    console.log('  By source year:');
    for (const row of byYear.rows) {
      console.log(`    ${row.source_year}: ${parseInt(row.count).toLocaleString()}`);
    }
    
    // Check matching
    if (columnExists.rows[0].exists) {
      const matchable = await db.query(`
        SELECT COUNT(*) as count
        FROM parking_ticket pt
        JOIN parking_violations_issued_staging staging ON pt.summons_number = staging.summons_number
        WHERE (pt.house_number IS NULL OR pt.house_number = '')
          AND staging.house_number IS NOT NULL AND staging.house_number != ''
      `);
      console.log(`\nMatchable records (can backfill): ${parseInt(matchable.rows[0].count).toLocaleString()}`);
    }
  } else {
    console.log('  Table does not exist. Run --ingest first.');
  }
  
  // Geocoding readiness
  console.log('\nGeocoding Readiness:');
  if (columnExists.rows[0].exists) {
    const geocodable = await db.query(`
      SELECT COUNT(*) as count
      FROM parking_ticket
      WHERE house_number IS NOT NULL AND house_number != ''
        AND street_name IS NOT NULL AND street_name != ''
        AND county IS NOT NULL
        AND geom IS NULL
    `);
    console.log(`  Ready for /address geocoding: ${parseInt(geocodable.rows[0].count).toLocaleString()}`);
  }
  
  const intersectionGeocodable = await db.query(`
    SELECT COUNT(*) as count
    FROM parking_ticket
    WHERE street_name IS NOT NULL AND street_name != ''
      AND intersecting_street IS NOT NULL AND intersecting_street != ''
      AND county IS NOT NULL
      AND geom IS NULL
  `);
  console.log(`  Ready for intersection geocoding: ${parseInt(intersectionGeocodable.rows[0].count).toLocaleString()}`);
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
Address Backfill Script for NYC Parking Tickets

Usage:
  npx tsx scripts/backfill-addresses.ts [options]

Options:
  --ingest        Ingest address data from Socrata into staging table
  --backfill      Update parking_ticket from staging table
  --stats         Show current statistics
  --dry-run       Preview without making changes
  --help, -h      Show this help message

Examples:
  npx tsx scripts/backfill-addresses.ts --stats         # Check current state
  npx tsx scripts/backfill-addresses.ts --ingest        # Download address data
  npx tsx scripts/backfill-addresses.ts --backfill      # Apply to parking_ticket
  npx tsx scripts/backfill-addresses.ts --ingest --backfill  # Both steps

Datasets Ingested (Fiscal Year Parking Violations Issued):
${PARKING_VIOLATIONS_DATASETS.map(d => `  - ${d.name}: ${d.id}`).join('\n')}

Environment Variables:
  DATABASE_URL              PostgreSQL connection string (required)
  NYC_OPEN_DATA_APP_TOKEN   Socrata app token (recommended)
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  const showHelp = args.includes('--help') || args.includes('-h');
  const doIngest = args.includes('--ingest');
  const doBackfill = args.includes('--backfill');
  const showStatsOnly = args.includes('--stats');
  const dryRun = args.includes('--dry-run');
  
  if (showHelp) {
    printUsage();
    process.exit(0);
  }
  
  if (!DATABASE_URL) {
    console.error('Error: DATABASE_URL environment variable is required');
    process.exit(1);
  }
  
  try {
    if (showStatsOnly) {
      await showStats();
    } else if (doIngest || doBackfill) {
      if (doIngest) {
        await runIngestion({ dryRun });
      }
      if (doBackfill) {
        await runBackfill({ dryRun });
      }
    } else {
      printUsage();
      console.log('\nNo action specified. Use --ingest, --backfill, or --stats');
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
