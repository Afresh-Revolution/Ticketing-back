-- Recurring events + optional end date metadata.
-- Resolves the Event table by exact/case-insensitive name so quoted PascalCase
-- ("Event") and legacy lowercase variants all work on Supabase/Postgres.

DO $$
DECLARE
  event_reg regclass;
  event_schema text;
  event_table text;
  event_ident text;
  category_col text;
BEGIN
  -- Prefer the canonical quoted PascalCase table used by this codebase.
  event_reg := to_regclass('public."Event"');

  -- Fallbacks for legacy / unquoted names.
  IF event_reg IS NULL THEN
    event_reg := to_regclass('public.event');
  END IF;
  IF event_reg IS NULL THEN
    event_reg := to_regclass('public.events');
  END IF;
  IF event_reg IS NULL THEN
    SELECT c.oid::regclass
    INTO event_reg
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND lower(c.relname) IN ('event', 'events')
    ORDER BY CASE WHEN n.nspname = 'public' THEN 0 ELSE 1 END, c.relname
    LIMIT 1;
  END IF;

  IF event_reg IS NULL THEN
    RAISE EXCEPTION
      'Event table not found. Expected public."Event" (or event/events). Run db/schema.sql first, then re-run this migration.';
  END IF;

  SELECT n.nspname, c.relname
  INTO event_schema, event_table
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.oid = event_reg::oid;

  -- Always quote identifiers so PascalCase "Event" stays accurate.
  event_ident := format('%I.%I', event_schema, event_table);

  EXECUTE format(
    'ALTER TABLE %s ADD COLUMN IF NOT EXISTS %I BOOLEAN NOT NULL DEFAULT false',
    event_ident, 'isRecurring'
  );
  EXECUTE format(
    'ALTER TABLE %s ADD COLUMN IF NOT EXISTS %I TEXT NOT NULL DEFAULT %L',
    event_ident, 'recurrenceFrequency', 'none'
  );
  EXECUTE format(
    'ALTER TABLE %s ADD COLUMN IF NOT EXISTS %I TEXT NULL',
    event_ident, 'recurrenceWeekday'
  );
  EXECUTE format(
    'ALTER TABLE %s ADD COLUMN IF NOT EXISTS %I TIMESTAMPTZ NULL',
    event_ident, 'recurrenceUntil'
  );

  -- Keep / add optional end fields (nullable).
  EXECUTE format(
    'ALTER TABLE %s ADD COLUMN IF NOT EXISTS %I DATE',
    event_ident, 'endDate'
  );
  EXECUTE format(
    'ALTER TABLE %s ADD COLUMN IF NOT EXISTS %I VARCHAR(50)',
    event_ident, 'endTime'
  );

  BEGIN
    EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP NOT NULL', event_ident, 'endDate');
  EXCEPTION
    WHEN undefined_column THEN NULL;
    WHEN feature_not_supported THEN NULL;
  END;

  BEGIN
    EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP NOT NULL', event_ident, 'endTime');
  EXCEPTION
    WHEN undefined_column THEN NULL;
    WHEN feature_not_supported THEN NULL;
  END;

  -- Category column may be missing on older schemas.
  EXECUTE format(
    'ALTER TABLE %s ADD COLUMN IF NOT EXISTS %I VARCHAR(255)',
    event_ident, 'category'
  );

  EXECUTE format(
    'COMMENT ON COLUMN %s.%I IS %L',
    event_ident, 'isRecurring',
    'When true, event repeats per recurrenceFrequency'
  );
  EXECUTE format(
    'COMMENT ON COLUMN %s.%I IS %L',
    event_ident, 'recurrenceFrequency',
    'none | daily | weekly | biweekly | monthly'
  );
  EXECUTE format(
    'COMMENT ON COLUMN %s.%I IS %L',
    event_ident, 'recurrenceWeekday',
    'monday..sunday when weekly/biweekly'
  );
  EXECUTE format(
    'COMMENT ON COLUMN %s.%I IS %L',
    event_ident, 'recurrenceUntil',
    'Optional series end; used for past/upcoming when recurring'
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %s (%I)',
    event_table || '_isRecurring_idx',
    event_ident,
    'isRecurring'
  );

  SELECT a.attname
  INTO category_col
  FROM pg_attribute a
  WHERE a.attrelid = event_reg::oid
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND lower(a.attname) = 'category'
  LIMIT 1;

  IF category_col IS NOT NULL THEN
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %s (LOWER(TRIM(%I)))',
      event_table || '_category_idx',
      event_ident,
      category_col
    );
  END IF;

  RAISE NOTICE 'Applied recurrence columns on %.%', event_schema, event_table;
END $$;
