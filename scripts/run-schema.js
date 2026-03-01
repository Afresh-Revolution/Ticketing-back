import 'dotenv/config';
import { execSync } from 'child_process';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL required');
  process.exit(1);
}
execSync(`psql "${url.replace(/"/g, '\\"')}" -f db/schema.sql`, { stdio: 'inherit' });
