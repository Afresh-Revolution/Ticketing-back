import { readFile } from 'node:fs/promises';
import { getPool } from '../../shared/config/db.js';

let ready = false;

export async function ensureGatewav2Schema(options = {}) {
  const pool = getPool();
  if (!pool || (ready && !options.force)) return;
  const sql = await readFile(new URL('../../../db/migrations/024_gatewav_2.sql', import.meta.url), 'utf8');
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.split('\n').some((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('--');
    }));
  const client = await pool.connect();
  let failed = 0;
  try {
    for (const statement of statements) {
      try {
        await client.query(statement);
      } catch (err) {
        failed += 1;
        console.error('[gatewav2] schema statement failed:', err.message);
      }
    }
    ready = failed === 0;
  } finally {
    client.release();
  }
}

export function isGatewav2Ready() {
  return ready;
}
