-- Ensure phone number is available for checkout orders and admin sales views.
ALTER TABLE "Order"
ADD COLUMN IF NOT EXISTS phone TEXT;
