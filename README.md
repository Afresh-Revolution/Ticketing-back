# Ticketing-back (API)

GateWav ticketing API. Run from this folder when developing with the frontend in the parent repo.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with database and secrets
```

## Run

```bash
npm run dev
```

API listens on `http://localhost:3000` by default.

## Frontend

From the parent `Ticketing` folder, Vite uses `http://localhost:3000` in dev unless `VITE_API_URL` is set.

```bash
cd ..
npm run dev
```

## My Tickets (`GET /api/user/orders`)

Returns paid orders for the signed-in user where either:

- `Order.userId` matches the account, or
- `Order.email` matches the account email (case-insensitive), including guest checkouts

On each request, guest orders with a matching email are linked to the account (`userId` backfill).

Fallback route: `GET /api/orders` (same handler).

Optional migration for faster email lookups:

```bash
# run 009_order_email_lower_idx.sql against your database
```

## Recent API behaviour

- **Withdrawals:** Multiple payouts per event while balance remains; `POST /api/admin/withdraw/:eventId` uses remaining gross (85% net), not full event total.
- **Withdraw page:** `GET /api/admin/withdraw` returns `available_to_withdraw` per event.
- **Manual checkout:** Pending orders get `manual-{orderId}` reference; admin sales list shows each order.
- **Events:** `GET /api/events/:id` includes `createdByName` / `organizer`.
