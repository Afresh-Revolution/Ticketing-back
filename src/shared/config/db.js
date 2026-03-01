import pg from 'pg';
import { config } from './env.js';

const { Pool } = pg;

const url = config.databaseUrl || '';
const isRemoteDb =
  url && !url.includes('localhost') && !url.includes('127.0.0.1');
// pg-connection-string treats sslmode=require as verify-full; add uselibpqcompat so SSL accepts cloud DB certs
const connectionString =
  isRemoteDb && url.includes('sslmode=') && !url.includes('uselibpqcompat=')
    ? (url.includes('?') ? `${url}&uselibpqcompat=true` : `${url}?uselibpqcompat=true`)
    : url;
const poolConfig = config.databaseUrl
  ? {
      connectionString: connectionString || config.databaseUrl,
      ssl: isRemoteDb ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 20000,
      idleTimeoutMillis: 30000,
    }
  : {};

const pool = config.databaseUrl ? new Pool(poolConfig) : null;

/**
 * Run a parameterized query. Usage: query('SELECT * FROM "User" WHERE id = $1', [id])
 * @param {string} text - SQL with $1, $2, ... placeholders
 * @param {unknown[]} [params] - Values for placeholders
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL is not set');
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

/** Get the pool for transactions (client.query within a single client). */
export function getPool() {
  return pool;
}

/** Generate a new id (e.g. for inserts). Compatible with Prisma-style text ids. */
export function createId() {
  return crypto.randomUUID();
}

export async function connectDb() {
  if (!pool) return false;
  try {
    await query('SELECT 1');
    return true;
  } catch (err) {
    console.error('[db] Connection failed:', err.message);
    return false;
  }
}

export async function disconnectDb() {
  if (pool) await pool.end();
}

export { pool };
