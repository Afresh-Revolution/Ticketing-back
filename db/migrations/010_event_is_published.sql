-- Add visibility toggle: events can be hidden from the public without deleting.
-- Run against Supabase (e.g. psql "$DATABASE_URL" -f db/migrations/010_event_is_published.sql)

ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "isPublished" BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN "Event"."isPublished" IS 'When true, event is visible on the public side; when false, hidden (e.g. after event ends).';
