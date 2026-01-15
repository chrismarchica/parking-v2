import { Pool } from 'pg';
import dns from 'dns';
import { promisify } from 'util';

const dnsResolve4 = promisify(dns.resolve4);

// Database connection pool
let pool: Pool | null = null;
let connectionString: string | null = null;

/**
 * Resolve hostname to IPv4 address (for WSL2/Supabase compatibility)
 */
async function resolveToIPv4(hostname: string): Promise<string> {
  try {
    const addresses = await dnsResolve4(hostname);
    if (addresses && addresses.length > 0) {
      return addresses[0];
    }
  } catch {
    // Fall back to original hostname if IPv4 resolution fails
  }
  return hostname;
}

/**
 * Initialize database connection with IPv4 resolution
 */
export async function initDb(): Promise<Pool> {
  if (!pool) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    // Parse and resolve hostname to IPv4
    const url = new URL(dbUrl);
    const originalHost = url.hostname;
    const ipv4Address = await resolveToIPv4(originalHost);
    
    url.hostname = ipv4Address;
    connectionString = url.toString();

    pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: { rejectUnauthorized: false },
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  return pool;
}

/**
 * Get database pool (must call initDb first for scripts, auto-initializes for simple use)
 */
export function getDb(): Pool {
  if (!pool) {
    // Fallback for sync usage - use original connection string
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    pool = new Pool({
      connectionString: dbUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: { rejectUnauthorized: false },
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  return pool;
}

export async function query(text: string, params?: unknown[]) {
  const db = getDb();
  const start = Date.now();
  try {
    const res = await db.query(text, params);
    const duration = Date.now() - start;
    // Only log in development
    if (process.env.NODE_ENV === 'development') {
      console.log('Executed query', { text: text.slice(0, 50), duration, rows: res.rowCount });
    }
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

export async function getClient() {
  const db = getDb();
  return await db.connect();
}

