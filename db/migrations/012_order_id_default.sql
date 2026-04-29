-- Ensure Order.id auto-generates when omitted (safety fallback)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "Order"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
