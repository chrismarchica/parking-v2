#!/usr/bin/env node
/**
 * CLI entry point for parking ticket ingestion
 *
 * Usage:
 *   npx tsx ingest/run.ts backfill           - Backfill FY2022-2024 from Open Violations
 *   npx tsx ingest/run.ts backfill --quick   - Quick backfill (100K rows for testing)
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
  getCursor,
  updateCursor,
  upsertTickets,
  getMaxUpdatedAt,
  getTableStats,
  closePool,
} from './db';

// Primary dataset: Open Parking and Camera Violations (most comprehensive)
const PRIMARY_DATASET: DatasetId = DATASETS.OPEN_VIOLATIONS;

// Fiscal year date ranges
// NYC Fiscal Year runs July 1 - June 30
const FISCAL_YEARS = {
  FY2022: { start: '2021-07-01', end: '2022-06-30' },
  FY2023: { start: '2022-07-01', end: '2023-06-30' },
  FY2024: { start: '2023-07-01', end: '2024-06-30' },
};

// Default backfill: FY2022 through FY2024
const DEFAULT_BACKFILL_OPTIONS: BackfillOptions = {
  startDate: FISCAL_YEARS.FY2022.start,  // July 1, 2021
  endDate: FISCAL_YEARS.FY2024.end,      // June 30, 2024
};

// Quick backfill for testing
const QUICK_BACKFILL_OPTIONS: BackfillOptions = {
  ...DEFAULT_BACKFILL_OPTIONS,
  maxRows: 100000,  // 100K rows for quick testing
};

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
 * Run backfill for the primary dataset with date filtering
 */
async function runBackfill(options: BackfillOptions = DEFAULT_BACKFILL_OPTIONS): Promise<void> {
  const datasetId = PRIMARY_DATASET;
  
  console.log('\n' + '='.repeat(60));
  console.log('NYC Parking Ticket Backfill');
  console.log('='.repeat(60));
  console.log(`Dataset: ${datasetId} (Open Parking and Camera Violations)`);
  console.log(`Date Range: ${options.startDate} to ${options.endDate}`);
  if (options.maxRows) {
    console.log(`Max Rows: ${options.maxRows.toLocaleString()}`);
  }
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
  
  console.log('\n' + '='.repeat(60));
  console.log('Backfill Complete!');
  console.log('='.repeat(60));
  console.log(`Total rows fetched: ${totalRows.toLocaleString()}`);
  console.log(`Total rows upserted: ${totalUpserted.toLocaleString()}`);
  console.log(`Total time: ${totalTime}`);
  if (maxUpdatedAt) {
    console.log(`Cursor updated to: ${maxUpdatedAt}`);
  }
  console.log('='.repeat(60) + '\n');
}

/**
 * Run incremental sync for the primary dataset
 */
async function runSync(): Promise<void> {
  const datasetId = PRIMARY_DATASET;
  
  console.log(`\n=== Starting incremental sync for: ${datasetId} ===\n`);

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
  }

  console.log(`\n=== Sync complete ===`);
  console.log(`Total rows fetched: ${totalRows}`);
  console.log(`Total rows upserted: ${totalUpserted}`);
  if (maxUpdatedAt) {
    console.log(`Cursor updated to: ${maxUpdatedAt}`);
  } else {
    console.log('No new rows found');
  }
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
    switch (command) {
      case 'backfill': {
        const isQuick = args.includes('--quick');
        const options = isQuick ? QUICK_BACKFILL_OPTIONS : DEFAULT_BACKFILL_OPTIONS;
        await runBackfill(options);
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
  backfill          - Backfill FY2022-2024 from Open Violations dataset
  backfill --quick  - Quick backfill (100K rows for testing)
  sync              - Incremental sync of new/updated records
  stats             - Show table statistics

Dataset:
  Uses Open Parking and Camera Violations (nc67-uf89) as primary source.
  Backfills fiscal years 2022, 2023, and 2024 (July 2021 - June 2024).

Estimated Times:
  --quick:  ~15-20 minutes (100K rows)
  Full:     ~4-8 hours (several million rows)

Environment Variables:
  DATABASE_URL              - PostgreSQL connection string (required)
  NYC_OPEN_DATA_APP_TOKEN   - Socrata app token (recommended for speed)

Examples:
  npx tsx ingest/run.ts backfill --quick   # Quick test with 100K rows
  npx tsx ingest/run.ts backfill           # Full FY2022-2024 backfill
  npx tsx ingest/run.ts sync               # Sync new records
  npx tsx ingest/run.ts stats              # Show row counts
`);
}

main();
