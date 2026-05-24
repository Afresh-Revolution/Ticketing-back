-- Paystack transfer recipient on admin bank accounts (withdrawal payouts)
-- Run: psql $DATABASE_URL -f backend/sql/002_paystack_recipient.sql

ALTER TABLE "BankAccount" ADD COLUMN IF NOT EXISTS "recipientCode" VARCHAR(255);

COMMENT ON COLUMN "BankAccount"."recipientCode" IS 'Paystack transfer recipient code for automated withdrawal payouts';
