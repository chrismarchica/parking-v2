/**
 * Database operations for parking ticket ingestion
 */

import { Pool, PoolClient } from 'pg';
import { ParkingTicketRow, BATCH_INSERT_SIZE } from './config';

let pool: Pool | null = null;

/**
 * Get database connection pool
 */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected database error:', err);
    });
  }

  return pool;
}

/**
 * Close the database pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Read the cursor for a dataset
 */
export async function getCursor(datasetId: string): Promise<string> {
  const db = getPool();
  const result = await db.query(
    'SELECT last_soda_updated FROM ingest_cursor WHERE dataset_id = $1',
    [datasetId]
  );

  if (result.rows.length === 0) {
    // Initialize cursor if not exists
    const defaultCursor = '1970-01-01T00:00:00Z';
    await db.query(
      `INSERT INTO ingest_cursor (dataset_id, last_soda_updated, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (dataset_id) DO NOTHING`,
      [datasetId, defaultCursor]
    );
    return defaultCursor;
  }

  return result.rows[0].last_soda_updated.toISOString();
}

/**
 * Update the cursor for a dataset
 */
export async function updateCursor(
  datasetId: string,
  lastSodaUpdated: string
): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO ingest_cursor (dataset_id, last_soda_updated, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (dataset_id) 
     DO UPDATE SET last_soda_updated = $2, updated_at = NOW()`,
    [datasetId, lastSodaUpdated]
  );
  console.log(`Cursor updated for ${datasetId}: ${lastSodaUpdated}`);
}

/**
 * Build batch upsert query for parking tickets
 */
function buildUpsertQuery(rows: ParkingTicketRow[]): {
  text: string;
  values: unknown[];
} {
  const columns = [
    'summons_number',
    'source_dataset',
    'issue_date',
    'violation_time',
    'violation_code',
    'violation_desc',
    'issuing_agency',
    'county',
    'precinct',
    'street_name',
    'intersecting_street',
    'fine_amount',
    'plate_id',
    'registration_state',
    'plate_type',
    'soda_row_id',
    'soda_created_at',
    'soda_updated_at',
  ];

  const values: unknown[] = [];
  const valuePlaceholders: string[] = [];

  rows.forEach((row, rowIndex) => {
    const rowPlaceholders: string[] = [];
    const baseIndex = rowIndex * columns.length;

    columns.forEach((col, colIndex) => {
      const paramIndex = baseIndex + colIndex + 1;
      rowPlaceholders.push(`$${paramIndex}`);
      values.push(row[col as keyof ParkingTicketRow]);
    });

    valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);
  });

  const text = `
    INSERT INTO parking_ticket (${columns.join(', ')})
    VALUES ${valuePlaceholders.join(', ')}
    ON CONFLICT (summons_number) DO UPDATE SET
      source_dataset = EXCLUDED.source_dataset,
      issue_date = EXCLUDED.issue_date,
      violation_time = EXCLUDED.violation_time,
      violation_code = EXCLUDED.violation_code,
      violation_desc = EXCLUDED.violation_desc,
      issuing_agency = EXCLUDED.issuing_agency,
      county = EXCLUDED.county,
      precinct = EXCLUDED.precinct,
      street_name = EXCLUDED.street_name,
      intersecting_street = EXCLUDED.intersecting_street,
      fine_amount = EXCLUDED.fine_amount,
      plate_id = EXCLUDED.plate_id,
      registration_state = EXCLUDED.registration_state,
      plate_type = EXCLUDED.plate_type,
      soda_row_id = EXCLUDED.soda_row_id,
      soda_created_at = EXCLUDED.soda_created_at,
      soda_updated_at = EXCLUDED.soda_updated_at
    WHERE parking_ticket.soda_updated_at IS DISTINCT FROM EXCLUDED.soda_updated_at
  `;

  return { text, values };
}

/**
 * Batch insert/upsert parking tickets
 */
export async function upsertTickets(rows: ParkingTicketRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const db = getPool();
  let totalInserted = 0;

  // Process in batches
  for (let i = 0; i < rows.length; i += BATCH_INSERT_SIZE) {
    const batch = rows.slice(i, i + BATCH_INSERT_SIZE);
    const query = buildUpsertQuery(batch);

    try {
      const result = await db.query(query.text, query.values);
      totalInserted += result.rowCount || 0;
    } catch (error) {
      console.error(`Error upserting batch at offset ${i}:`, error);
      throw error;
    }
  }

  return totalInserted;
}

/**
 * Get the maximum soda_updated_at from a batch of rows
 */
export function getMaxUpdatedAt(rows: ParkingTicketRow[]): string | null {
  if (rows.length === 0) return null;

  let maxDate: Date | null = null;

  for (const row of rows) {
    if (row.soda_updated_at) {
      const date = new Date(row.soda_updated_at);
      if (!maxDate || date > maxDate) {
        maxDate = date;
      }
    }
  }

  return maxDate ? maxDate.toISOString() : null;
}

/**
 * Get statistics about the parking_ticket table
 */
export async function getTableStats(): Promise<{
  totalRows: number;
  byDataset: Record<string, number>;
}> {
  const db = getPool();

  const totalResult = await db.query('SELECT COUNT(*) as count FROM parking_ticket');
  const byDatasetResult = await db.query(
    'SELECT source_dataset, COUNT(*) as count FROM parking_ticket GROUP BY source_dataset'
  );

  const byDataset: Record<string, number> = {};
  for (const row of byDatasetResult.rows) {
    byDataset[row.source_dataset] = parseInt(row.count);
  }

  return {
    totalRows: parseInt(totalResult.rows[0].count),
    byDataset,
  };
}

