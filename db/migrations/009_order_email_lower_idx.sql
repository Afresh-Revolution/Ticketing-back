-- Speed up My Tickets lookups by buyer email (case-insensitive match uses LOWER(TRIM(email)))
CREATE INDEX IF NOT EXISTS "Order_email_lower_idx" ON "Order" (LOWER(TRIM(email)));
