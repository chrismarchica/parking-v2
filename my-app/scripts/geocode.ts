#!/usr/bin/env node
/**
 * Geocoding script for parking ticket data using NYC GeoClient API
 * 
 * Uses NYC's free GeoClient API (unlimited requests) to convert street addresses
 * to lat/lon coordinates and updates the geom column in the parking_ticket table.
 * 
 * Register for API keys at: https://api-portal.nyc.gov/
 * 
 * Usage:
 *   npx tsx scripts/geocode.ts              - Geocode all records without geom
 *   npx tsx scripts/geocode.ts --limit=1000 - Geocode up to 1000 records
 *   npx tsx scripts/geocode.ts --stats      - Show geocoding statistics
 *   npx tsx scripts/geocode.ts --dry-run    - Preview without updating database
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { Pool } from 'pg';

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

// ============================================================================
// Configuration
// ============================================================================

const NYC_GEOCLIENT_KEY = process.env.NYC_GEOCLIENT_KEY; // Primary or Secondary key from API portal
const DATABASE_URL = process.env.DATABASE_URL;

// NYC GeoClient API (v2)
const GEOCLIENT_BASE_URL = 'https://api.nyc.gov/geoclient/v2';

// Rate limiting: Your subscription allows 100/sec, 2500/min
// But we need to be conservative to avoid 429 errors
const REQUESTS_PER_SECOND = 10;
const DELAY_BETWEEN_REQUESTS_MS = Math.ceil(1000 / REQUESTS_PER_SECOND);

// Batch processing
const FETCH_BATCH_SIZE = 500; // Records to fetch at a time
const UPDATE_BATCH_SIZE = 100; // Records to update at a time

// Concurrent requests - keep low to avoid rate limits
// Each record can make 2+ API calls, so effective rate is higher
const CONCURRENT_REQUESTS = 3;

// County code to borough name mapping (for GeoClient API)
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
// NYC GeoClient API
// ============================================================================

interface GeocodingResult {
  latitude: number;
  longitude: number;
  source: 'address' | 'intersection';
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Expand truncated street suffixes
 * NYC parking data often has truncated street names (20 char limit)
 */
