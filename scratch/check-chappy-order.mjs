import 'dotenv/config';
import pg from 'pg';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const url = process.env.DATABASE_URL || process.env.DIRECT_URL || '';
const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const { rows } = await client.query(
  `SELECT o.status, o."totalAmount", o."ticketCode" IS NOT NULL AS has_ticket,
          o."userId" IS NOT NULL AS has_user, e.title
   FROM "Order" o
   LEFT JOIN "Event" e ON e.id::text = o."eventId"::text
   WHERE o.id = $1`,
  ['8f826a86-6766-4dbe-8e0a-a435e83c6d4c']
);
console.log(JSON.stringify(rows, null, 2));
await client.end();
