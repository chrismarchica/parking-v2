/**
 * Ingestion configuration for NYC Open Data parking ticket datasets
 */

export const SOCRATA_BASE_URL = 'https://data.cityofnewyork.us/resource';

// Dataset IDs
export const DATASETS = {
  // Parking Violations Issued – Fiscal Year 2024
  FY2024: 'pvqr-7yc4',
  // Open Parking and Camera Violations
  OPEN_VIOLATIONS: 'nc67-uf89',
} as const;

export type DatasetId = typeof DATASETS[keyof typeof DATASETS];

// Pagination and rate limiting
export const PAGE_SIZE = 1000;
export const BATCH_INSERT_SIZE = 500;
export const DELAY_BETWEEN_PAGES_MS = 100;
export const MAX_RETRIES = 5;
export const INITIAL_BACKOFF_MS = 1000;

// Field selections for each dataset (including system fields)
export const DATASET_FIELDS: Record<DatasetId, string[]> = {
  'pvqr-7yc4': [
    ':id',
    ':created_at',
    ':updated_at',
    'summons_number',
    'issue_date',
    'violation_time',
    'violation_code',
    'issuing_agency',
    'violation_county',
    'violation_precinct',
    'street_name',
    'intersecting_street',
    'plate_id',
    'registration_state',
    'plate_type',
  ],
  'nc67-uf89': [
    ':id',
    ':created_at',
    ':updated_at',
    'summons_number',
    'issue_date',
    'violation_time',
    'violation',
    'issuing_agency',
    'county',
    'precinct',
    'plate',
    'state',
    'license_type',
    'fine_amount',
  ],
};

// Field mapping from Socrata to parking_ticket table
export interface ParkingTicketRow {
  summons_number: string;
  source_dataset: string;
  issue_date: string | null;
  violation_time: string | null;
  violation_code: string | null;
  violation_desc: string | null;
  issuing_agency: string | null;
  county: string | null;
  precinct: string | null;
  street_name: string | null;
  intersecting_street: string | null;
  fine_amount: number | null;
  plate_id: string | null;
  registration_state: string | null;
  plate_type: string | null;
  soda_row_id: string;
  soda_created_at: string;
  soda_updated_at: string;
}

/**
 * Map raw Socrata row to parking_ticket table row
 */
export function mapToTicketRow(
  datasetId: DatasetId,
  raw: Record<string, unknown>
): ParkingTicketRow | null {
  const summonsNumber = raw.summons_number as string | undefined;
  if (!summonsNumber) {
    return null; // Skip rows without summons_number
  }

  const sodaRowId = raw[':id'] as string;
  const sodaCreatedAt = raw[':created_at'] as string;
  const sodaUpdatedAt = raw[':updated_at'] as string;

  if (datasetId === 'pvqr-7yc4') {
    return {
      summons_number: summonsNumber,
      source_dataset: datasetId,
      issue_date: parseDate(raw.issue_date as string | undefined),
      violation_time: (raw.violation_time as string) || null,
      violation_code: (raw.violation_code as string) || null,
      violation_desc: null, // Not available in this dataset
      issuing_agency: (raw.issuing_agency as string) || null,
      county: (raw.violation_county as string) || null,
      precinct: (raw.violation_precinct as string) || null,
      street_name: (raw.street_name as string) || null,
      intersecting_street: (raw.intersecting_street as string) || null,
      fine_amount: null, // Not always present in this dataset
      plate_id: (raw.plate_id as string) || null,
      registration_state: (raw.registration_state as string) || null,
      plate_type: (raw.plate_type as string) || null,
      soda_row_id: sodaRowId,
      soda_created_at: sodaCreatedAt,
      soda_updated_at: sodaUpdatedAt,
    };
  } else if (datasetId === 'nc67-uf89') {
    return {
      summons_number: summonsNumber,
      source_dataset: datasetId,
      issue_date: parseDate(raw.issue_date as string | undefined),
      violation_time: (raw.violation_time as string) || null,
      violation_code: null, // Not in this dataset
      violation_desc: (raw.violation as string) || null,
      issuing_agency: (raw.issuing_agency as string) || null,
      county: (raw.county as string) || null,
      precinct: (raw.precinct as string) || null,
      street_name: null, // Not in this dataset
      intersecting_street: null, // Not in this dataset
      fine_amount: parseNumeric(raw.fine_amount),
      plate_id: (raw.plate as string) || null,
      registration_state: (raw.state as string) || null,
      plate_type: (raw.license_type as string) || null,
      soda_row_id: sodaRowId,
      soda_created_at: sodaCreatedAt,
      soda_updated_at: sodaUpdatedAt,
    };
  }

  return null;
}

/**
 * Parse date string to YYYY-MM-DD format
 */
function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  try {
    // Socrata dates can be in various formats
    const date = new Date(value);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

/**
 * Parse numeric value
 */
function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return isNaN(num) ? null : num;
}

