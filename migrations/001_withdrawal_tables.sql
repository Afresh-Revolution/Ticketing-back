-- Withdrawal + bank account tables
-- The API always supplies a UUID "id" on insert (works with TEXT/UUID PKs).
-- SERIAL id columns: omit id and let the sequence assign.

CREATE TABLE IF NOT EXISTS "BankAccount" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "accountNumber" VARCHAR(20) NOT NULL,
  "bankCode" VARCHAR(20) NOT NULL,
  "accountName" VARCHAR(255) NOT NULL,
  "bankName" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Withdrawal" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "grossAmount" NUMERIC(14, 2) NOT NULL DEFAULT 0,
  "platformFee" NUMERIC(14, 2) NOT NULL DEFAULT 0,
  "amount" NUMERIC(14, 2) NOT NULL DEFAULT 0,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "paystackReference" VARCHAR(255),
  "bankName" VARCHAR(255),
  "bankCode" VARCHAR(20),
  "accountNumber" VARCHAR(20),
  "accountName" VARCHAR(255),
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Withdrawal_userId_idx" ON "Withdrawal" ("userId");
CREATE INDEX IF NOT EXISTS "Withdrawal_eventId_idx" ON "Withdrawal" ("eventId");
CREATE INDEX IF NOT EXISTS "Withdrawal_status_idx" ON "Withdrawal" ("status");

-- Upgrade legacy tables (safe to re-run)
ALTER TABLE "BankAccount" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "grossAmount" NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "platformFee" NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "amount" NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "status" VARCHAR(32) NOT NULL DEFAULT 'pending';
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "bankName" VARCHAR(255);
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "bankCode" VARCHAR(20);
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "accountNumber" VARCHAR(20);
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "accountName" VARCHAR(255);
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMPTZ;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Legacy schemas may have INTEGER "userId"; convert before any string comparisons
ALTER TABLE "BankAccount" ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;
ALTER TABLE "Withdrawal" ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;

-- Backfill userId from legacy adminId column (only when that column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Withdrawal' AND column_name = 'adminId'
  ) THEN
    UPDATE "Withdrawal"
    SET "userId" = "adminId"::text
    WHERE ("userId" IS NULL OR trim("userId") = '')
      AND "adminId" IS NOT NULL;
  END IF;
END $$;
