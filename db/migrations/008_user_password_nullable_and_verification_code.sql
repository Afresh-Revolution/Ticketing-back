-- Fix: align DB schema with auth.controller.js usage
-- - Make "User"."password" nullable if it exists & is NOT NULL (we use "passwordHash" instead)
-- - Ensure "VerificationCode" table exists with the columns used in code
--
-- On Render production:
--   psql "$DATABASE_URL" -f db/migrations/008_user_password_nullable_and_verification_code.sql

DO $$
BEGIN
  -- If the "User" table has a NOT NULL "password" column, drop the constraint
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'User'
      AND column_name = 'password'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;
  END IF;
END $$;

-- Create VerificationCode table if it doesn't exist yet.
-- This matches the fields used in auth.controller.js:
--   email, code, type, expiresAt, createdAt (for ordering)
CREATE TABLE IF NOT EXISTS "VerificationCode" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