function expandStreetSuffix(street: string): string {
  // Common truncations at end of street name (order matters - check longer patterns first)
  const expansions: [RegExp, string][] = [
    // Parkway variations
    [/\bPARKWA$/i, 'PARKWAY'],
    [/\bPKWAY$/i, 'PARKWAY'],
    [/\bPKWY$/i, 'PARKWAY'],
    [/\bPARKW$/i, 'PARKWAY'],
    [/\bPARK$/i, 'PARKWAY'],  // Only if preceded by space (handled by \b)
    [/\bPAR$/i, 'PARKWAY'],
    [/\bPA$/i, 'PARKWAY'],
    
    // Avenue variations  
    [/\bAVENU$/i, 'AVENUE'],
    [/\bAVEN$/i, 'AVENUE'],
    [/\bAVE$/i, 'AVENUE'],
    [/\sA$/i, ' AVENUE'],  // Single "A" at end after space = AVENUE (e.g., "POLITE A" → "POLITE AVENUE")
    
    // Boulevard variations
    [/\bBOULEVAR$/i, 'BOULEVARD'],
    [/\bBOULEVA$/i, 'BOULEVARD'],
    [/\bBOULEV$/i, 'BOULEVARD'],
    [/\bBOULE$/i, 'BOULEVARD'],
    [/\bBOUL$/i, 'BOULEVARD'],
    [/\bBLVD$/i, 'BOULEVARD'],
    
    // Road variations
    [/\bROA$/i, 'ROAD'],
    [/\bRD$/i, 'ROAD'],
    
    // Street variations
    [/\bSTREE$/i, 'STREET'],
    [/\bSTRE$/i, 'STREET'],
    [/\bST$/i, 'STREET'],
    
    // Drive variations
    [/\bDRIV$/i, 'DRIVE'],
    [/\bDRI$/i, 'DRIVE'],
    [/\bDR$/i, 'DRIVE'],
    
    // Place variations
    [/\bPLAC$/i, 'PLACE'],
    [/\bPLA$/i, 'PLACE'],
    [/\bPL$/i, 'PLACE'],
    
    // Lane variations
    [/\bLAN$/i, 'LANE'],
    [/\bLA$/i, 'LANE'],
    [/\bLN$/i, 'LANE'],
    
    // Court variations
    [/\bCOUR$/i, 'COURT'],
    [/\bCOU$/i, 'COURT'],
    [/\bCT$/i, 'COURT'],
    
    // Terrace variations
    [/\bTERRAC$/i, 'TERRACE'],
    [/\bTERRA$/i, 'TERRACE'],
    [/\bTERR$/i, 'TERRACE'],
    [/\bTER$/i, 'TERRACE'],
    
    // Expressway variations
    [/\bEXPRESSWA$/i, 'EXPRESSWAY'],
    [/\bEXPRESSW$/i, 'EXPRESSWAY'],
    [/\bEXPRESS$/i, 'EXPRESSWAY'],
    [/\bEXPRES$/i, 'EXPRESSWAY'],
    [/\bEXPRE$/i, 'EXPRESSWAY'],
    [/\bEXPR$/i, 'EXPRESSWAY'],
    [/\bEXPY$/i, 'EXPRESSWAY'],
    
    // Highway variations
    [/\bHIGHWA$/i, 'HIGHWAY'],
    [/\bHIGHW$/i, 'HIGHWAY'],
    [/\bHWY$/i, 'HIGHWAY'],
    
    // Circle variations
    [/\bCIRCL$/i, 'CIRCLE'],
    [/\bCIRC$/i, 'CIRCLE'],
    [/\bCIR$/i, 'CIRCLE'],
    
    // Concourse variations
    [/\bCONCOURS$/i, 'CONCOURSE'],
    [/\bCONCOUR$/i, 'CONCOURSE'],
    [/\bCONCOU$/i, 'CONCOURSE'],
    [/\bCONCO$/i, 'CONCOURSE'],
    
    // Directional variations (often truncated in intersections)
    [/\bSOUTHWES$/i, 'SOUTHWEST'],
    [/\bSOUTHWE$/i, 'SOUTHWEST'],
    [/\bSOUTHW$/i, 'SOUTHWEST'],
    [/\bNORTHWES$/i, 'NORTHWEST'],
    [/\bNORTHWE$/i, 'NORTHWEST'],
    [/\bNORTHW$/i, 'NORTHWEST'],
    [/\bSOUTHEAS$/i, 'SOUTHEAST'],
    [/\bSOUTHEA$/i, 'SOUTHEAST'],
    [/\bSOUTHE$/i, 'SOUTHEAST'],
    [/\bNORTHEAS$/i, 'NORTHEAST'],
    [/\bNORTHEA$/i, 'NORTHEAST'],
    [/\bNORTHE$/i, 'NORTHEAST'],
    
    // Bridge variations
    [/\bBRIDG$/i, 'BRIDGE'],
    [/\bBRI$/i, 'BRIDGE'],
    
    // Turnpike variations
    [/\bTURNPIK$/i, 'TURNPIKE'],
    [/\bTURNPI$/i, 'TURNPIKE'],
    [/\bTURNP$/i, 'TURNPIKE'],
    [/\bTPKE$/i, 'TURNPIKE'],
    
    // Plaza variations
    [/\bPLAZ$/i, 'PLAZA'],
    
    // Square variations
    [/\bSQUAR$/i, 'SQUARE'],
    [/\bSQUA$/i, 'SQUARE'],
    [/\bSQ$/i, 'SQUARE'],
  ];
  
  for (const [pattern, replacement] of expansions) {
    if (pattern.test(street)) {
      return street.replace(pattern, replacement);
    }
  }
  
  return street;
}

/**
 * Clean street name for geocoding
 */
