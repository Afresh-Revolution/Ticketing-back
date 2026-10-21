import { readFile } from 'node:fs/promises';
import { getPool } from '../../shared/config/db.js';

let ready = false;

export async function ensureGatewav2Schema() {
  const pool = getPool();
  if (!pool || ready) return;
  const sql = await readFile(new URL('../../../db/migrations/024_gatewav_2.sql', import.meta.url), 'utf8');
  const client = await pool.connect();
  try {
    await client.query(sql);
    ready = true;
  } catch (err) {
    console.error('[gatewav2] schema ensure failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

export function isGatewav2Ready() {
  return ready;
}
