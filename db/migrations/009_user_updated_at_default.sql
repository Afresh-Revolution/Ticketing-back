-- On Render production:
--   psql "$DATABASE_URL" -f db/migrations/009_user_updated_at_default.sql

DO $$
BEGIN
  -- Only act if the column exists
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'User'
      AND column_name = 'updatedAt'
  ) THEN
    -- Backfill any existing NULLs (prefer createdAt if present)
    EXECUTE '
      UPDATE "User"
      SET "updatedAt" = COALESCE("updatedAt", "createdAt", NOW())
      WHERE "updatedAt" IS NULL
    ';

    -- Ensure inserts that omit updatedAt succeed
    EXECUTE 'ALTER TABLE "User" ALTER COLUMN "updatedAt" SET DEFAULT NOW()';
  END IF;
END $$;