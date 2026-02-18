import pg from 'pg';
import fs from 'fs';
import 'dotenv/config';

const { Pool } = pg;
const url = process.env.DATABASE_URL || '';
const isRemote = url && !url.includes('localhost');
const connStr =
  isRemote && url.includes('sslmode=') && !url.includes('uselibpqcompat=')
    ? url.includes('?')
      ? `${url}&uselibpqcompat=true`
      : `${url}?uselibpqcompat=true`
    : url;

const pool = new Pool({
  connectionString: connStr,
  ssl: isRemote ? { rejectUnauthorized: false } : false,
});

const sql = fs.readFileSync('./db/migrations/001_withdraw.sql', 'utf8');

try {
  await pool.query(sql);
  console.log('✅ Migration successful!');
} catch (err) {
  console.error('❌ Migration error:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
