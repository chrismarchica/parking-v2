/**
 * Ingestion configuration for NYC Open Data parking ticket datasets
 */

export const SOCRATA_BASE_URL = 'https://data.cityofnewyork.us/resource';

// Dataset IDs
// Parking Violations Issued datasets have address data (house_number, street_name)
// Open Violations dataset has fine_amount but no addresses
export const DATASETS = {
  // Parking Violations Issued – Fiscal Year datasets (have addresses)
  FY2024: 'pvqr-7yc4',
  FY2023: 'pvda-ns3a',
  FY2022: '869v-vr48',
  FY2021: 'p7t3-5i9s',
  FY2020: 'jt7v-77mi',
  FY2019: 'faiq-9dfq',
  FY2018: '9wgk-ev5c',
  FY2017: '2bnn-yakx',
  // Open Parking and Camera Violations (no addresses, but has fine_amount)
  OPEN_VIOLATIONS: 'nc67-uf89',
} as const;

export type DatasetId = typeof DATASETS[keyof typeof DATASETS];

// Datasets that have address fields (house_number, street_name)
export const DATASETS_WITH_ADDRESSES: DatasetId[] = [
  'pvqr-7yc4', 'pvda-ns3a', '869v-vr48', 'p7t3-5i9s',
  'jt7v-77mi', 'faiq-9dfq', '9wgk-ev5c', '2bnn-yakx',
];

// Pagination and rate limiting
export const PAGE_SIZE = 1000;
export const BATCH_INSERT_SIZE = 500;
export const DELAY_BETWEEN_PAGES_MS = 100;
export const MAX_RETRIES = 5;
export const INITIAL_BACKOFF_MS = 1000;

// Common fields for Parking Violations Issued datasets (FY2017-2024)
const FY_DATASET_FIELDS = [
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
  'house_number',
  'street_name',
  'intersecting_street',
  'plate_id',
  'registration_state',
  'plate_type',
];

// Field selections for each dataset (including system fields)
export const DATASET_FIELDS: Record<DatasetId, string[]> = {
  // All FY datasets have the same schema with addresses
  'pvqr-7yc4': FY_DATASET_FIELDS,  // FY2024
  'pvda-ns3a': FY_DATASET_FIELDS,  // FY2023
  '869v-vr48': FY_DATASET_FIELDS,  // FY2022
  'p7t3-5i9s': FY_DATASET_FIELDS,  // FY2021
  'jt7v-77mi': FY_DATASET_FIELDS,  // FY2020
  'faiq-9dfq': FY_DATASET_FIELDS,  // FY2019
  '9wgk-ev5c': FY_DATASET_FIELDS,  // FY2018
  '2bnn-yakx': FY_DATASET_FIELDS,  // FY2017
  // Open Violations has different schema (no addresses)
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
  house_number: string | null;
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

  // All FY datasets (FY2017-2024) have addresses
  if (DATASETS_WITH_ADDRESSES.includes(datasetId)) {
    // Normalize house_number: trim and uppercase
    const houseNumber = (raw.house_number as string)?.trim().toUpperCase() || null;
    // Normalize street_name: trim and uppercase
    const streetName = (raw.street_name as string)?.trim().toUpperCase() || null;
    
    return {
      summons_number: summonsNumber,
      source_dataset: datasetId,
      issue_date: parseDate(raw.issue_date as string | undefined),
      violation_time: (raw.violation_time as string) || null,
      violation_code: (raw.violation_code as string) || null,
      violation_desc: null, // Not available in FY datasets
      issuing_agency: (raw.issuing_agency as string) || null,
      house_number: houseNumber,
      county: (raw.violation_county as string) || null,
      precinct: (raw.violation_precinct as string) || null,
      street_name: streetName,
      intersecting_street: (raw.intersecting_street as string)?.trim().toUpperCase() || null,
      fine_amount: null, // Not always present in FY datasets
      plate_id: (raw.plate_id as string) || null,
      registration_state: (raw.registration_state as string) || null,
      plate_type: (raw.plate_type as string) || null,
      soda_row_id: sodaRowId,
      soda_created_at: sodaCreatedAt,
      soda_updated_at: sodaUpdatedAt,
    };
  } else if (datasetId === 'nc67-uf89') {
    // Open Violations dataset - no addresses, but has fine_amount
    return {
      summons_number: summonsNumber,
      source_dataset: datasetId,
      issue_date: parseDate(raw.issue_date as string | undefined),
      violation_time: (raw.violation_time as string) || null,
      violation_code: null, // Not in this dataset
      violation_desc: (raw.violation as string) || null,
      issuing_agency: (raw.issuing_agency as string) || null,
      house_number: null, // Not in this dataset
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

