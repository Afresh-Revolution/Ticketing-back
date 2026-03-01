-- Admin change password: rate limit once per month.
-- Add column to track when the admin last changed their password.
-- If column is missing, run: ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMPTZ NULL;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMPTZ NULL;

-- When an admin changes password via POST /api/admin/change-password, set "passwordChangedAt" = NOW().
-- They can only change again after 30 days (enforced in application code).
