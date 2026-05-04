-- Backfill "TopUser" for older databases (optional manual run).
-- On server boot, ensureTopUserSchema() adds these columns and repairs missing "id" defaults
-- (TEXT → gen_random_uuid()::text, INTEGER → TopUser_id_seq) based on actual column types.

ALTER TABLE "TopUser" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN DEFAULT TRUE;
ALTER TABLE "TopUser" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE "TopUser" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ DEFAULT NOW();

UPDATE "TopUser" SET "isActive" = TRUE WHERE "isActive" IS NULL;
