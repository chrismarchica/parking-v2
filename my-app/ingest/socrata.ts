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

/**
 * Build Socrata API URL for backfill (ordered by :id)
 */
export function buildBackfillUrl(
  datasetId: DatasetId,
  offset: number,
  limit = PAGE_SIZE
): string {
  const fields = DATASET_FIELDS[datasetId];
  const selectClause = fields.join(',');

  const params = new URLSearchParams({
    $select: selectClause,
    $order: ':id ASC',
    $limit: limit.toString(),
    $offset: offset.toString(),
  });

  return `${SOCRATA_BASE_URL}/${datasetId}.json?${params.toString()}`;
}

/**
 * Build Socrata API URL for incremental sync (ordered by :updated_at)
 */
export function buildIncrementalUrl(
  datasetId: DatasetId,
  cursor: string,
  offset: number,
  limit = PAGE_SIZE
): string {
  const fields = DATASET_FIELDS[datasetId];
  const selectClause = fields.join(',');

  const params = new URLSearchParams({
    $select: selectClause,
    $where: `:updated_at > '${cursor}'`,
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
 * Generator for paginated backfill
 */
export async function* backfillPages(
  datasetId: DatasetId
): AsyncGenerator<Record<string, unknown>[], void, unknown> {
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = buildBackfillUrl(datasetId, offset);
    console.log(`Fetching backfill page: offset=${offset}`);

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

  console.log(`Backfill complete: ${offset} total rows fetched`);
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

