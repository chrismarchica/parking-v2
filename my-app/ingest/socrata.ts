/**
 * Socrata SODA API client with retry logic and rate limiting
 */

import {
  SOCRATA_BASE_URL,
  DATASET_FIELDS,
  PAGE_SIZE,
  DELAY_BETWEEN_PAGES_MS,
  MAX_RETRIES,
  INITIAL_BACKOFF_MS,
  type DatasetId,
} from './config';

const APP_TOKEN = process.env.NYC_OPEN_DATA_APP_TOKEN;

if (!APP_TOKEN) {
  console.warn(
    'Warning: NYC_OPEN_DATA_APP_TOKEN not set. Requests may be rate-limited.'
  );
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with exponential backoff retry
 */
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

      // Handle rate limiting and server errors
      if (response.status === 429 || response.status >= 500) {
        if (attempt < retries) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : backoff;
          console.log(
            `Request failed with ${response.status}, retrying in ${waitTime}ms (attempt ${attempt + 1}/${retries})`
          );
          await sleep(waitTime);
          backoff *= 2; // Exponential backoff
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
        console.log(
          `Request error: ${lastError.message}, retrying in ${backoff}ms (attempt ${attempt + 1}/${retries})`
        );
        await sleep(backoff);
        backoff *= 2;
      }
    }
  }

  throw lastError || new Error('Request failed after retries');
}

export interface BackfillOptions {
  startDate?: string;  // YYYY-MM-DD
  endDate?: string;    // YYYY-MM-DD
  maxRows?: number;    // Stop after this many rows
}

// Violations to EXCLUDE (camera-based, not parking tickets)
// For nc67-uf89 (Open Violations) - filter by violation description
const EXCLUDED_VIOLATIONS_NC67 = [
  'MOBILE BUS LANE VIOLATION',
  'WEIGH IN MOTION VIOLATION',
];

// For pvqr-7yc4 (FY2024) - filter by violation code
// 36 = Speed Camera, 71 = Red Light Camera
const EXCLUDED_CODES_PVQR = ['36', '71'];

/**
 * Build violation exclusion WHERE clause based on dataset
 */
function getViolationExclusionClause(datasetId: DatasetId): string | null {
  if (datasetId === 'nc67-uf89') {
    // Exclude by violation description
    const excluded = EXCLUDED_VIOLATIONS_NC67.map(v => `'${v}'`).join(',');
    return `violation NOT IN (${excluded})`;
  } else if (datasetId === 'pvqr-7yc4') {
    // Exclude by violation code
    const excluded = EXCLUDED_CODES_PVQR.map(v => `'${v}'`).join(',');
    return `violation_code NOT IN (${excluded})`;
  }
  return null;
}

/**
 * Build Socrata API URL for backfill with optional date filtering
 * Automatically excludes camera-based violations (bus lane, speed, red light)
 */
export function buildBackfillUrl(
  datasetId: DatasetId,
  offset: number,
  options: BackfillOptions = {},
  limit = PAGE_SIZE
): string {
  const fields = DATASET_FIELDS[datasetId];
  const selectClause = fields.join(',');

  // Build WHERE clause for date filtering and violation exclusions
  const whereConditions: string[] = [];
  
  if (options.startDate) {
    whereConditions.push(`issue_date >= '${options.startDate}'`);
  }
  if (options.endDate) {
    whereConditions.push(`issue_date <= '${options.endDate}'`);
  }
  
  // Add violation type exclusions (no bus lane, camera violations)
  const exclusionClause = getViolationExclusionClause(datasetId);
  if (exclusionClause) {
    whereConditions.push(exclusionClause);
  }

  const params = new URLSearchParams({
    $select: selectClause,
    $order: ':id ASC',
    $limit: limit.toString(),
    $offset: offset.toString(),
  });

  if (whereConditions.length > 0) {
    params.set('$where', whereConditions.join(' AND '));
  }

  return `${SOCRATA_BASE_URL}/${datasetId}.json?${params.toString()}`;
}

/**
 * Build Socrata API URL for incremental sync (ordered by :updated_at)
 * Automatically excludes camera-based violations
 */
