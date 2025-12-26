#!/usr/bin/env tsx

/**
 * CLI script to run precinct-level predictions locally.
 * 
 * Usage:
 *   npx tsx scripts/predict-precinct.ts [options]
 *   npm run predict [-- options]
 * 
 * Options:
 *   --at <datetime>      Target datetime (ISO format, default: now)
 *   --trainDays <n>      Days to look back for training (default: 60, range: 14-365)
 *   --limit <n>          Max precincts to return (default: 20)
 *   --help               Show this help message
 * 
 * Examples:
 *   npx tsx scripts/predict-precinct.ts
 *   npx tsx scripts/predict-precinct.ts --trainDays 90 --limit 10
 *   npx tsx scripts/predict-precinct.ts --at "2024-12-15T14:00:00Z"
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local file
config({ path: resolve(__dirname, '../.env.local') });

import { predictPrecinct, PredictionResult } from '../lib/predictions/precinct';

function parseArgs(args: string[]): {
  at?: Date;
  trainDays?: number;
  limit?: number;
  help?: boolean;
} {
  const result: {
    at?: Date;
    trainDays?: number;
    limit?: number;
    help?: boolean;
  } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--help':
      case '-h':
        result.help = true;
        break;
      case '--at':
        if (nextArg) {
          const parsed = new Date(nextArg);
          if (isNaN(parsed.getTime())) {
            console.error(`Error: Invalid datetime for --at: ${nextArg}`);
            process.exit(1);
          }
          result.at = parsed;
          i++;
        }
        break;
      case '--trainDays':
        if (nextArg) {
          const parsed = parseInt(nextArg, 10);
          if (isNaN(parsed)) {
            console.error(`Error: Invalid number for --trainDays: ${nextArg}`);
            process.exit(1);
          }
          result.trainDays = parsed;
          i++;
        }
        break;
      case '--limit':
        if (nextArg) {
          const parsed = parseInt(nextArg, 10);
          if (isNaN(parsed)) {
            console.error(`Error: Invalid number for --limit: ${nextArg}`);
            process.exit(1);
          }
          result.limit = parsed;
          i++;
        }
        break;
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
Precinct Prediction CLI

Predicts expected ticket counts per precinct for a 60-minute window
using historical rate by time bucket (day of week + hour).

Usage:
  npx tsx scripts/predict-precinct.ts [options]
  npm run predict [-- options]

Options:
  --at <datetime>      Target datetime (ISO format, default: now)
  --trainDays <n>      Days to look back for training (default: 60, range: 14-365)
  --limit <n>          Max precincts to return (default: 20)
  --help               Show this help message

Examples:
  npx tsx scripts/predict-precinct.ts
  npx tsx scripts/predict-precinct.ts --trainDays 90 --limit 10
  npx tsx scripts/predict-precinct.ts --at "2024-12-15T14:00:00Z"
`);
}

function getDayName(dow: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dow] || 'Unknown';
}

function formatHour(hour: number): string {
  if (hour === 0) return '12:00 AM';
  if (hour === 12) return '12:00 PM';
  if (hour < 12) return `${hour}:00 AM`;
  return `${hour - 12}:00 PM`;
}

function printResults(result: PredictionResult): void {
  console.log('\n' + '='.repeat(60));
  console.log('PRECINCT TICKET PREDICTIONS');
  console.log('='.repeat(60));

  console.log(`\nPrediction Time:  ${result.as_of}`);
  console.log(`Window:           Next ${result.window_minutes} minutes`);
  console.log(`Target Bucket:    ${getDayName(result.bucket.dow)} @ ${formatHour(result.bucket.hour)}`);
  console.log(`Training Days:    ${result.train_days}`);
  console.log(`Rows Used:        ${result.rows_used.toLocaleString()}`);

  console.log('\n' + '-'.repeat(60));
  console.log(
    'Precinct'.padEnd(12) +
    'Expected Tickets'.padEnd(20) +
    'Score'
  );
  console.log('-'.repeat(60));

  if (result.predictions.length === 0) {
    console.log('No predictions available (no matching historical data)');
  } else {
    for (const p of result.predictions) {
      console.log(
        p.precinct.padEnd(12) +
        p.expected_tickets.toFixed(2).padEnd(20) +
        p.score.toFixed(4)
      );
    }
  }

  console.log('-'.repeat(60) + '\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  console.log('🎯 Running precinct predictions...');

  try {
    const result = await predictPrecinct({
      at: args.at,
      trainDays: args.trainDays,
      limit: args.limit,
    });

    printResults(result);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Prediction failed:', error);
    console.error('\nMake sure to:');
    console.error('1. Start the database: docker compose up -d');
    console.error('2. Add DATABASE_URL to .env.local');
    console.error('3. Run data ingestion: npm run ingest');
    process.exit(1);
  }
}

main();

