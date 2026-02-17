# Setup & troubleshooting

## Current stack

- **Runtime:** Node.js (ES modules)
- **Server:** Express
- **Database:** PostgreSQL via `pg` (no ORM). Schema is defined in `db/schema.sql`.

## Required environment

- **`DATABASE_URL`** – PostgreSQL connection string (e.g. Supabase, Neon, or local).
- **`JWT_SECRET`** – Used for signing auth tokens (use a strong value in production).

Optional: `PORT`, `NODE_ENV`, `CORS_ORIGIN`, `JWT_EXPIRES_IN`.

## Common issues

### Database not connected

- Ensure `DATABASE_URL` is set in `.env`.
- Run the schema once: `npm run db:schema`.
- For cloud Postgres (Supabase/Neon), the app accepts self-signed certificates; no extra config needed.

### Self-signed certificate in certificate chain

If `db:schema` or `db:seed` fails with this error, the code already uses `rejectUnauthorized: false` for non-localhost URLs. If it still fails, check that `.env` is loaded (scripts use `dotenv/config`) and that `DATABASE_URL` is correct.

### Fresh clone / first run

1. `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and `JWT_SECRET`.
3. `npm run db:schema`
4. `npm run db:seed` (optional)
5. `npm run dev`

## Summary

| Goal              | Command / check                    |
|-------------------|------------------------------------|
| Create tables     | `npm run db:schema`                |
| Seed default data | `npm run db:seed`                  |
| Start server      | `npm run dev` or `npm start`       |
| Health check      | `GET http://localhost:3000/health` |
