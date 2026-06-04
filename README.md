# Ticketing-back — Merch module

PostgreSQL schema and Express routes for event merch (online purchase, at-event save requests, admin dashboard).

## Setup

1. Run migration against your PostgreSQL database:

```bash
psql "$DATABASE_URL" -f migrations/002_event_merch.sql
```

2. Mount the router in your main Express app:

```js
import { createMerchRouter, insertMerchForEvent } from './src/merch/routes.js';

app.use(createMerchRouter({
  pool,
  authAdmin: yourAdminMiddleware,
  authOptional: yourOptionalAuthMiddleware,
  sendEmail: yourSendEmailFn,
  paystack: { initialize, verify },
  getAdminEmailsForEvent: async (eventId) => ['admin@example.com'],
}));
```

3. When creating/updating events, after inserting the event row:

```js
if (body.merch?.length) {
  await insertMerchForEvent(pool, event.id, body.merch);
}
```

4. Include merch on public event detail:

```js
const merch = await fetchMerchByEventId(pool, eventId);
res.json({ ...event, merch });
```

## API (added by this module)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/events/:eventId/merch` | List merch for event |
| POST | `/api/events/:eventId/merch` | Replace merch (admin) |
| POST | `/api/merch-orders` | Create merch order |
| POST | `/api/merch-orders/initialize-payment` | Paystack redirect |
| POST | `/api/merch-orders/verify` | Verify Paystack return |
| POST | `/api/merch-orders/manual-payment-notify` | Notify admin (pending) |
| POST | `/api/merch-save-requests` | At-event save request |
| GET | `/api/admin/merch-orders` | Admin merch sales |
| PATCH | `/api/admin/merch-orders/:id/status` | Mark paid/pending |
| GET | `/api/admin/merch-save-requests` | Pending save requests |
| PATCH | `/api/admin/merch-save-requests/:id/status` | Approve/reject |

Event create payload may include `merch: [...]` array (same shape as POST merch body).
