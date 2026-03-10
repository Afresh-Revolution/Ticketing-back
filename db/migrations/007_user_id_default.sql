-- Fix: ensure "User"."id" has a default so INSERT without id does not violate not-null
-- Run this if you see: null value in column "id" of relation "User" violates not-null constraint
-- On Render: run this against your production DB (e.g. from local: psql $DATABASE_URL -f db/migrations/007_user_id_default.sql)

-- Use pg_catalog so we match the actual "User" table (quoted name); information_schema lowercases names
DO $$
DECLARE
  col_type regtype;
BEGIN
  SELECT a.atttypid::regtype INTO col_type
  FROM pg_attribute a
  JOIN pg_class c ON a.attrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public' AND c.relname = 'User'
    AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped;

  IF col_type IS NULL THEN
    RETURN;
  END IF;

  IF col_type::text IN ('integer', 'bigint', 'smallint') THEN
    CREATE SEQUENCE IF NOT EXISTS "User_id_seq";
    PERFORM setval(
      '"User_id_seq"',
      GREATEST(1, COALESCE((SELECT MAX("id") FROM "User"), 0)::bigint)
    );
    ALTER SEQUENCE "User_id_seq" OWNED BY "User"."id";
    ALTER TABLE "User" ALTER COLUMN "id" SET DEFAULT nextval('"User_id_seq"');
  ELSIF col_type::text = 'uuid' THEN
    ALTER TABLE "User" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
  END IF;
END $$;
