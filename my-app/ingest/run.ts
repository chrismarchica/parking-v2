#!/usr/bin/env node
/**
 * CLI entry point for parking ticket ingestion
 *
 * Usage:
 *   npx tsx ingest/run.ts backfill pvqr-7yc4
 *   npx tsx ingest/run.ts sync pvqr-7yc4
 *   npx tsx ingest/run.ts backfill all
 *   npx tsx ingest/run.ts sync all
 *   npx tsx ingest/run.ts stats
 */

import {
  DATASETS,
  type DatasetId,
  mapToTicketRow,
  type ParkingTicketRow,
} from './config';
import { backfillPages, incrementalPages } from './socrata';
import {
  getCursor,
  updateCursor,
  upsertTickets,
  getMaxUpdatedAt,
  getTableStats,
  closePool,
} from './db';

type Command = 'backfill' | 'sync' | 'stats';

/**
 * Run backfill for a dataset
 */
async function runBackfill(datasetId: DatasetId): Promise<void> {
  console.log(`\n=== Starting backfill for dataset: ${datasetId} ===\n`);

  let totalRows = 0;
  let totalUpserted = 0;
  let maxUpdatedAt: string | null = null;

  for await (const page of backfillPages(datasetId)) {
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

    console.log(
      `Processed ${page.length} rows, upserted ${upserted} (total: ${totalRows} fetched, ${totalUpserted} upserted)`
    );
  }

  // Update cursor if we processed any rows
  if (maxUpdatedAt) {
    await updateCursor(datasetId, maxUpdatedAt);
  }

  console.log(`\n=== Backfill complete for ${datasetId} ===`);
  console.log(`Total rows fetched: ${totalRows}`);
  console.log(`Total rows upserted: ${totalUpserted}`);
  if (maxUpdatedAt) {
    console.log(`Cursor updated to: ${maxUpdatedAt}`);
  }
}

/**
 * Run incremental sync for a dataset
 */
async function runSync(datasetId: DatasetId): Promise<void> {
  console.log(`\n=== Starting incremental sync for dataset: ${datasetId} ===\n`);

  const cursor = await getCursor(datasetId);
  console.log(`Current cursor: ${cursor}`);

  let totalRows = 0;
  let totalUpserted = 0;
  let maxUpdatedAt: string | null = null;

  for await (const page of incrementalPages(datasetId, cursor)) {
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

    console.log(
      `Processed ${page.length} rows, upserted ${upserted} (total: ${totalRows} fetched, ${totalUpserted} upserted)`
    );
  }

  // Update cursor if we processed any rows
  if (maxUpdatedAt) {
    await updateCursor(datasetId, maxUpdatedAt);
  }

  console.log(`\n=== Incremental sync complete for ${datasetId} ===`);
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
 * Parse dataset argument
 */
function parseDatasetArg(arg: string): DatasetId[] {
  if (arg === 'all') {
    return Object.values(DATASETS);
  }

  const validDatasets = Object.values(DATASETS) as string[];
  if (!validDatasets.includes(arg)) {
    console.error(`Invalid dataset: ${arg}`);
    console.error(`Valid options: ${validDatasets.join(', ')}, all`);
    process.exit(1);
  }

  return [arg as DatasetId];
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
        if (args.length < 2) {
          console.error('Error: backfill requires a dataset argument');
          printUsage();
          process.exit(1);
        }
        const datasets = parseDatasetArg(args[1]);
        for (const datasetId of datasets) {
          await runBackfill(datasetId);
        }
        break;
      }

      case 'sync': {
        if (args.length < 2) {
          console.error('Error: sync requires a dataset argument');
          printUsage();
          process.exit(1);
        }
        const datasets = parseDatasetArg(args[1]);
        for (const datasetId of datasets) {
          await runSync(datasetId);
        }
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
  npx tsx ingest/run.ts <command> [dataset]

Commands:
  backfill <dataset>  - Full backfill from Socrata (ordered by :id)
  sync <dataset>      - Incremental sync from last cursor (ordered by :updated_at)
  stats               - Show table statistics

Datasets:
  pvqr-7yc4           - Parking Violations Issued – Fiscal Year 2024
  nc67-uf89           - Open Parking and Camera Violations
  all                 - Run for all datasets

Environment Variables:
  DATABASE_URL              - PostgreSQL connection string (required)
  NYC_OPEN_DATA_APP_TOKEN   - Socrata app token (recommended for higher rate limits)

Examples:
  npx tsx ingest/run.ts backfill pvqr-7yc4
  npx tsx ingest/run.ts sync nc67-uf89
  npx tsx ingest/run.ts backfill all
  npx tsx ingest/run.ts stats
`);
}

main();

