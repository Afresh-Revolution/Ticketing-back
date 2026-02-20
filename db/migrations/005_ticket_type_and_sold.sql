-- Add ticket type: 'paid' or 'free' (free tickets do not require payment)
ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'paid';
-- Backfill: price 0 => free
UPDATE "TicketType" SET type = 'free' WHERE price = 0 AND (type IS NULL OR type = 'paid');
