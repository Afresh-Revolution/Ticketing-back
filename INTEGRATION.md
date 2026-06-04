# Integrating merch into your existing Ticketing API

## 1. Database

```bash
psql "$DATABASE_URL" -f migrations/002_event_merch.sql
```

## 2. Mount routes

```js
import { createMerchRouter, insertMerchForEvent, fetchMerchByEventId } from './src/merch/routes.js';

app.use(createMerchRouter({
  pool,
  authAdmin: requireAdmin,
  authOptional: optionalUser,
  sendEmail: sendMail,
  paystack: paystackClient,
  getAdminEmailsForEvent: async (eventId) => { /* organizer + super admins */ },
}));
```

## 3. Event create (`POST /api/events`)

After inserting the event:

```js
if (Array.isArray(req.body.merch) && req.body.merch.length) {
  await insertMerchForEvent(pool, event.id, req.body.merch);
}
```

## 4. Event detail (`GET /api/events/:id`)

```js
const merch = await fetchMerchByEventId(pool, req.params.id);
res.json({ ...event, merch });
```

## 5. Deploy

Redeploy the API on Render (or your host) so the frontend calls succeed.

The GateWav frontend already sends `merch` on create and calls all `/api/merch-*` endpoints documented in `README.md`.
