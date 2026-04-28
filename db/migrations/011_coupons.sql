-- Coupons: admin-owned event discounts
CREATE TABLE IF NOT EXISTS "Coupon" (
  "id" TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "createdBy" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "discountType" TEXT NOT NULL DEFAULT 'percentage',
  "discountValue" INTEGER NOT NULL DEFAULT 0,
  "maxUses" INTEGER,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "expiresAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ("discountType" IN ('percentage', 'fixed')),
  CHECK ("discountValue" >= 0),
  CHECK ("maxUses" IS NULL OR "maxUses" >= 1),
  CHECK ("usedCount" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "Coupon_eventId_code_unique"
  ON "Coupon" ("eventId", "code");

CREATE INDEX IF NOT EXISTS "Coupon_eventId_idx" ON "Coupon" ("eventId");
CREATE INDEX IF NOT EXISTS "Coupon_createdBy_idx" ON "Coupon" ("createdBy");
CREATE INDEX IF NOT EXISTS "Coupon_code_idx" ON "Coupon" ("code");

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "couponId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "couponCode" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "originalAmount" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "discountAmount" INTEGER NOT NULL DEFAULT 0;