function cleanStreetName(street: string): string {
  let cleaned = street
    .replace(/^I\/O\s+/i, '')   // Remove "I/O" prefix (in front of)
    .replace(/^O\/S\s+/i, '')   // Remove "O/S" prefix (opposite side)
    .replace(/^N\/O\s+/i, '')   // Remove "N/O" prefix (north of)
    .replace(/^S\/O\s+/i, '')   // Remove "S/O" prefix (south of)
    .replace(/^E\/O\s+/i, '')   // Remove "E/O" prefix (east of)
    .replace(/^W\/O\s+/i, '')   // Remove "W/O" prefix (west of)
    .replace(/^F\/O\s+/i, '')   // Remove "F/O" prefix (front of)
    .replace(/^ADJ\s+/i, '')    // Remove "ADJ" prefix (adjacent)
    .replace(/^OPP\s+/i, '')    // Remove "OPP" prefix (opposite)
    .replace(/^@\s*/i, '')      // Remove "@" prefix
    .replace(/\s+/g, ' ')       // Normalize whitespace
    .trim();
  
  // Expand truncated street suffixes
  cleaned = expandStreetSuffix(cleaned);
  
  return cleaned;
}

/**
 * Get borough name from county code
 */
function getBoroughFromCounty(county: string | null): string | null {
  if (!county) return null;
  return COUNTY_TO_BOROUGH[county.toUpperCase()] || null;
}

/**
 * Make authenticated request to NYC GeoClient API
 */
// Track if we've logged an error sample (to avoid spamming console)
let errorLogCount = 0;
const MAX_ERROR_LOGS = 5;

// Track failure reasons for debugging
interface FailureStats {
  total: number;
  reasons: Record<string, number>;
  samples: Array<{ input: string; reason: string }>;
}

const failureStats: FailureStats = {
  total: 0,
  reasons: {},
  samples: [],
};

const MAX_FAILURE_SAMPLES = 10;

function trackFailure(input: string, reason: string): void {
  failureStats.total++;
  failureStats.reasons[reason] = (failureStats.reasons[reason] || 0) + 1;
  
  if (failureStats.samples.length < MAX_FAILURE_SAMPLES) {
    failureStats.samples.push({ input, reason });
  }
}

function printFailureStats(): void {
  if (failureStats.total === 0) return;
  
  console.log('\n📊 Failure Analysis:');
  console.log(`   Total failures: ${failureStats.total.toLocaleString()}`);
  
  // Sort by count descending
  const sortedReasons = Object.entries(failureStats.reasons)
    .sort((a, b) => b[1] - a[1]);
  
  console.log('   Top failure reasons:');
  for (const [reason, count] of sortedReasons.slice(0, 10)) {
    const pct = ((count / failureStats.total) * 100).toFixed(1);
    console.log(`     - ${reason}: ${count.toLocaleString()} (${pct}%)`);
  }
  
  if (failureStats.samples.length > 0) {
    console.log('\n   Sample failed records:');
    for (const sample of failureStats.samples.slice(0, 5)) {
      console.log(`     - "${sample.input}" → ${sample.reason}`);
    }
  }
}

function resetFailureStats(): void {
  failureStats.total = 0;
  failureStats.reasons = {};
  failureStats.samples = [];
}

async function geoclientFetch(endpoint: string, params: Record<string, string>): Promise<unknown | null> {
  const searchParams = new URLSearchParams(params);
  const url = `${GEOCLIENT_BASE_URL}/${endpoint}.json?${searchParams}`;

  try {
    const response = await fetch(url, {
      headers: {
        'ocp-apim-subscription-key': NYC_GEOCLIENT_KEY!,
      },
    });
    
    if (!response.ok) {
      if (response.status === 429) {
        // Rate limited - wait longer and don't spam logs
        await sleep(5000);
        return null;
      }
      if (errorLogCount < MAX_ERROR_LOGS) {
        const text = await response.text();
        console.error(`\n❌ API Error (${response.status}): ${text.slice(0, 500)}`);
        console.error(`   URL: ${url}`);
        errorLogCount++;
      }
      return null;
    }

    const data = await response.json();
    // Messages from API are usually informational, not errors
    // We check for valid lat/lon regardless of messages
    return data;
  } catch (err) {
    if (errorLogCount < MAX_ERROR_LOGS) {
      console.error(`\n❌ Fetch error: ${err}`);
      errorLogCount++;
    }
    return null;
  }
}

/**
 * Geocode using intersection endpoint (street1 & street2)
 */
