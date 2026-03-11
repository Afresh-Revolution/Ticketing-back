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

/**
 * Ensure "User"."id" has a sequence and default so INSERTs without id don't violate not-null.
 * Safe to run on every startup; fixes DBs where User was created without SERIAL default.
 * Only runs when the "User" table exists and "id" is an integer type (skip if UUID/text).
 */
export async function ensureUserSequence() {
  if (!pool) return;
  try {
    const tableCheck = await query(
      `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'User'`
    );
    if (tableCheck.rows.length === 0) return;

    const colCheck = await query(
      `SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'id'`
    );
    const dataType = colCheck.rows[0]?.data_type;
    if (dataType !== 'integer' && dataType !== 'bigint' && dataType !== 'smallint') {
      return;
    }

    await query('CREATE SEQUENCE IF NOT EXISTS "User_id_seq"');
    const maxResult = await query('SELECT COALESCE(MAX("id")::bigint, 0) AS mx FROM "User"');
    const maxId = Number(maxResult.rows[0]?.mx ?? 0);
    await query('SELECT setval(\'"User_id_seq"\', $1)', [Math.max(1, maxId + 1)]);
    await query('ALTER SEQUENCE "User_id_seq" OWNED BY "User"."id"');
    await query('ALTER TABLE "User" ALTER COLUMN "id" SET DEFAULT nextval(\'"User_id_seq"\')');
  } catch (err) {
    console.warn('[db] ensureUserSequence:', err.message);
  }
}

export async function disconnectDb() {
  if (pool) await pool.end();
}

export { pool };
