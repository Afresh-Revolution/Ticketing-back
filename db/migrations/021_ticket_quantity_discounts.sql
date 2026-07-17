-- Quantity discount tiers per ticket type.
-- Additive only: creates new objects / one new Order column.
-- Does not UPDATE, DELETE, or rewrite any existing business rows.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "TicketDiscountTier" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  -- TEXT supports both legacy TEXT and UUID TicketType ids.
  "ticketTypeId" TEXT NOT NULL,
  "minimumQuantity" INTEGER NOT NULL,
  "discountPercent" NUMERIC(5, 2) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "TicketDiscountTier_minimumQuantity_check"
    CHECK ("minimumQuantity" >= 2),
  CONSTRAINT "TicketDiscountTier_discountPercent_check"
    CHECK ("discountPercent" > 0 AND "discountPercent" <= 100),
  CONSTRAINT "TicketDiscountTier_ticketType_quantity_key"
    UNIQUE ("ticketTypeId", "minimumQuantity")
);

CREATE INDEX IF NOT EXISTS "TicketDiscountTier_ticketTypeId_idx"
  ON "TicketDiscountTier" ("ticketTypeId", "minimumQuantity");

-- Cleanup helper for future TicketType deletes only (does not touch existing rows now).
CREATE OR REPLACE FUNCTION delete_ticket_discount_tiers()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM "TicketDiscountTier"
  WHERE "ticketTypeId" = OLD."id"::text;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public."TicketType"') IS NULL THEN
    RAISE NOTICE 'TicketType table not found; skipping discount cleanup trigger';
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS "TicketType_delete_discount_tiers" ON "TicketType";
  CREATE TRIGGER "TicketType_delete_discount_tiers"
    BEFORE DELETE ON "TicketType"
    FOR EACH ROW
    EXECUTE PROCEDURE delete_ticket_discount_tiers();
END $$;

-- Existing Order rows keep all prior values; only a new column is added with default 0.
DO $$
BEGIN
  IF to_regclass('public."Order"') IS NULL THEN
    RAISE NOTICE 'Order table not found; skipping quantityDiscountAmount column';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Order'
      AND column_name = 'quantityDiscountAmount'
  ) THEN
    ALTER TABLE "Order"
      ADD COLUMN "quantityDiscountAmount" INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

COMMIT;
