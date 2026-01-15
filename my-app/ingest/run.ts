#!/usr/bin/env node
/**
 * CLI entry point for parking ticket ingestion
 *
 * Ingests parking ticket data from NYC Open Data, including addresses.
 * FY datasets (FY2017-2024) provide house_number, street_name, and violation_code.
 * Open Violations dataset provides fine_amount and violation description.
 *
 * Datasets are processed in order: FY datasets first (with addresses),
 * then Open Violations last (uses COALESCE to preserve addresses).
 *
 * Usage:
 *   npx tsx ingest/run.ts backfill           - Backfill ALL datasets (FY2017-2024 + Open Violations)
 *   npx tsx ingest/run.ts backfill --quick   - Quick backfill (100K rows per dataset)
 *   npx tsx ingest/run.ts sync               - Incremental sync
 *   npx tsx ingest/run.ts stats              - Show table statistics
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') });

import {
  DATASETS,
  type DatasetId,
  mapToTicketRow,
  type ParkingTicketRow,
} from './config';
import { backfillPages, incrementalPages, getRecordCount, type BackfillOptions } from './socrata';
import {
  initPool,
  getCursor,
  updateCursor,
  upsertTickets,
  getMaxUpdatedAt,
  getTableStats,
  closePool,
} from './db';

// Fiscal year date ranges
// NYC Fiscal Year runs July 1 - June 30
const FISCAL_YEARS = {
  FY2017: { start: '2016-07-01', end: '2017-06-30' },
  FY2018: { start: '2017-07-01', end: '2018-06-30' },
  FY2019: { start: '2018-07-01', end: '2019-06-30' },
  FY2020: { start: '2019-07-01', end: '2020-06-30' },
  FY2021: { start: '2020-07-01', end: '2021-06-30' },
  FY2022: { start: '2021-07-01', end: '2022-06-30' },
  FY2023: { start: '2022-07-01', end: '2023-06-30' },
  FY2024: { start: '2023-07-01', end: '2024-06-30' },
};

// Dataset-specific backfill configurations
// NOTE: Order matters! FY datasets (with addresses) should be processed before
// Open Violations (without addresses), so COALESCE preserves address data.
const DATASET_CONFIGS: Record<DatasetId, { name: string; options: BackfillOptions }> = {
  // Parking Violations Issued – FY datasets (have house_number, street_name)
  'pvqr-7yc4': {
    name: 'Parking Violations Issued – FY2024',
    options: {
      startDate: FISCAL_YEARS.FY2024.start,
      endDate: FISCAL_YEARS.FY2024.end,
    },
  },
  'pvda-ns3a': {
    name: 'Parking Violations Issued – FY2023',
    options: {
      startDate: FISCAL_YEARS.FY2023.start,
      endDate: FISCAL_YEARS.FY2023.end,
    },
  },
  '869v-vr48': {
    name: 'Parking Violations Issued – FY2022',
    options: {
      startDate: FISCAL_YEARS.FY2022.start,
      endDate: FISCAL_YEARS.FY2022.end,
    },
  },
  'p7t3-5i9s': {
    name: 'Parking Violations Issued – FY2021',
    options: {
      startDate: FISCAL_YEARS.FY2021.start,
      endDate: FISCAL_YEARS.FY2021.end,
    },
  },
  'jt7v-77mi': {
    name: 'Parking Violations Issued – FY2020',
    options: {
      startDate: FISCAL_YEARS.FY2020.start,
      endDate: FISCAL_YEARS.FY2020.end,
    },
  },
  'faiq-9dfq': {
    name: 'Parking Violations Issued – FY2019',
    options: {
      startDate: FISCAL_YEARS.FY2019.start,
      endDate: FISCAL_YEARS.FY2019.end,
    },
  },
  '9wgk-ev5c': {
    name: 'Parking Violations Issued – FY2018',
    options: {
      startDate: FISCAL_YEARS.FY2018.start,
      endDate: FISCAL_YEARS.FY2018.end,
    },
  },
  '2bnn-yakx': {
    name: 'Parking Violations Issued – FY2017',
    options: {
      startDate: FISCAL_YEARS.FY2017.start,
      endDate: FISCAL_YEARS.FY2017.end,
    },
  },
  // Open Parking and Camera Violations - processed LAST so COALESCE preserves addresses
  'nc67-uf89': {
    name: 'Open Parking and Camera Violations',
    options: {
      startDate: FISCAL_YEARS.FY2017.start,  // July 1, 2016
      endDate: FISCAL_YEARS.FY2024.end,      // June 30, 2024
    },
  },
};

// Quick backfill for testing (100K rows per dataset)
const QUICK_MAX_ROWS = 100000;

type Command = 'backfill' | 'sync' | 'stats';

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
 * Run backfill for a single dataset with date filtering
 */
