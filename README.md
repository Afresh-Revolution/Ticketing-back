# Ticketing-back

Backend for Gatewav Ticketing: auth, organizer (Become an Organizer) flow, and email (OTP).

## Setup

1. **Install dependencies**

   ```bash
   cd Ticketing-back
   npm install
   ```

2. **Environment**
   - Copy `.env.example` to `.env` and set:
     - `DATABASE_URL` – PostgreSQL connection string
     - `JWT_SECRET` – secret for signing admin/organizer JWTs
     - `RESEND_API_KEY` and `RESEND_FROM` – for sending OTP emails
     - `FRONTEND_BASE_URL` – base URL of the frontend (e.g. `http://localhost:5173`) for links in emails

3. **Database**
   - Create a PostgreSQL database and run the schema:
     ```bash
     psql "$DATABASE_URL" -f db/schema.sql
     ```
   - For organizer signup only (e.g. adding `username` to existing DB):
     ```bash
     psql "$DATABASE_URL" -f db/schema-organizer.sql
     ```
   - Or with npm (if `psql` is on your PATH):
     ```bash
     npm run db:schema
     ```

4. **Run**
   ```bash
   npm run dev
   ```
   Server listens on `PORT` (default 3000).

## Schema (Become an Organizer)

- **db/schema.sql** – Main schema. **User** (id, email, name, username, passwordHash, role, emailVerified) and **VerificationCode** (email, code, type, expiresAt). Organizer form fields: username → `name`, email → `email`, password → `passwordHash`; after OTP, `emailVerified` = true, `role` = 'admin'.
- **db/schema-organizer.sql** – Optional migration: adds `username` to User and documents organizer OTP type `organizer_verify`.

Verify auth is up: `GET https://your-api/api/auth/health` returns `{ ok: true, endpoints: [...] }`.

## API (organizer flow)

| Method | Path                           | Auth | Description |
| ------ | ------------------------------ | ---- | ----------- |
| POST   | /api/auth/organizer-signup     | —    | Register as organizer (username, email, password). Sends OTP to email. |
| POST   | /api/auth/organizer-verify-otp | —    | Verify OTP (email, otp). Sets emailVerified so user can sign in at admin login. |
| GET    | /api/auth/health              | —    | Returns { ok, endpoints } to confirm auth routes are loaded. |

Other auth: signin, signup, forgot-password, reset-password, resend-verification, create-admin (Super Admin).

## Deploy (e.g. Render)

1. Deploy the repo and set env vars (including `DATABASE_URL`, `JWT_SECRET`, `RESEND_*`, `FRONTEND_BASE_URL`).
2. Run the schema against the production DB (e.g. `psql $DATABASE_URL -f db/schema.sql`).
3. After deploy, check `GET https://your-service/api/auth/health` – you should see `organizer-signup` and `organizer-verify-otp` in the list. If you get 404 on `POST /api/auth/organizer-signup`, redeploy so the latest routes are live.
