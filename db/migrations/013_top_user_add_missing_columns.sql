-- Backfill "TopUser" for databases created before schema alignment (missing "isActive", etc.)
ALTER TABLE "TopUser" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN DEFAULT TRUE;
ALTER TABLE "TopUser" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE "TopUser" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ DEFAULT NOW();

UPDATE "TopUser" SET "isActive" = TRUE WHERE "isActive" IS NULL;
