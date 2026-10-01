import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL || process.env.DIRECT_URL || '';
if (!url) {
  console.error('No DATABASE_URL');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
});

function maskEmail(email) {
  const s = String(email || '');
  const [user, domain] = s.split('@');
  if (!domain) return '(none)';
  const u = user.length <= 2 ? `${user[0] || ''}*` : `${user.slice(0, 2)}***`;
  return `${u}@${domain}`;
}

await client.connect();
try {
  const events = await client.query(
    `SELECT id::text AS id, title FROM "Event"
     WHERE title ILIKE '%chappy%' OR title ILIKE '%chap%'
     ORDER BY "createdAt" DESC LIMIT 20`
  );
  console.log('CHAPPY_EVENTS', JSON.stringify(events.rows, null, 2));

  const statuses = await client.query(
    `SELECT COALESCE(LOWER(TRIM(status)), '(null)') AS status, COUNT(*)::int AS n
     FROM "Order"
     WHERE "createdAt" >= NOW() - INTERVAL '3 days'
     GROUP BY 1
     ORDER BY n DESC`
  );
  console.log('STATUS_LAST_3_DAYS', JSON.stringify(statuses.rows, null, 2));

  const recent = await client.query(
    `SELECT o.id::text AS id, e.title, o.status, o."totalAmount", o.reference,
            o."ticketCode" IS NOT NULL AS has_ticket,
            o."userId" IS NOT NULL AS has_user,
            o."createdAt", o.email
     FROM "Order" o
     LEFT JOIN "Event" e ON e.id::text = o."eventId"::text
     WHERE o."createdAt" >= NOW() - INTERVAL '2 days'
        OR e.title ILIKE '%chappy%'
     ORDER BY o."createdAt" DESC
     LIMIT 50`
  );
  console.log(
    'RECENT_ORDERS',
    JSON.stringify(
      recent.rows.map((r) => ({
        id: String(r.id).slice(0, 8) + '…',
        title: r.title,
        status: r.status,
        amount: r.totalAmount,
        has_ticket: r.has_ticket,
        has_user: r.has_user,
        createdAt: r.createdAt,
        email: maskEmail(r.email),
        ref: r.reference ? `${String(r.reference).slice(0, 16)}…` : null,
      })),
      null,
      2
    )
  );
} finally {
  await client.end();
}
