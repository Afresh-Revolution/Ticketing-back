import 'dotenv/config';
import pg from 'pg';

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('No DATABASE_URL');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const eventLike = await client.query(`
  SELECT n.nspname AS schema, c.relname AS name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND lower(c.relname) LIKE '%event%'
  ORDER BY 1, 2
`);
console.log('event-like tables:', eventLike.rows);

const quoted = await client.query(`SELECT to_regclass('public."Event"') AS event_pascal, to_regclass('public.event') AS event_lower, to_regclass('public.events') AS events`);
console.log('regclass checks:', quoted.rows[0]);

const publicTables = await client.query(`
  SELECT tablename
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename
`);
console.log('public tables:', publicTables.rows.map((r) => r.tablename));

await client.end();
