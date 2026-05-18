-- Withdrawal + bank account tables
-- The API always supplies a UUID "id" on insert (works with TEXT/UUID PKs).
-- SERIAL id columns: omit id and let the sequence assign.

CREATE TABLE IF NOT EXISTS "BankAccount" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "accountNumber" VARCHAR(20) NOT NULL,
  "bankCode" VARCHAR(20) NOT NULL,
  "accountName" VARCHAR(255) NOT NULL,
  "bankName" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Withdrawal" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "grossAmount" NUMERIC(14, 2) NOT NULL DEFAULT 0,
  "platformFee" NUMERIC(14, 2) NOT NULL DEFAULT 0,
  "amount" NUMERIC(14, 2) NOT NULL DEFAULT 0,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "paystackReference" VARCHAR(255),
  "bankName" VARCHAR(255),
  "bankCode" VARCHAR(20),
  "accountNumber" VARCHAR(20),
  "accountName" VARCHAR(255),
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Withdrawal_userId_idx" ON "Withdrawal" ("userId");
CREATE INDEX IF NOT EXISTS "Withdrawal_eventId_idx" ON "Withdrawal" ("eventId");
CREATE INDEX IF NOT EXISTS "Withdrawal_status_idx" ON "Withdrawal" ("status");

-- Upgrade legacy tables (safe to re-run)
ALTER TABLE "BankAccount" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "grossAmount" NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "platformFee" NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "amount" NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "status" VARCHAR(32) NOT NULL DEFAULT 'pending';
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "bankName" VARCHAR(255);
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "bankCode" VARCHAR(20);
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "accountNumber" VARCHAR(20);
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "accountName" VARCHAR(255);
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMPTZ;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Legacy schemas may have INTEGER "userId"; convert before any string comparisons
ALTER TABLE "BankAccount" ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;
ALTER TABLE "Withdrawal" ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;

-- Backfill userId from legacy adminId column (only when that column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Withdrawal' AND column_name = 'adminId'
  ) THEN
    UPDATE "Withdrawal"
    SET "userId" = "adminId"::text
    WHERE ("userId" IS NULL OR trim("userId") = '')
      AND "adminId" IS NOT NULL;
  END IF;
END $$;

-- Legacy INTEGER "id" PKs without defaults (prevents null value in column "id" on INSERT)
DO $$
DECLARE
  rel text;
  typ text;
  def text;
  seq text;
  mx bigint;
BEGIN
  FOREACH rel IN ARRAY ARRAY['BankAccount', 'Withdrawal'] LOOP
    SELECT a.atttypid::regtype::text, COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '')
    INTO typ, def
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relname = rel AND a.attname = 'id'
      AND a.attnum > 0 AND NOT a.attisdropped;
    IF typ IS NULL OR length(trim(def)) > 0 THEN
      CONTINUE;
    END IF;
    IF typ IN ('integer', 'bigint', 'smallint') THEN
      seq := rel || '_id_seq';
      EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', seq);
      EXECUTE format('SELECT COALESCE(MAX("id")::bigint, 0) FROM %I', rel) INTO mx;
      EXECUTE format('SELECT setval(%L, %s)', seq, GREATEST(1, mx + 1));
      EXECUTE format('ALTER SEQUENCE %I OWNED BY %I."id"', seq, rel);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN "id" SET DEFAULT nextval(%L)', rel, seq);
    ELSIF typ = 'uuid' THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN "id" SET DEFAULT gen_random_uuid()', rel);
    ELSIF typ IN ('text', 'character varying') THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN "id" SET DEFAULT (gen_random_uuid()::text)', rel);
    END IF;
  END LOOP;
END $$;
