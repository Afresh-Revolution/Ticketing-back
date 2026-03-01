const { Pool } = require('pg');
const config = require('./config/env');

const pool = config.databaseUrl
  ? new Pool({ connectionString: config.databaseUrl })
  : null;

async function query(text, params) {
  if (!pool) throw new Error('DATABASE_URL is not set');
  return pool.query(text, params);
}

module.exports = { query, pool };
