# Ticketing-back

Backend for Gatewav Ticketing: auth, membership plans, organizer flow, and email (receipt + OTP).

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
     - `RESEND_API_KEY` and `RESEND_FROM` – for sending emails (receipt, OTP)
     - `FRONTEND_BASE_URL` – base URL of the frontend (e.g. `http://localhost:5173`) for links in emails
     - `PAYSTACK_SECRET_KEY` – for verifying membership payments

3. **Database**
   - Create a PostgreSQL database and run the schema:
     ```bash
     psql "$DATABASE_URL" -f db/schema.sql
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

## Schema (db/schema.sql)

- **User** – id, email, name, passwordHash, role, emailVerified
- **VerificationCode** – email, code, type, expiresAt (for signup, password reset, organizer OTP)
- **MembershipPlan** – name, price (kobo), currency, duration, description, isActive
- **Membership** – userId, planId, status, startDate, endDate, paystackReference

Run `db/schema.sql` to create/update tables. If you already have a `User` table, you may need to add columns `emailVerified` and `role` (see comments in schema).

## API (relevant to membership & organizer flow)

| Method | Path                           | Auth        | Description                                                                                                    |
| ------ | ------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------- |
| POST   | /api/auth/signin               | —           | Sign in (returns JWT or requiresOtp)                                                                           |
| POST   | /api/auth/signup               | —           | Register (sends signup OTP)                                                                                    |
| POST   | /api/auth/forgot-password      | —           | Send password reset OTP                                                                                        |
| POST   | /api/auth/reset-password       | —           | Reset password with code                                                                                       |
| POST   | /api/auth/resend-verification  | —           | Resend signup OTP                                                                                              |
| POST   | /api/auth/create-admin         | Super Admin | Create admin (name, email, password)                                                                           |
| POST   | /api/auth/organizer-signup     | —           | Register as organizer (username, email, password); requires active membership for email; sends OTP             |
| POST   | /api/auth/organizer-verify-otp | —           | Verify organizer OTP; sets emailVerified                                                                       |
| GET    | /api/memberships/plans         | —           | List active plans (?all=true for all)                                                                          |
| POST   | /api/memberships/plans         | Super Admin | Create plan                                                                                                    |
| PATCH  | /api/memberships/plans/:id     | Super Admin | Update plan (name, price, duration, isActive, etc.)                                                            |
| POST   | /api/memberships               | User JWT    | Create membership (planId, paystackReference); verifies Paystack, sends receipt email with organizer form link |
| GET    | /api/memberships/my            | Admin JWT   | Current user's active subscription                                                                             |
| POST   | /api/memberships/cancel        | Admin JWT   | Cancel subscription                                                                                            |
| POST   | /api/memberships/resubscribe   | Admin JWT   | Resubscribe                                                                                                    |

After successful membership payment, the backend sends an email with the receipt and a link to `FRONTEND_BASE_URL/#/organizer-form`. Organizer signup is only allowed for emails with an active membership.