async function runBackfillForDataset(
  datasetId: DatasetId,
  options: BackfillOptions
): Promise<{ totalRows: number; totalUpserted: number; maxUpdatedAt: string | null }> {
  const config = DATASET_CONFIGS[datasetId];
  
  console.log('\n' + '='.repeat(60));
  console.log(`Dataset: ${datasetId}`);
  console.log(`Name: ${config.name}`);
  console.log(`Date Range: ${options.startDate} to ${options.endDate}`);
  if (options.maxRows) {
    console.log(`Max Rows: ${options.maxRows.toLocaleString()}`);
  }
  console.log(`Filters: Excluding bus lane, speed camera, red light camera violations`);
  console.log('='.repeat(60));

  // Get estimated count
  console.log('\nEstimating record count...');
  try {
    const estimatedCount = await getRecordCount(datasetId, options);
    const targetCount = options.maxRows ? Math.min(estimatedCount, options.maxRows) : estimatedCount;
    console.log(`Records to fetch: ~${targetCount.toLocaleString()}`);
    
    const estimatedMinutes = Math.ceil(targetCount / 1000 * 0.15); // ~0.15 min per 1000 records
    console.log(`Estimated time: ~${estimatedMinutes} minutes\n`);
  } catch (e) {
    console.log('Could not estimate count, proceeding with backfill...\n');
  }

  const startTime = Date.now();
  let totalRows = 0;
  let totalUpserted = 0;
  let maxUpdatedAt: string | null = null;
  let lastLogTime = Date.now();

  for await (const page of backfillPages(datasetId, options)) {
    // Map raw rows to ticket rows
    const ticketRows: ParkingTicketRow[] = [];
    for (const raw of page) {
      const mapped = mapToTicketRow(datasetId, raw);
      if (mapped) {
        ticketRows.push(mapped);
      }
    }

    if (ticketRows.length === 0) continue;

    // Track max updated_at for cursor
    const pageMaxUpdated = getMaxUpdatedAt(ticketRows);
    if (pageMaxUpdated && (!maxUpdatedAt || pageMaxUpdated > maxUpdatedAt)) {
      maxUpdatedAt = pageMaxUpdated;
    }

    // Upsert to database
    const upserted = await upsertTickets(ticketRows);
    totalRows += page.length;
    totalUpserted += upserted;

    // Progress logging (every 10 seconds or 10K rows)
    const now = Date.now();
    if (now - lastLogTime > 10000 || totalRows % 10000 === 0) {
      const elapsed = formatDuration(now - startTime);
      const rate = Math.round(totalRows / ((now - startTime) / 1000));
      console.log(
        `Progress: ${totalRows.toLocaleString()} fetched, ${totalUpserted.toLocaleString()} upserted | ${elapsed} elapsed | ${rate} rows/sec`
      );
      lastLogTime = now;
    }
  }

  // Update cursor if we processed any rows
  if (maxUpdatedAt) {
    await updateCursor(datasetId, maxUpdatedAt);
  }

  const totalTime = formatDuration(Date.now() - startTime);
  
  console.log('\n' + '-'.repeat(40));
  console.log(`Dataset ${datasetId} complete!`);
  console.log(`Rows fetched: ${totalRows.toLocaleString()}`);
  console.log(`Rows upserted: ${totalUpserted.toLocaleString()}`);
  console.log(`Time: ${totalTime}`);
  if (maxUpdatedAt) {
    console.log(`Cursor: ${maxUpdatedAt}`);
  }
  console.log('-'.repeat(40));

  return { totalRows, totalUpserted, maxUpdatedAt };
}

