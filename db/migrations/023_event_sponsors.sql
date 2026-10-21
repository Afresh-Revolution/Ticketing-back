-- Optional sponsor names and logos on an event. Image is optional.
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "sponsors" JSONB DEFAULT '[]'::jsonb;
