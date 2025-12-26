#!/usr/bin/env tsx

/**
 * Background scheduler for periodic data ingestion and prediction updates.
 * 
 * Runs incremental sync on a configurable interval to keep data fresh.
 * 
 * Usage:
 *   npm run scheduler
 *   npm run scheduler -- --interval 30
 * 
 * Options:
 *   --interval <minutes>   Sync interval in minutes (default: 15)
 *   --once                 Run once and exit (no scheduling)
 *   --help                 Show help
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

import {
  DATASETS,
  type DatasetId,
  mapToTicketRow,
  type ParkingTicketRow,
} from '../ingest/config';
import { incrementalPages } from '../ingest/socrata';
import {
  getCursor,
  updateCursor,
  upsertTickets,
  getMaxUpdatedAt,
  getTableStats,
  closePool,
} from '../ingest/db';

interface SchedulerOptions {
  intervalMinutes: number;
  runOnce: boolean;
}

/**
 * Run incremental sync for all datasets
 */
async function runSyncAll(): Promise<{ totalFetched: number; totalUpserted: number }> {
  let totalFetched = 0;
  let totalUpserted = 0;

  for (const datasetId of Object.values(DATASETS) as DatasetId[]) {
    const result = await runSync(datasetId);
    totalFetched += result.fetched;
    totalUpserted += result.upserted;
  }

  return { totalFetched, totalUpserted };
}

/**
 * Run incremental sync for a single dataset
 */
async function runSync(datasetId: DatasetId): Promise<{ fetched: number; upserted: number }> {
  const cursor = await getCursor(datasetId);
  
  let totalRows = 0;
  let totalUpserted = 0;
  let maxUpdatedAt: string | null = null;

  try {
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
    }

    if (maxUpdatedAt) {
      await updateCursor(datasetId, maxUpdatedAt);
    }
  } catch (error) {
    console.error(`[${datasetId}] Sync error:`, error);
  }

  return { fetched: totalRows, upserted: totalUpserted };
}

/**
 * Format duration in human readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Get current timestamp string
 */
function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Run a single sync cycle
 */
async function runCycle(): Promise<void> {
  const startTime = Date.now();
  console.log(`\n[${timestamp()}] 🔄 Starting sync cycle...`);

  try {
    const { totalFetched, totalUpserted } = await runSyncAll();
    const duration = Date.now() - startTime;

    if (totalFetched > 0) {
      console.log(`[${timestamp()}] ✅ Sync complete: ${totalFetched} fetched, ${totalUpserted} upserted (${formatDuration(duration)})`);
    } else {
      console.log(`[${timestamp()}] ✅ No new data (${formatDuration(duration)})`);
    }

    // Show current stats
    const stats = await getTableStats();
    console.log(`[${timestamp()}] 📊 Total rows: ${stats.totalRows.toLocaleString()}`);
  } catch (error) {
    console.error(`[${timestamp()}] ❌ Sync cycle failed:`, error);
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(): SchedulerOptions {
  const args = process.argv.slice(2);
  const options: SchedulerOptions = {
    intervalMinutes: 15,
    runOnce: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
      case '--interval':
        if (nextArg) {
          const val = parseInt(nextArg, 10);
          if (isNaN(val) || val < 1) {
            console.error('Error: --interval must be a positive integer');
            process.exit(1);
          }
          options.intervalMinutes = val;
          i++;
        }
        break;
      case '--once':
        options.runOnce = true;
        break;
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
Background Scheduler for NYC Parking Ticket Data

Periodically syncs new data from NYC Open Data API.

Usage:
  npm run scheduler
  npm run scheduler -- --interval 30
  npm run scheduler -- --once

Options:
  --interval <minutes>   Sync interval in minutes (default: 15)
  --once                 Run once and exit (useful for cron jobs)
  --help                 Show this help message

Examples:
  npm run scheduler                    # Sync every 15 minutes
  npm run scheduler -- --interval 5    # Sync every 5 minutes
  npm run scheduler -- --once          # Sync once and exit
`);
}

/**
 * Main scheduler loop
 */
async function main(): Promise<void> {
  const options = parseArgs();

  console.log('='.repeat(60));
  console.log('NYC Parking Ticket Data Scheduler');
  console.log('='.repeat(60));
  console.log(`Interval: ${options.intervalMinutes} minutes`);
  console.log(`Mode: ${options.runOnce ? 'Run once' : 'Continuous'}`);
  console.log('='.repeat(60));

  // Run initial sync
  await runCycle();

  if (options.runOnce) {
    await closePool();
    process.exit(0);
  }

  // Schedule recurring syncs
  const intervalMs = options.intervalMinutes * 60 * 1000;
  console.log(`\n[${timestamp()}] ⏰ Next sync in ${options.intervalMinutes} minutes...`);

  const intervalId = setInterval(async () => {
    await runCycle();
    console.log(`\n[${timestamp()}] ⏰ Next sync in ${options.intervalMinutes} minutes...`);
  }, intervalMs);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[${timestamp()}] 🛑 Received ${signal}, shutting down...`);
    clearInterval(intervalId);
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