// Ordered list of datasets for backfill
// FY datasets (with addresses) are processed FIRST, Open Violations LAST
// This ensures COALESCE preserves address data when Open Violations updates records
const BACKFILL_ORDER: DatasetId[] = [
  // FY datasets with addresses (newest first for most recent data)
  'pvqr-7yc4',  // FY2024
  'pvda-ns3a',  // FY2023
  '869v-vr48',  // FY2022
  'p7t3-5i9s',  // FY2021
  'jt7v-77mi',  // FY2020
  'faiq-9dfq',  // FY2019
  '9wgk-ev5c',  // FY2018
  '2bnn-yakx',  // FY2017
  // Open Violations LAST (no addresses, but has fine_amount)
  'nc67-uf89',
];

/**
 * Run backfill for all datasets
 */
async function runBackfill(isQuick: boolean = false): Promise<void> {
  const allDatasetIds = BACKFILL_ORDER;
  
  console.log('\n' + '='.repeat(60));
  console.log('NYC Parking Ticket Backfill - ALL DATASETS');
  console.log('='.repeat(60));
  console.log(`Datasets to process: ${allDatasetIds.length}`);
  console.log('Order: FY datasets (with addresses) first, Open Violations last');
  for (const id of allDatasetIds) {
    const config = DATASET_CONFIGS[id];
    console.log(`  - ${id}: ${config.name} (${config.options.startDate} to ${config.options.endDate})`);
  }
  if (isQuick) {
    console.log(`Mode: QUICK (max ${QUICK_MAX_ROWS.toLocaleString()} rows per dataset)`);
  }
  console.log('='.repeat(60));

  const startTime = Date.now();
  let grandTotalRows = 0;
  let grandTotalUpserted = 0;

  for (const datasetId of allDatasetIds) {
    const config = DATASET_CONFIGS[datasetId];
    const options: BackfillOptions = {
      ...config.options,
      ...(isQuick ? { maxRows: QUICK_MAX_ROWS } : {}),
    };

    const result = await runBackfillForDataset(datasetId, options);
    grandTotalRows += result.totalRows;
    grandTotalUpserted += result.totalUpserted;
  }

  const totalTime = formatDuration(Date.now() - startTime);
  
  console.log('\n' + '='.repeat(60));
  console.log('ALL BACKFILLS COMPLETE!');
  console.log('='.repeat(60));
  console.log(`Grand total rows fetched: ${grandTotalRows.toLocaleString()}`);
  console.log(`Grand total rows upserted: ${grandTotalUpserted.toLocaleString()}`);
  console.log(`Total time: ${totalTime}`);
  console.log('='.repeat(60) + '\n');
}

/**
 * Run incremental sync for a single dataset
 */
async function runSyncForDataset(datasetId: DatasetId): Promise<{ totalRows: number; totalUpserted: number }> {
  console.log(`\n--- Syncing: ${datasetId} ---`);

  const cursor = await getCursor(datasetId);
  console.log(`Current cursor: ${cursor}`);

  let totalRows = 0;
  let totalUpserted = 0;
  let maxUpdatedAt: string | null = null;

  for await (const page of incrementalPages(datasetId, cursor)) {
    const ticketRows: ParkingTicketRow[] = [];
    for (const raw of page) {
      const mapped = mapToTicketRow(datasetId, raw);
      if (mapped) {
        ticketRows.push(mapped);
      }
    }

    if (ticketRows.length === 0) continue;

    const pageMaxUpdated = getMaxUpdatedAt(ticketRows);
    if (pageMaxUpdated && (!maxUpdatedAt || pageMaxUpdated > maxUpdatedAt)) {
      maxUpdatedAt = pageMaxUpdated;
    }

    const upserted = await upsertTickets(ticketRows);
    totalRows += page.length;
    totalUpserted += upserted;

    console.log(
      `Processed ${page.length} rows, upserted ${upserted} (total: ${totalRows} fetched, ${totalUpserted} upserted)`
    );
  }

  if (maxUpdatedAt) {
    await updateCursor(datasetId, maxUpdatedAt);
    console.log(`Cursor updated to: ${maxUpdatedAt}`);
  } else {
    console.log('No new rows found');
  }

  return { totalRows, totalUpserted };
}

