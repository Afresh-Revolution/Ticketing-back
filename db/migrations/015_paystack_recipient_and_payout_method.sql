-- Paystack transfer recipient on bank accounts + payout method on withdrawals
-- Run: psql $DATABASE_URL -f db/migrations/015_paystack_recipient_and_payout_method.sql

ALTER TABLE "BankAccount" ADD COLUMN IF NOT EXISTS "recipientCode" TEXT;

ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "payoutMethod" VARCHAR(32);

CREATE INDEX IF NOT EXISTS "Withdrawal_payoutMethod_idx" ON "Withdrawal" ("payoutMethod");
