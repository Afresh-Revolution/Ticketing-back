import crypto from 'node:crypto';
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

/**
 * Align live "TopUser" with app expectations: missing columns + "id" default for legacy TEXT PK
 * or integer PK without a sequence (matches db/schema.sql SERIAL behavior).
 * Idempotent; run on every startup.
 */
/**
 * Ensure table "id" has a default (uuid text or integer sequence) so INSERTs without id succeed.
 * Idempotent; safe for legacy Withdrawal / BankAccount tables.
 */
export async function ensureTableIdDefault(tableName) {
  if (!pool) return;
  const rel = String(tableName || '').trim();
  if (!rel) return;
  try {
    const exists = await query(
      `SELECT 1 FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = $1`,
      [rel]
    );
    if (exists.rows.length === 0) return;

    const idCol = await query(
      `SELECT a.atttypid::regtype::text AS typ,
              COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '') AS def
       FROM pg_attribute a
       JOIN pg_class c ON a.attrelid = c.oid
       JOIN pg_namespace n ON c.relnamespace = n.oid
       LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
       WHERE n.nspname = 'public' AND c.relname = $1
         AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped`,
      [rel]
    );
    const typ = (idCol.rows[0]?.typ || '').toLowerCase();
    const def = String(idCol.rows[0]?.def || '').trim();
    if (!typ || def.length > 0) return;

    if (typ === 'uuid') {
      await query(`ALTER TABLE "${rel}" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`);
    } else if (
      typ === 'text' ||
      typ.includes('varchar') ||
      typ.includes('character varying')
    ) {
      await query(
        `ALTER TABLE "${rel}" ALTER COLUMN "id" SET DEFAULT (gen_random_uuid()::text)`
      );
    } else if (typ === 'integer' || typ === 'bigint' || typ === 'smallint') {
      const seq = `"${rel}_id_seq"`;
      await query(`CREATE SEQUENCE IF NOT EXISTS ${seq}`);
      const maxResult = await query(`SELECT COALESCE(MAX("id")::bigint, 0) AS mx FROM "${rel}"`);
      const maxId = Number(maxResult.rows[0]?.mx ?? 0);
      await query(`SELECT setval('${seq}', $1)`, [Math.max(1, maxId + 1)]);
      await query(`ALTER SEQUENCE ${seq} OWNED BY "${rel}"."id"`);
      await query(`ALTER TABLE "${rel}" ALTER COLUMN "id" SET DEFAULT nextval('${seq}')`);
    }
  } catch (err) {
    console.warn(`[db] ensureTableIdDefault(${tableName}):`, err.message);
  }
}

/**
 * Withdrawal + BankAccount tables/columns for legacy Supabase schemas. Idempotent.
 */
