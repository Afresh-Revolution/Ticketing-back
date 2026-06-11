-- Reservation ticket contact fields + event end date/time (idempotent, safe on existing DBs)

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "endDate" DATE;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "endTime" VARCHAR(50);

ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS "contactEmail" VARCHAR(255);
ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS "contactPhone" VARCHAR(50);
