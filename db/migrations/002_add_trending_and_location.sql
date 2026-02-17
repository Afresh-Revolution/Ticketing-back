-- Migration to add isTrending and location columns to Event table
-- Run this in Supabase SQL Editor

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "isTrending" BOOLEAN DEFAULT FALSE;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS location TEXT;

-- Add comments
COMMENT ON COLUMN "Event"."isTrending" IS 'Whether the event is promoted to the trending section';
COMMENT ON COLUMN "Event".location IS 'Display location string (e.g. Venue, City)';