export function buildIncrementalUrl(
  datasetId: DatasetId,
  cursor: string,
  offset: number,
  limit = PAGE_SIZE
): string {
  const fields = DATASET_FIELDS[datasetId];
  const selectClause = fields.join(',');

  // Build WHERE clause with cursor and violation exclusions
  const whereConditions: string[] = [`:updated_at > '${cursor}'`];
  
  const exclusionClause = getViolationExclusionClause(datasetId);
  if (exclusionClause) {
    whereConditions.push(exclusionClause);
  }

  const params = new URLSearchParams({
    $select: selectClause,
    $where: whereConditions.join(' AND '),
    $order: ':updated_at ASC',
    $limit: limit.toString(),
    $offset: offset.toString(),
  });

  return `${SOCRATA_BASE_URL}/${datasetId}.json?${params.toString()}`;
}

/**
 * Fetch a page of data from Socrata
 */
export async function fetchPage(url: string): Promise<Record<string, unknown>[]> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (APP_TOKEN) {
    headers['X-App-Token'] = APP_TOKEN;
  }

  const response = await fetchWithRetry(url, { headers });
  const data = await response.json();

  return data as Record<string, unknown>[];
}

/**
 * Get count of records matching the query (excluding camera violations)
 */
export async function getRecordCount(
  datasetId: DatasetId,
  options: BackfillOptions = {}
): Promise<number> {
  const whereConditions: string[] = [];
  if (options.startDate) {
    whereConditions.push(`issue_date >= '${options.startDate}'`);
  }
  if (options.endDate) {
    whereConditions.push(`issue_date <= '${options.endDate}'`);
  }
  
  // Add violation type exclusions
  const exclusionClause = getViolationExclusionClause(datasetId);
  if (exclusionClause) {
    whereConditions.push(exclusionClause);
  }

  const params = new URLSearchParams({
    $select: 'count(*)',
  });

  if (whereConditions.length > 0) {
    params.set('$where', whereConditions.join(' AND '));
  }

  const url = `${SOCRATA_BASE_URL}/${datasetId}.json?${params.toString()}`;
  
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (APP_TOKEN) {
    headers['X-App-Token'] = APP_TOKEN;
  }

  const response = await fetchWithRetry(url, { headers });
  const data = await response.json() as Array<{ count: string }>;
  
  return parseInt(data[0]?.count || '0', 10);
}

/**
 * Generator for paginated backfill with date filtering
 */
export async function* backfillPages(
  datasetId: DatasetId,
  options: BackfillOptions = {}
): AsyncGenerator<Record<string, unknown>[], void, unknown> {
  let offset = 0;
  let hasMore = true;
  const maxRows = options.maxRows || Infinity;

  while (hasMore && offset < maxRows) {
    const url = buildBackfillUrl(datasetId, offset, options);
    console.log(`Fetching backfill page: offset=${offset.toLocaleString()}`);

    const page = await fetchPage(url);

    if (page.length === 0) {
      hasMore = false;
    } else {
      yield page;
      offset += page.length;

      // Check if we've hit the max rows limit
      if (offset >= maxRows) {
        console.log(`Reached max rows limit: ${maxRows.toLocaleString()}`);
        hasMore = false;
      } else if (page.length === PAGE_SIZE) {
        // Polite delay between pages
        await sleep(DELAY_BETWEEN_PAGES_MS);
      } else {
        hasMore = false;
      }
    }
  }

  console.log(`Backfill complete: ${offset.toLocaleString()} total rows fetched`);
}

/**
 * Generator for paginated incremental sync
 */
export async function* incrementalPages(
  datasetId: DatasetId,
  cursor: string
): AsyncGenerator<Record<string, unknown>[], void, unknown> {
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = buildIncrementalUrl(datasetId, cursor, offset);
    console.log(`Fetching incremental page: cursor=${cursor}, offset=${offset}`);

    const page = await fetchPage(url);

    if (page.length === 0) {
      hasMore = false;
    } else {
      yield page;
      offset += page.length;

      // Polite delay between pages
      if (page.length === PAGE_SIZE) {
        await sleep(DELAY_BETWEEN_PAGES_MS);
      } else {
        hasMore = false;
      }
    }
  }

  console.log(`Incremental sync complete: ${offset} total rows fetched`);
}
