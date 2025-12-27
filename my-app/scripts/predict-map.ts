#!/usr/bin/env tsx

/**
 * CLI script to test time-aware map predictions.
 * Shows predictions with geographic coordinates for the current time.
 * 
 * Usage:
 *   npm run predict:map
 *   npm run predict:map -- --at "2023-07-14T15:00:00Z"
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { predictPrecinct } from '../lib/predictions/precinct';
import { getPrecinctLocation } from '../lib/predictions/precinct-locations';

interface Args {
  at?: Date;
  trainDays?: number;
  limit?: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === '--at' && next) {
      result.at = new Date(next);
      i++;
    } else if (arg === '--trainDays' && next) {
      result.trainDays = parseInt(next, 10);
      i++;
    } else if (arg === '--limit' && next) {
      result.limit = parseInt(next, 10);
      i++;
    } else if (arg === '--help') {
      console.log(`
Time-Aware Map Predictions

Usage:
  npm run predict:map
  npm run predict:map -- --at "2023-07-14T15:00:00Z"

Options:
  --at <datetime>    Target datetime (ISO format)
  --trainDays <n>    Lookback days (default: 60)
  --limit <n>        Max precincts (default: 20)
`);
      process.exit(0);
    }
  }

  return result;
}

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatHour(hour: number): string {
  if (hour === 0) return '12:00 AM';
  if (hour === 12) return '12:00 PM';
  if (hour < 12) return `${hour}:00 AM`;
  return `${hour - 12}:00 PM`;
}

async function main() {
  const args = parseArgs();

  console.log('🗺️  Time-Aware Map Predictions\n');

  const result = await predictPrecinct({
    at: args.at,
    trainDays: args.trainDays,
    limit: args.limit ?? 20,
  });

  console.log('='.repeat(70));
  console.log(`Time: ${result.as_of}`);
  console.log(`Bucket: ${dayNames[result.bucket.dow]} @ ${formatHour(result.bucket.hour)}`);
  console.log(`Training: ${result.train_days} days | Rows Used: ${result.rows_used.toLocaleString()}`);
  console.log('='.repeat(70));
  console.log('');

  console.log('Precinct'.padEnd(10) + 'Name'.padEnd(22) + 'Borough'.padEnd(15) + 'Expected'.padEnd(12) + 'Coordinates');
  console.log('-'.repeat(70));

  let mappedCount = 0;
  let unmappedCount = 0;

  for (const pred of result.predictions) {
    const loc = getPrecinctLocation(pred.precinct);
    if (loc) {
      mappedCount++;
      console.log(
        pred.precinct.padEnd(10) +
        loc.name.slice(0, 20).padEnd(22) +
        loc.borough.padEnd(15) +
        pred.expected_tickets.toFixed(1).padEnd(12) +
        `[${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}]`
      );
    } else {
      unmappedCount++;
      console.log(
        pred.precinct.padEnd(10) +
        '(unknown)'.padEnd(22) +
        '-'.padEnd(15) +
        pred.expected_tickets.toFixed(1).padEnd(12) +
        'No coordinates'
      );
    }
  }

  console.log('-'.repeat(70));
  console.log(`\n✅ ${mappedCount} precincts with coordinates, ${unmappedCount} without\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

