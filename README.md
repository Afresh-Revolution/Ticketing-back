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

## Recent API behaviour

- **Withdrawals:** Multiple payouts per event while balance remains; `POST /api/admin/withdraw/:eventId` uses remaining gross (85% net), not full event total.
- **Withdraw page:** `GET /api/admin/withdraw` returns `available_to_withdraw` per event.
- **Manual checkout:** Pending orders get `manual-{orderId}` reference; admin sales list shows each order.
- **Events:** `GET /api/events/:id` includes `createdByName` / `organizer`.
