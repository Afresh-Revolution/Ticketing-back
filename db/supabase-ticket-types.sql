-- Run this in Supabase SQL Editor to enable ticket types (admin-created tickets showing on event detail).
-- Safe to run multiple times (idempotent).

-- 1. Ensure Event has createdBy (for admin ownership)
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "createdBy" TEXT REFERENCES "User"(id);

-- 2. Ticket types (pools) per event – created from admin "Ticket Types" / "Ticket Pool" UI
CREATE TABLE IF NOT EXISTS "TicketType" (
  id         TEXT PRIMARY KEY,
  "eventId"  TEXT NOT NULL REFERENCES "Event"(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  description TEXT,
  price      INTEGER NOT NULL DEFAULT 0,
  quantity   INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "TicketType_eventId_idx" ON "TicketType"("eventId");

-- 3. updatedAt trigger for TicketType
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickettype_updated_at ON "TicketType";
CREATE TRIGGER tickettype_updated_at
  BEFORE UPDATE ON "TicketType"
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