export async function ensureWithdrawalDbSchema() {
  if (!pool) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS "BankAccount" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL UNIQUE,
        "accountNumber" VARCHAR(20) NOT NULL,
        "bankCode" VARCHAR(20) NOT NULL,
        "accountName" VARCHAR(255) NOT NULL,
        "bankName" VARCHAR(255) NOT NULL,
        "recipientCode" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`ALTER TABLE "BankAccount" ADD COLUMN IF NOT EXISTS "userId" TEXT`);
    await query(`ALTER TABLE "BankAccount" ADD COLUMN IF NOT EXISTS "recipientCode" TEXT`);
    await query(`
      CREATE TABLE IF NOT EXISTS "Withdrawal" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "eventId" TEXT NOT NULL,
        "grossAmount" NUMERIC(14, 2) NOT NULL DEFAULT 0,
        "platformFee" NUMERIC(14, 2) NOT NULL DEFAULT 0,
        "amount" NUMERIC(14, 2) NOT NULL DEFAULT 0,
        "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
        "paystackReference" VARCHAR(255),
        "payoutMethod" VARCHAR(32),
        "bankName" VARCHAR(255),
        "bankCode" VARCHAR(20),
        "accountNumber" VARCHAR(20),
        "accountName" VARCHAR(255),
        "reviewedBy" TEXT,
        "reviewedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const alters = [
      `ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "userId" TEXT`,
      `ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "grossAmount" NUMERIC(14, 2) NOT NULL DEFAULT 0`,
      `ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "platformFee" NUMERIC(14, 2) NOT NULL DEFAULT 0`,
      `ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "amount" NUMERIC(14, 2) NOT NULL DEFAULT 0`,
      `ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "status" VARCHAR(32) NOT NULL DEFAULT 'pending'`,
      `ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "paystackReference" VARCHAR(255)`,
      `ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "payoutMethod" VARCHAR(32)`,
      `ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "bankName" VARCHAR(255)`,
      `ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "bankCode" VARCHAR(20)`,
      `ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "accountNumber" VARCHAR(20)`,
      `ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "accountName" VARCHAR(255)`,
      `ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT`,
      `ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMPTZ`,
      `ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
      `ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    ];
    for (const sql of alters) {
      await query(sql).catch(() => ({}));
    }
    await query(`ALTER TABLE "BankAccount" ALTER COLUMN "userId" TYPE TEXT USING "userId"::text`).catch(
      () => ({})
    );
    await query(`ALTER TABLE "Withdrawal" ALTER COLUMN "userId" TYPE TEXT USING "userId"::text`).catch(
      () => ({})
    );
    await query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'Withdrawal' AND column_name = 'adminId'
        ) THEN
          UPDATE "Withdrawal"
          SET "userId" = "adminId"::text
          WHERE ("userId" IS NULL OR trim("userId") = '')
            AND "adminId" IS NOT NULL;
        END IF;
      END $$
    `).catch(() => ({}));
    await ensureTableIdDefault('BankAccount');
    await ensureTableIdDefault('Withdrawal');
  } catch (err) {
    console.warn('[db] ensureWithdrawalDbSchema:', err.message);
  }
}

/** Event streaming + multi-image columns for legacy Supabase schemas. Idempotent. */
export async function ensureEventStreamingSchema() {
  if (!pool) return;
  try {
    const eventAlters = [
      `ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "imageUrls" JSONB DEFAULT '[]'::jsonb`,
      `ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "endDate" DATE`,
      `ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "endTime" VARCHAR(50)`,
      `ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "venue" VARCHAR(512)`,
      `ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "category" VARCHAR(255)`,
      `ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "eventType" VARCHAR(50) DEFAULT 'in-person'`,
      `ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "streamUrl" VARCHAR(1024)`,
      `ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "streamProvider" VARCHAR(50) DEFAULT 'youtube'`,
      `ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "isLive" BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "liveStartedAt" TIMESTAMPTZ`,
    ];
    for (const sql of eventAlters) {
      await query(sql).catch(() => ({}));
    }
    await query(
      `ALTER TABLE "Event" ALTER COLUMN "createdAt" SET DEFAULT NOW()`
    ).catch(() => ({}));
    await query(
      `ALTER TABLE "Event" ALTER COLUMN "updatedAt" SET DEFAULT NOW()`
    ).catch(() => ({}));
    await query(
      `ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS "deliveryMode" VARCHAR(50) DEFAULT 'in_person'`
    ).catch(() => ({}));
    await query(
      `ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS "contactEmail" VARCHAR(255)`
    ).catch(() => ({}));
    await query(
      `ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS "contactPhone" VARCHAR(50)`
    ).catch(() => ({}));
    await query(`
      CREATE TABLE IF NOT EXISTS "StreamAccess" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
        "eventId" TEXT NOT NULL REFERENCES "Event"("id") ON DELETE CASCADE,
        "email" VARCHAR(255) NOT NULL,
        "token" VARCHAR(128) NOT NULL UNIQUE,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(() => ({}));
    await query(
      `CREATE INDEX IF NOT EXISTS "StreamAccess_eventId_idx" ON "StreamAccess" ("eventId")`
    ).catch(() => ({}));
    await query(
      `CREATE INDEX IF NOT EXISTS "StreamAccess_orderId_idx" ON "StreamAccess" ("orderId")`
    ).catch(() => ({}));
    await ensureTableIdDefault('Event');
  } catch (err) {
    console.warn('[db] ensureEventStreamingSchema:', err.message);
  }
}

/**
 * Copy legacy "password" hashes into "passwordHash" for accounts created before the column rename.
 * Idempotent; safe on every startup.
 */
export async function ensureUserPasswordCompat() {
  if (!pool) return;
  try {
    const col = await query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'password'`
    );
    if (col.rows.length === 0) return;

    const updated = await query(
      `UPDATE "User"
       SET "passwordHash" = "password", "updatedAt" = NOW()
       WHERE ("passwordHash" IS NULL OR TRIM("passwordHash") = '')
         AND "password" IS NOT NULL
         AND TRIM("password") <> ''`
    );
    if (updated.rowCount > 0) {
      console.log(`[db] Migrated ${updated.rowCount} legacy user password(s) to passwordHash`);
    }
  } catch (err) {
    console.warn('[db] ensureUserPasswordCompat:', err.message);
  }
}

