-- Top users (landing carousel) – matches db/schema.sql "TopUser"
CREATE TABLE IF NOT EXISTS "TopUser" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "title" VARCHAR(255),
  "imageUrl" VARCHAR(512),
  "sortOrder" INTEGER DEFAULT 0,
  "isActive" BOOLEAN DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE "TopUser" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ DEFAULT NOW();
