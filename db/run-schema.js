import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Split SQL into single statements (handles $$ function bodies). */
function splitSql(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  let i = 0;
  const lines = sql.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--')) continue;
    if (inDollarQuote) {
      current += (current ? '\n' : '') + line;
      if (trimmed.includes('$$')) {
        statements.push(current.trim());
        current = '';
        inDollarQuote = false;
      }
      continue;
    }
    if (trimmed.includes('$$')) {
      inDollarQuote = true;
      current = (current ? current + '\n' : '') + line;
      if (trimmed.includes('$$') && trimmed.indexOf('$$') !== trimmed.lastIndexOf('$$')) {
        statements.push(current.trim());
        current = '';
        inDollarQuote = false;
      } else if (trimmed.endsWith(';')) {
        statements.push(current.trim());
        current = '';
        inDollarQuote = false;
      }
      continue;
    }
    if (trimmed.endsWith(';')) {
      current += (current ? '\n' : '') + line;
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = '';
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter((s) => s.length > 0);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const needsAcceptSelfSigned =
    /sslmode=|supabase|neon\.|render\.com|amazonaws\.com/i.test(connectionString) ||
    (!connectionString.includes('localhost') && !connectionString.includes('127.0.0.1'));
  const pool = new pg.Pool({
    connectionString,
    ssl: needsAcceptSelfSigned ? { rejectUnauthorized: false } : false,
  });
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  const statements = splitSql(sql);
  const client = await pool.connect();
  try {
    for (const stmt of statements) {
      if (!stmt) continue;
      await client.query(stmt);
    }
    console.log('Schema applied successfully.');
  } catch (err) {
    console.error('Schema error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
