-- Organizer signup: tables and columns used by "Become an Organizer" form
-- Form fields: username, email, password, confirm password → then OTP
-- Run after main schema: psql $DATABASE_URL -f db/schema-organizer.sql

-- Ensure User table has columns for organizer signup:
--   username (optional; form "username" is also stored in "name")
--   name     → organizer display name / username
--   email    → unique, required
--   passwordHash → bcrypt hash
--   role     → 'admin' for organizers
--   emailVerified → false until OTP verified

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_idx" ON "User" ("username") WHERE "username" IS NOT NULL;

-- VerificationCode must support type 'organizer_verify' for OTP
-- Columns: email, code, type, expiresAt (type = 'organizer_verify')

-- No additional tables required; main schema.sql already defines User and VerificationCode.