export async function ensureTopUserSchema() {
  if (!pool) return;
  try {
    const exists = await query(
      `SELECT 1 FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = 'TopUser'`
    );
    if (exists.rows.length === 0) return;

    await query(
      'ALTER TABLE "TopUser" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN DEFAULT TRUE'
    );
    await query(
      'ALTER TABLE "TopUser" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ DEFAULT NOW()'
    );
    await query(
      'ALTER TABLE "TopUser" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ DEFAULT NOW()'
    );
    await query('UPDATE "TopUser" SET "isActive" = TRUE WHERE "isActive" IS NULL');

    const idCol = await query(
      `SELECT a.atttypid::regtype::text AS typ,
              COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '') AS def
       FROM pg_attribute a
       JOIN pg_class c ON a.attrelid = c.oid
       JOIN pg_namespace n ON c.relnamespace = n.oid
       LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
       WHERE n.nspname = 'public' AND c.relname = 'TopUser'
         AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped`
    );
    const typ = (idCol.rows[0]?.typ || '').toLowerCase();
    const def = String(idCol.rows[0]?.def || '').trim();
    const hasDefault = def.length > 0;

    if (!hasDefault && typ) {
      if (typ === 'uuid') {
        await query('ALTER TABLE "TopUser" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()');
      } else if (
        typ === 'text' ||
        typ.includes('varchar') ||
        typ.includes('character varying')
      ) {
        await query(
          'ALTER TABLE "TopUser" ALTER COLUMN "id" SET DEFAULT (gen_random_uuid()::text)'
        );
      } else if (typ === 'integer' || typ === 'bigint' || typ === 'smallint') {
        await query('CREATE SEQUENCE IF NOT EXISTS "TopUser_id_seq"');
        const maxResult = await query('SELECT COALESCE(MAX("id")::bigint, 0) AS mx FROM "TopUser"');
        const maxId = Number(maxResult.rows[0]?.mx ?? 0);
        await query('SELECT setval(\'"TopUser_id_seq"\', $1)', [Math.max(1, maxId + 1)]);
        await query('ALTER SEQUENCE "TopUser_id_seq" OWNED BY "TopUser"."id"');
        await query(
          'ALTER TABLE "TopUser" ALTER COLUMN "id" SET DEFAULT nextval(\'"TopUser_id_seq"\')'
        );
      }
    }
  } catch (err) {
    console.warn('[db] ensureTopUserSchema:', err.message);
  }
}

export async function disconnectDb() {
  if (pool) await pool.end();
}

export { pool };