/**
 * Run incremental sync for all datasets
 */
async function runSync(): Promise<void> {
  const allDatasetIds = BACKFILL_ORDER;
  
  console.log('\n' + '='.repeat(60));
  console.log('NYC Parking Ticket Sync - ALL DATASETS');
  console.log('='.repeat(60));

  let grandTotalRows = 0;
  let grandTotalUpserted = 0;

  for (const datasetId of allDatasetIds) {
    const result = await runSyncForDataset(datasetId);
    grandTotalRows += result.totalRows;
    grandTotalUpserted += result.totalUpserted;
  }

  console.log('\n' + '='.repeat(60));
  console.log('Sync Complete!');
  console.log('='.repeat(60));
  console.log(`Grand total rows fetched: ${grandTotalRows.toLocaleString()}`);
  console.log(`Grand total rows upserted: ${grandTotalUpserted.toLocaleString()}`);
  console.log('='.repeat(60) + '\n');
}

/**
 * Show table statistics
 */
async function showStats(): Promise<void> {
  console.log('\n=== Parking Ticket Table Statistics ===\n');

  const stats = await getTableStats();

  console.log(`Total rows: ${stats.totalRows.toLocaleString()}`);
  console.log('\nBy dataset:');
  for (const [dataset, count] of Object.entries(stats.byDataset)) {
    console.log(`  ${dataset}: ${count.toLocaleString()}`);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = args[0] as Command;

  try {
    // Initialize database connection (resolves hostname to IPv4)
    await initPool();
    
    switch (command) {
      case 'backfill': {
        const isQuick = args.includes('--quick');
        await runBackfill(isQuick);
        break;
      }

      case 'sync': {
        await runSync();
        break;
      }

      case 'stats': {
        await showStats();
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

function printUsage(): void {
  console.log(`
NYC Parking Ticket Ingester

Usage:
  npx tsx ingest/run.ts <command> [options]

Commands:
  backfill          - Backfill ALL datasets (FY2017-2024 + Open Violations)
  backfill --quick  - Quick backfill (100K rows per dataset for testing)
  sync              - Incremental sync of new/updated records
  stats             - Show table statistics

Datasets (processed in order):
  FY Datasets (with house_number, street_name):
    - pvqr-7yc4: Parking Violations Issued – FY2024
    - pvda-ns3a: Parking Violations Issued – FY2023
    - 869v-vr48: Parking Violations Issued – FY2022
    - p7t3-5i9s: Parking Violations Issued – FY2021
    - jt7v-77mi: Parking Violations Issued – FY2020
    - faiq-9dfq: Parking Violations Issued – FY2019
    - 9wgk-ev5c: Parking Violations Issued – FY2018
    - 2bnn-yakx: Parking Violations Issued – FY2017
  
  Open Violations (processed last, adds fine_amount):
    - nc67-uf89: Open Parking and Camera Violations

FY datasets are processed first so address data (house_number, street_name)
is populated. Open Violations is processed last and uses COALESCE to 
preserve existing addresses while adding fine_amount data.

All datasets filter out bus lane, speed camera, and red light camera violations.

Estimated Times:
  --quick:  ~1-2 hours (900K rows total, 100K per dataset)
  Full:     ~4-8 hours (depends on data volume, millions of rows)

Environment Variables:
  DATABASE_URL              - PostgreSQL connection string (required)
  NYC_OPEN_DATA_APP_TOKEN   - Socrata app token (recommended for speed)

Examples:
  npx tsx ingest/run.ts backfill --quick   # Quick test with 100K rows per dataset
  npx tsx ingest/run.ts backfill           # Full backfill of ALL datasets
  npx tsx ingest/run.ts sync               # Sync new records
  npx tsx ingest/run.ts stats              # Show row counts
`);
}

main();