async function geocodeIntersection(
  street1: string,
  street2: string,
  borough: string
): Promise<GeocodingResult | null> {
  const inputDesc = `${street1} & ${street2}, ${borough}`;
  
  const data = await geoclientFetch('intersection', {
    crossStreetOne: street1,
    crossStreetTwo: street2,
    borough: borough,
  }) as { intersection?: { latitude?: number; longitude?: number; message?: string; message2?: string } } | null;

  if (!data) {
    trackFailure(inputDesc, 'API_ERROR');
    return null;
  }
  
  const result = data.intersection;
  if (!result) {
    trackFailure(inputDesc, 'NO_INTERSECTION_RESULT');
    return null;
  }

  // Check for valid coordinates (API may return message AND valid coords)
  const lat = result.latitude;
  const lon = result.longitude;

  if (typeof lat === 'number' && typeof lon === 'number' && !isNaN(lat) && !isNaN(lon)) {
    return {
      latitude: lat,
      longitude: lon,
      source: 'intersection',
    };
  }

  // Track the specific failure reason from the API
  const reason = result.message || result.message2 || 'NO_COORDINATES';
  trackFailure(inputDesc, reason);
  return null;
}

/**
 * Geocode using address endpoint (house number + street)
 */
async function geocodeAddress(
  houseNumber: string,
  street: string,
  borough: string
): Promise<GeocodingResult | null> {
  const inputDesc = `${houseNumber} ${street}, ${borough}`;
  
  const data = await geoclientFetch('address', {
    houseNumber: houseNumber,
    street: street,
    borough: borough,
  }) as { address?: { latitude?: number; longitude?: number; message?: string; message2?: string } } | null;

  if (!data) {
    trackFailure(inputDesc, 'API_ERROR');
    return null;
  }
  
  const result = data.address;
  if (!result) {
    trackFailure(inputDesc, 'NO_ADDRESS_RESULT');
    return null;
  }

  // Check for valid coordinates (API may return message AND valid coords)
  const lat = result.latitude;
  const lon = result.longitude;

  if (typeof lat === 'number' && typeof lon === 'number' && !isNaN(lat) && !isNaN(lon)) {
    return {
      latitude: lat,
      longitude: lon,
      source: 'address',
    };
  }

  // Track the specific failure reason from the API
  const reason = result.message || result.message2 || 'NO_COORDINATES';
  trackFailure(inputDesc, reason);
  return null;
}

/**
 * Geocode using street stretch (segment of a street)
 */
async function geocodeStreetStretch(
  onStreet: string,
  crossStreet1: string,
  crossStreet2: string,
  borough: string
): Promise<GeocodingResult | null> {
  const data = await geoclientFetch('streetSegment', {
    onStreet: onStreet,
    crossStreetOne: crossStreet1,
    crossStreetTwo: crossStreet2,
    borough: borough,
  }) as { streetSegment?: { 
    fromLatitude?: string; 
    fromLongitude?: string; 
    toLatitude?: string; 
    toLongitude?: string; 
    message?: string 
  } } | null;

  if (!data) return null;
  
  const result = data.streetSegment;
  if (!result || result.message) {
    return null;
  }

  // Use the midpoint of from/to coordinates
  const fromLat = parseFloat(result.fromLatitude || '');
  const fromLon = parseFloat(result.fromLongitude || '');
  const toLat = parseFloat(result.toLatitude || '');
  const toLon = parseFloat(result.toLongitude || '');

  if (!isNaN(fromLat) && !isNaN(fromLon) && !isNaN(toLat) && !isNaN(toLon)) {
    return {
      latitude: (fromLat + toLat) / 2,
      longitude: (fromLon + toLon) / 2,
      source: 'address',
    };
  }

  return null;
}

/**
 * Geocode a single parking ticket record
 * Tries multiple strategies: 1) address with house_number, 2) intersection, 3) parse house from street
 */
