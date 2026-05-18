-- Withdrawal + bank account tables (also auto-created on first withdraw API call)

CREATE TABLE IF NOT EXISTS "BankAccount" (
  "id" SERIAL PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "accountNumber" VARCHAR(20) NOT NULL,
  "bankCode" VARCHAR(20) NOT NULL,
  "accountName" VARCHAR(255) NOT NULL,
  "bankName" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Withdrawal" (
  "id" SERIAL PRIMARY KEY,
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
  "reviewedBy" INTEGER,
  "reviewedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Withdrawal_userId_idx" ON "Withdrawal" ("userId");
CREATE INDEX IF NOT EXISTS "Withdrawal_eventId_idx" ON "Withdrawal" ("eventId");
CREATE INDEX IF NOT EXISTS "Withdrawal_status_idx" ON "Withdrawal" ("status");

-- Upgrade legacy Withdrawal tables (safe to re-run)
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "grossAmount" NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "platformFee" NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "bankName" VARCHAR(255);
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "bankCode" VARCHAR(20);
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "accountNumber" VARCHAR(20);
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "accountName" VARCHAR(255);
UPDATE "Withdrawal" SET "userId" = "adminId"::text WHERE ("userId" IS NULL OR "userId" = '') AND "adminId" IS NOT NULL;
