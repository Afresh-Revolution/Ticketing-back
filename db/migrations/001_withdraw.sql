-- Gatewave Ticketing – Withdraw Feature Migration
-- Run with: psql $DATABASE_URL -f db/migrations/001_withdraw.sql

-- 1. Add createdBy to Event (if not already present)
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;

-- 2. Bank account details per admin user
CREATE TABLE IF NOT EXISTS "BankAccount" (
  id              TEXT PRIMARY KEY,
  "userId"        TEXT NOT NULL UNIQUE,
  "accountName"   TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "bankCode"      TEXT NOT NULL,
  "bankName"      TEXT NOT NULL,
  "recipientCode" TEXT,          -- Paystack transfer recipient code
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Withdrawal records
CREATE TABLE IF NOT EXISTS "Withdrawal" (
  id                  TEXT PRIMARY KEY,
  "eventId"           TEXT NOT NULL REFERENCES "Event"(id) ON DELETE CASCADE,
  "adminId"           TEXT NOT NULL,
  "grossAmount"       NUMERIC(12,2) NOT NULL,
  "platformFee"       NUMERIC(12,2) NOT NULL,
  "netAmount"         NUMERIC(12,2) NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  "paystackReference" TEXT,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Triggers for updatedAt
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bankaccount_updated_at ON "BankAccount";
CREATE TRIGGER bankaccount_updated_at
  BEFORE UPDATE ON "BankAccount"
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS withdrawal_updated_at ON "Withdrawal";
CREATE TRIGGER withdrawal_updated_at
  BEFORE UPDATE ON "Withdrawal"
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
