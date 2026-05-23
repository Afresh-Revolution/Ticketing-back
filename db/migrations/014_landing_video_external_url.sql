-- Optional link to watch full video elsewhere (YouTube, Vimeo, etc.)
ALTER TABLE "LandingVideo" ADD COLUMN IF NOT EXISTS "externalUrl" text;
