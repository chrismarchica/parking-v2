#!/usr/bin/env tsx

/**
 * Test database connection and PostGIS setup
 * Run with: npx tsx scripts/test-db.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local file
config({ path: resolve(__dirname, '../.env.local') });

import { query } from '../lib/db';

async function testConnection() {
  console.log('🔌 Testing database connection...\n');

  try {
    // Test basic connection
    const versionResult = await query('SELECT version()');
    console.log('✅ PostgreSQL connected');
    console.log('   Version:', versionResult.rows[0].version.split(',')[0]);

    // Test PostGIS
    const postgisResult = await query('SELECT PostGIS_Version()');
    console.log('\n✅ PostGIS enabled');
    console.log('   Version:', postgisResult.rows[0].postgis_version);

    // Test PostGIS functions
    const spatialTest = await query(`
      SELECT 
        ST_AsText(ST_Point(-73.985, 40.748)) as nyc_center,
        ST_Distance(
          ST_Point(-73.985, 40.748)::geography,
          ST_Point(-74.006, 40.713)::geography
        ) as distance_meters
    `);
    console.log('\n✅ Spatial functions working');
    console.log('   NYC Center (WKT):', spatialTest.rows[0].nyc_center);
    console.log('   Distance to WTC:', Math.round(spatialTest.rows[0].distance_meters), 'meters');

    console.log('\n🎉 Database is ready for use!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Database connection failed:', error);
    console.error('\nMake sure to:');
    console.error('1. Start the database: docker compose up -d');
    console.error('2. Add DATABASE_URL to .env.local');
    console.error('3. Wait a few seconds for the database to initialize\n');
    process.exit(1);
  }
}

testConnection();

