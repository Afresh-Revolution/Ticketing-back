-- Top users carousel (landing page) – managed from admin
CREATE TABLE IF NOT EXISTS "TopUser" (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  title       TEXT,
  "imageUrl"  TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
