import pg from 'pg';
import { config } from './env.js';

const { Pool } = pg;

const url = config.databaseUrl || '';
const needsAcceptSelfSigned =
  url &&
  (/sslmode=|supabase|neon\.|render\.com|amazonaws\.com/i.test(url) ||
    (!url.includes('localhost') && !url.includes('127.0.0.1')));
const poolConfig = config.databaseUrl
  ? {
      connectionString: config.databaseUrl,
      ssl: needsAcceptSelfSigned ? { rejectUnauthorized: false } : false,
    }
  : {};

const pool = new Pool(poolConfig);

/**
 * Run a parameterized query. Usage: query('SELECT * FROM "User" WHERE id = $1', [id])
 * @param {string} text - SQL with $1, $2, ... placeholders
 * @param {unknown[]} [params] - Values for placeholders
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(text, params = []) {
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
  try {
    await query('SELECT 1');
    return true;
  } catch (err) {
    console.error('[db] Connection failed:', err.message);
    return false;
  }
}

export async function disconnectDb() {
  await pool.end();
}
