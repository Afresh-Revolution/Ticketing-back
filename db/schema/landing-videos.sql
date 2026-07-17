-- Landing videos for home "Atmosphere" section
CREATE TABLE IF NOT EXISTS "LandingVideo" (
  "id" text PRIMARY KEY,
  "videoUrl" text NOT NULL,
  "thumbnailUrl" text,
  "publicId" text,
  "externalUrl" text,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "isActive" boolean NOT NULL DEFAULT TRUE,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "LandingVideo_sortOrder_idx" ON "LandingVideo" ("sortOrder");
CREATE INDEX IF NOT EXISTS "LandingVideo_isActive_idx" ON "LandingVideo" ("isActive");

ALTER TABLE "LandingVideo" ADD COLUMN IF NOT EXISTS "externalUrl" text;