async function geocodeRecord(
  houseNumber: string | null,
  streetName: string,
  intersectingStreet: string | null,
  county: string | null
): Promise<GeocodingResult | null> {
  const borough = getBoroughFromCounty(county);
  if (!borough) {
    return null;
  }

  const cleanedStreet = cleanStreetName(streetName);
  const cleanedIntersecting = intersectingStreet ? cleanStreetName(intersectingStreet) : null;

  // Strategy 1: If we have a house_number, use address geocoding (most accurate)
  if (houseNumber && houseNumber.trim()) {
    const result = await geocodeAddress(houseNumber.trim(), cleanedStreet, borough);
    if (result) {
      return result;
    }
  }

  // Strategy 2: If we have an intersecting street, use intersection geocoding
  if (cleanedIntersecting && cleanedIntersecting.length > 0) {
    const result = await geocodeIntersection(cleanedStreet, cleanedIntersecting, borough);
    if (result) {
      return result;
    }
  }

  // Strategy 3: Try to parse house number from street name (e.g., "123 MAIN ST")
  const addressMatch = cleanedStreet.match(/^(\d+[-\d]*)\s+(.+)$/);
  if (addressMatch) {
    const parsedHouseNumber = addressMatch[1];
    const streetOnly = addressMatch[2];
    const result = await geocodeAddress(parsedHouseNumber, streetOnly, borough);
    if (result) {
      return result;
    }
  }

  // No fallback - only geocode when we have accurate data
  return null;
}

// ============================================================================
// Database Operations
// ============================================================================

interface TicketToGeocode {
  summons_number: string;
  house_number: string | null;
  street_name: string;
  intersecting_street: string | null;
  county: string | null;
}

/**
 * Get records that need geocoding
 * Prioritizes: 1) records with house_number (most accurate), 2) records with intersecting_street
 */
