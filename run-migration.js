import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from './src/shared/config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  const client = new pg.Client({
    connectionString: config.databaseUrl,
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const migrationSQL = readFileSync(
      join(__dirname, 'db/migrations/001_add_role_to_user.sql'),
      'utf8'
    );

    console.log('Running migration...');
    await client.query(migrationSQL);
    console.log('✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