async function getRecordsToGeocode(limit: number, offset: number = 0, requireHouseNumber: boolean = false): Promise<TicketToGeocode[]> {
  const db = getPool();
  
  // Build WHERE clause based on whether we require house_number
  const houseNumberCondition = requireHouseNumber 
    ? "AND house_number IS NOT NULL AND house_number != ''"
    : '';
  
  const result = await db.query<TicketToGeocode>(
    `SELECT summons_number, house_number, street_name, intersecting_street, county
     FROM parking_ticket
     WHERE geom IS NULL
       AND street_name IS NOT NULL
       AND street_name != ''
       AND county IS NOT NULL
       ${houseNumberCondition}
     ORDER BY 
       (CASE WHEN house_number IS NOT NULL AND house_number != '' THEN 0 ELSE 1 END),
       (CASE WHEN intersecting_street IS NOT NULL AND intersecting_street != '' THEN 0 ELSE 1 END),
       issue_date DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return result.rows;
}

/**
 * Batch update multiple records with geocoded coordinates
 */
async function batchUpdateGeom(
  updates: Array<{ summons_number: string; latitude: number; longitude: number }>
): Promise<number> {
  if (updates.length === 0) return 0;

  const db = getPool();
  
  // Build a batch update using a VALUES clause
  const values: unknown[] = [];
  const valueRows: string[] = [];
  
  updates.forEach((update, i) => {
    const offset = i * 3;
    valueRows.push(`($${offset + 1}, $${offset + 2}::float, $${offset + 3}::float)`);
    values.push(update.summons_number, update.longitude, update.latitude);
  });

  const query = `
    UPDATE parking_ticket AS pt
    SET geom = ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326)::geography
    FROM (VALUES ${valueRows.join(', ')}) AS v(summons_number, lon, lat)
    WHERE pt.summons_number = v.summons_number
  `;

  const result = await db.query(query, values);
  return result.rowCount || 0;
}

/**
 * Get geocoding statistics
 */
async function getGeocodingStats(): Promise<{
  total: number;
  geocoded: number;
  needsGeocoding: number;
  hasStreetName: number;
  noStreetName: number;
  hasCounty: number;
  hasHouseNumber: number;
  needsGeocodingWithHouseNumber: number;
}> {
  const db = getPool();

  const [totalResult, geocodedResult, hasStreetResult, hasCountyResult, hasHouseNumberResult, needsWithHouseResult] = await Promise.all([
    db.query('SELECT COUNT(*) as count FROM parking_ticket'),
    db.query('SELECT COUNT(*) as count FROM parking_ticket WHERE geom IS NOT NULL'),
    db.query("SELECT COUNT(*) as count FROM parking_ticket WHERE street_name IS NOT NULL AND street_name != ''"),
    db.query("SELECT COUNT(*) as count FROM parking_ticket WHERE street_name IS NOT NULL AND street_name != '' AND county IS NOT NULL"),
    db.query("SELECT COUNT(*) as count FROM parking_ticket WHERE house_number IS NOT NULL AND house_number != ''"),
    db.query("SELECT COUNT(*) as count FROM parking_ticket WHERE house_number IS NOT NULL AND house_number != '' AND street_name IS NOT NULL AND county IS NOT NULL AND geom IS NULL"),
  ]);

  const total = parseInt(totalResult.rows[0].count);
  const geocoded = parseInt(geocodedResult.rows[0].count);
  const hasStreetName = parseInt(hasStreetResult.rows[0].count);
  const hasCounty = parseInt(hasCountyResult.rows[0].count);
  const hasHouseNumber = parseInt(hasHouseNumberResult.rows[0].count);
  const needsGeocodingWithHouseNumber = parseInt(needsWithHouseResult.rows[0].count);

  return {
    total,
    geocoded,
    needsGeocoding: hasCounty - geocoded,
    hasStreetName,
    noStreetName: total - hasStreetName,
    hasCounty,
    hasHouseNumber,
    needsGeocodingWithHouseNumber,
  };
}

// ============================================================================
// Concurrent Processing
// ============================================================================

/**
 * Process records with concurrency control
 */
async function processRecordsConcurrently(
  records: TicketToGeocode[],
  dryRun: boolean,
  onProgress: (succeeded: number, failed: number) => void
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  const updates: Array<{ summons_number: string; latitude: number; longitude: number }> = [];
  
  // Process in chunks with concurrency
  for (let i = 0; i < records.length; i += CONCURRENT_REQUESTS) {
    const chunk = records.slice(i, i + CONCURRENT_REQUESTS);
    
    const results = await Promise.all(
      chunk.map(async (record) => {
        const result = await geocodeRecord(
          record.house_number,
          record.street_name,
          record.intersecting_street,
          record.county
        );
        return { record, result };
      })
    );

    for (const { record, result } of results) {
      if (result) {
        updates.push({
          summons_number: record.summons_number,
          latitude: result.latitude,
          longitude: result.longitude,
        });
        succeeded++;
      } else {
        failed++;
      }
    }

    // Batch update when we have enough
    if (updates.length >= UPDATE_BATCH_SIZE) {
      if (!dryRun) {
        await batchUpdateGeom(updates);
      }
      updates.length = 0;
    }

    // Delay between concurrent batches to avoid rate limits
    await sleep(500);
    
    onProgress(succeeded, failed);
  }

  // Update remaining records
  if (updates.length > 0 && !dryRun) {
    await batchUpdateGeom(updates);
  }

  return { succeeded, failed };
}

// ============================================================================
// Main Geocoding Process
// ============================================================================

interface GeocodingOptions {
  limit?: number;
  dryRun?: boolean;
  houseNumberOnly?: boolean;  // Only geocode records with house_number
}

/**
 * Format duration in human readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Run the geocoding process
 */
async function runGeocoding(options: GeocodingOptions = {}): Promise<void> {
  const { limit = Infinity, dryRun = false, houseNumberOnly = false } = options;

  console.log('\n' + '='.repeat(60));
  console.log('NYC Parking Ticket Geocoder (NYC GeoClient API)');
  console.log('='.repeat(60));
  
  // Reset failure tracking for this run
  resetFailureStats();
  
  if (dryRun) {
    console.log('MODE: DRY RUN (no database updates)');
  }
  
  if (houseNumberOnly) {
    console.log('FILTER: Only records with house_number');
  }
  
  if (limit !== Infinity) {
    console.log(`LIMIT: ${limit.toLocaleString()} records`);
  }
  
  console.log(`CONCURRENCY: ${CONCURRENT_REQUESTS} parallel requests`);
  console.log('='.repeat(60) + '\n');

  // Get initial stats
  const stats = await getGeocodingStats();
  console.log('Current Status:');
  console.log(`  Total records: ${stats.total.toLocaleString()}`);
  console.log(`  Already geocoded: ${stats.geocoded.toLocaleString()}`);
  console.log(`  With house_number: ${stats.hasHouseNumber.toLocaleString()}`);
  console.log(`  With street + county (geocodable): ${stats.hasCounty.toLocaleString()}`);
  console.log(`  Without street name: ${stats.noStreetName.toLocaleString()}`);
  console.log(`  Needs geocoding (all): ${stats.needsGeocoding.toLocaleString()}`);
  console.log(`  Needs geocoding (with house_number): ${stats.needsGeocodingWithHouseNumber.toLocaleString()}`);
  
  // Determine how many to process based on mode
  const needsProcessing = houseNumberOnly ? stats.needsGeocodingWithHouseNumber : stats.needsGeocoding;
  
  if (needsProcessing === 0) {
    console.log('\n✅ All geocodable records are already geocoded!');
    return;
  }

  const toProcess = Math.min(limit, needsProcessing);
  const estimatedMinutes = Math.ceil(toProcess / (REQUESTS_PER_SECOND * CONCURRENT_REQUESTS) / 60);
  console.log(`\nWill process: ${toProcess.toLocaleString()} records`);
  console.log(`Estimated time: ~${estimatedMinutes} minutes`);
  console.log('\nStarting geocoding...\n');

  const startTime = Date.now();
  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let lastLogTime = Date.now();

  // Process in batches
  while (totalProcessed < toProcess) {
    const batchLimit = Math.min(FETCH_BATCH_SIZE, toProcess - totalProcessed);
    const records = await getRecordsToGeocode(batchLimit, 0, houseNumberOnly);
    
    if (records.length === 0) {
      break;
    }

    const { succeeded, failed } = await processRecordsConcurrently(
      records,
      dryRun,
      (s, f) => {
        const now = Date.now();
        if (now - lastLogTime > 5000) {
          const processed = totalProcessed + s + f;
          const elapsed = formatDuration(now - startTime);
          const rate = Math.round(processed / ((now - startTime) / 1000));
          const remaining = toProcess - processed;
          const etaSeconds = remaining / Math.max(rate, 1);
          const eta = formatDuration(etaSeconds * 1000);
          
          console.log(
            `Progress: ${processed.toLocaleString()}/${toProcess.toLocaleString()} | ` +
            `✓ ${(totalSucceeded + s).toLocaleString()} | ✗ ${(totalFailed + f).toLocaleString()} | ` +
            `${rate}/sec | ${elapsed} elapsed | ETA: ${eta}`
          );
          lastLogTime = now;
        }
      }
    );

    totalProcessed += records.length;
    totalSucceeded += succeeded;
    totalFailed += failed;
  }

  const totalTime = formatDuration(Date.now() - startTime);
  const successRate = totalProcessed > 0 ? ((totalSucceeded / totalProcessed) * 100).toFixed(1) : '0';

  console.log('\n' + '='.repeat(60));
  console.log('Geocoding Complete!');
  console.log('='.repeat(60));
  console.log(`Total processed: ${totalProcessed.toLocaleString()}`);
  console.log(`Successfully geocoded: ${totalSucceeded.toLocaleString()} (${successRate}%)`);
  console.log(`Failed: ${totalFailed.toLocaleString()}`);
  console.log(`Time elapsed: ${totalTime}`);
  
  // Print failure analysis
  printFailureStats();
  console.log('='.repeat(60) + '\n');

  // Show updated stats
  if (!dryRun) {
    const finalStats = await getGeocodingStats();
    console.log('Final Status:');
    console.log(`  Total geocoded: ${finalStats.geocoded.toLocaleString()}`);
    console.log(`  Remaining to geocode: ${finalStats.needsGeocoding.toLocaleString()}`);
  }
}

/**
 * Show geocoding statistics
 */
async function showStats(): Promise<void> {
  console.log('\n=== Geocoding Statistics ===\n');

  const stats = await getGeocodingStats();
  const geocodedPercent = stats.total > 0 
    ? ((stats.geocoded / stats.total) * 100).toFixed(1) 
    : '0';
  const geocodablePercent = stats.hasCounty > 0 
    ? ((stats.geocoded / stats.hasCounty) * 100).toFixed(1) 
    : '0';

  console.log(`Total records: ${stats.total.toLocaleString()}`);
  console.log(`\nGeocoding Status:`);
  console.log(`  ✓ Geocoded: ${stats.geocoded.toLocaleString()} (${geocodedPercent}% of total)`);
  console.log(`  ○ Needs geocoding (all): ${stats.needsGeocoding.toLocaleString()}`);
  console.log(`  ○ Needs geocoding (with house_number): ${stats.needsGeocodingWithHouseNumber.toLocaleString()}`);
  console.log(`  ✗ No street name: ${stats.noStreetName.toLocaleString()}`);
  console.log(`\nAddress Data:`);
  console.log(`  ○ With house_number: ${stats.hasHouseNumber.toLocaleString()}`);
  console.log(`  ○ With street + county: ${stats.hasCounty.toLocaleString()}`);
  console.log(`\nOf geocodable records: ${geocodablePercent}% complete`);

  // Estimate time to complete
  if (stats.needsGeocoding > 0) {
    const ratePerSecond = REQUESTS_PER_SECOND * CONCURRENT_REQUESTS;
    const estimatedSeconds = stats.needsGeocoding / ratePerSecond;
    console.log(`\nEstimated time to geocode all remaining: ${formatDuration(estimatedSeconds * 1000)}`);
    
    if (stats.needsGeocodingWithHouseNumber > 0) {
      const estimatedHouseSeconds = stats.needsGeocodingWithHouseNumber / ratePerSecond;
      console.log(`Estimated time for house_number only: ${formatDuration(estimatedHouseSeconds * 1000)}`);
    }
  }
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
NYC Parking Ticket Geocoder (NYC GeoClient API)

Usage:
  npx tsx scripts/geocode.ts [options]

Options:
  --limit=N           Limit geocoding to N records (default: all)
  --dry-run           Preview without updating database
  --stats             Show geocoding statistics only
  --house-number-only Only geocode records with house_number (uses /address API)

Examples:
  npx tsx scripts/geocode.ts --stats                      # Check current status
  npx tsx scripts/geocode.ts --limit=1000                 # Geocode 1000 records
  npx tsx scripts/geocode.ts --house-number-only          # Only records with house_number
  npx tsx scripts/geocode.ts --house-number-only --limit=500  # Combine options
  npx tsx scripts/geocode.ts --dry-run                    # Preview without saving
  npx tsx scripts/geocode.ts                              # Geocode all remaining records

Environment Variables Required:
  NYC_GEOCLIENT_KEY  - Primary or Secondary key from NYC API Portal
  DATABASE_URL       - PostgreSQL connection string

Get your API key at: https://api-portal.nyc.gov/
  1. Sign up / Sign in
  2. Subscribe to "NYC GeoClient" API
  3. Copy your Primary or Secondary key

Notes:
  - Uses NYC GeoClient API (FREE, unlimited requests)
  - Processes ${CONCURRENT_REQUESTS} requests concurrently
  - Prioritizes: 1) house_number + street (address API), 2) intersection
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Check for required environment variables
  if (!NYC_GEOCLIENT_KEY) {
    console.error('Error: NYC GeoClient API key required');
    console.error('');
    console.error('Add to your .env.local file:');
    console.error('  NYC_GEOCLIENT_KEY=your_primary_or_secondary_key');
    console.error('');
    console.error('Get your key at: https://api-portal.nyc.gov/');
    console.error('  1. Sign up / Sign in');
    console.error('  2. Subscribe to "NYC GeoClient" API');
    console.error('  3. Copy your Primary or Secondary key');
    process.exit(1);
  }

  if (!DATABASE_URL) {
    console.error('Error: DATABASE_URL is required');
    process.exit(1);
  }

  // Parse arguments
  const showHelp = args.includes('--help') || args.includes('-h');
  const showStatsOnly = args.includes('--stats');
  const dryRun = args.includes('--dry-run');
  const houseNumberOnly = args.includes('--house-number-only');
  
  let limit = Infinity;
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  if (limitArg) {
    limit = parseInt(limitArg.split('=')[1], 10);
    if (isNaN(limit) || limit <= 0) {
      console.error('Error: --limit must be a positive number');
      process.exit(1);
    }
  }

  if (showHelp) {
    printUsage();
    process.exit(0);
  }

  try {
    if (showStatsOnly) {
      await showStats();
    } else {
      await runGeocoding({ limit, dryRun, houseNumberOnly });
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
