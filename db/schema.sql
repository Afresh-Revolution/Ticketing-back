-- Gatewav Ticketing – schema for User, VerificationCode, Event, Order, etc.
-- Run: psql $DATABASE_URL -f db/schema.sql
-- Or: npm run db:schema (with DATABASE_URL in .env)

-- Users (attendees + admins/organizers)
-- Organizer signup form: username → name (and optional username), email, password → passwordHash, role='admin', emailVerified after OTP
CREATE TABLE IF NOT EXISTS "User" (
  "id" SERIAL PRIMARY KEY,
  "email" VARCHAR(255) NOT NULL UNIQUE,
  "name" VARCHAR(255),
  "username" VARCHAR(255),
  "passwordHash" VARCHAR(255),
  "role" VARCHAR(50) DEFAULT 'user',
  "emailVerified" BOOLEAN DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure columns exist (e.g. if User was created by an older schema)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" VARCHAR(255);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" VARCHAR(255);
CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User" ("email");
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User" ("role");
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_idx" ON "User" ("username") WHERE "username" IS NOT NULL;

-- Verification codes (OTP for signup, forgot password, organizer verify)
-- type = 'organizer_verify' for Become an Organizer OTP
CREATE TABLE IF NOT EXISTS "VerificationCode" (
  "id" SERIAL PRIMARY KEY,
  "email" VARCHAR(255) NOT NULL,
  "code" VARCHAR(10) NOT NULL,
  "type" VARCHAR(50) NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "VerificationCode_email_type_idx" ON "VerificationCode" ("email", "type");

-- Events
CREATE TABLE IF NOT EXISTS "Event" (
  "id" SERIAL PRIMARY KEY,
  "title" VARCHAR(255) NOT NULL,
  "date" DATE,
  "location" VARCHAR(255),
  "price" INTEGER DEFAULT 0,
  "imageUrl" VARCHAR(512),
  "imageUrls" JSONB DEFAULT '[]'::jsonb,
  "startTime" VARCHAR(50),
  "endDate" DATE,
  "endTime" VARCHAR(50),
  "description" TEXT,
  "organizer" VARCHAR(255),
  "createdBy" INTEGER REFERENCES "User"("id"),
  "isPublished" BOOLEAN DEFAULT TRUE,
  "isTrending" BOOLEAN DEFAULT FALSE,
  "eventType" VARCHAR(50) DEFAULT 'in-person',
  "streamUrl" VARCHAR(1024),
  "streamProvider" VARCHAR(50) DEFAULT 'youtube',
  "isLive" BOOLEAN DEFAULT FALSE,
  "liveStartedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Orders (ticket purchases)
CREATE TABLE IF NOT EXISTS "Order" (
  "id" SERIAL PRIMARY KEY,
  "eventId" INTEGER REFERENCES "Event"("id") ON DELETE SET NULL,
  "userId" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
  "fullName" VARCHAR(255),
  "email" VARCHAR(255),
  "phone" VARCHAR(50),
  "address" TEXT,
  "totalAmount" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(50) DEFAULT 'pending',
  "reference" VARCHAR(255),
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Order_eventId_idx" ON "Order" ("eventId");
CREATE INDEX IF NOT EXISTS "Order_userId_idx" ON "Order" ("userId");

-- Events: index by creator for admin-scoped listing
CREATE INDEX IF NOT EXISTS "Event_createdBy_idx" ON "Event" ("createdBy");
CREATE INDEX IF NOT EXISTS "Event_isTrending_idx" ON "Event" ("isTrending") WHERE "isTrending" = TRUE;

-- Top users (landing carousel)
CREATE TABLE IF NOT EXISTS "TopUser" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "title" VARCHAR(255),
  "imageUrl" VARCHAR(512),
  "sortOrder" INTEGER DEFAULT 0,
  "isActive" BOOLEAN DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Bank account (for admin withdrawals)
CREATE TABLE IF NOT EXISTS "BankAccount" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "accountNumber" VARCHAR(50),
  "bankCode" VARCHAR(20),
  "accountName" VARCHAR(255),
  "bankName" VARCHAR(255),
  "recipientCode" VARCHAR(255),
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE("userId")
);

-- Withdrawals
CREATE TABLE IF NOT EXISTS "Withdrawal" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES "User"("id"),
  "eventId" INTEGER REFERENCES "Event"("id"),
  "amount" INTEGER DEFAULT 0,
  "status" VARCHAR(50) DEFAULT 'pending',
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Ticket types per event (e.g. VIP, General Admission) – must exist before OrderItem
-- id is UUID to match app createId() in event.model
CREATE TABLE IF NOT EXISTS "TicketType" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "eventId" INTEGER NOT NULL REFERENCES "Event"("id") ON DELETE CASCADE,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "price" INTEGER NOT NULL DEFAULT 0,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "type" VARCHAR(50) DEFAULT 'paid',
  "deliveryMode" VARCHAR(50) DEFAULT 'in_person',
  "contactEmail" VARCHAR(255),
  "contactPhone" VARCHAR(50),
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "TicketType_eventId_idx" ON "TicketType" ("eventId");

-- Automatic quantity discounts per ticket type. Highest eligible tier applies.
-- Additive only: does not mutate existing Event / TicketType / Order row values.
CREATE TABLE IF NOT EXISTS "TicketDiscountTier" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "ticketTypeId" TEXT NOT NULL,
  "minimumQuantity" INTEGER NOT NULL CHECK ("minimumQuantity" >= 2),
  "discountPercent" NUMERIC(5, 2) NOT NULL
    CHECK ("discountPercent" > 0 AND "discountPercent" <= 100),
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE ("ticketTypeId", "minimumQuantity")
);

CREATE INDEX IF NOT EXISTS "TicketDiscountTier_ticketTypeId_idx"
  ON "TicketDiscountTier" ("ticketTypeId", "minimumQuantity");

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
    RETURN;
  END IF;
  DROP TRIGGER IF EXISTS "TicketType_delete_discount_tiers" ON "TicketType";
  CREATE TRIGGER "TicketType_delete_discount_tiers"
    BEFORE DELETE ON "TicketType"
    FOR EACH ROW
    EXECUTE PROCEDURE delete_ticket_discount_tiers();
END $$;

-- Paid attendee stream access tokens (emailed on go-live)
CREATE TABLE IF NOT EXISTS "StreamAccess" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "eventId" TEXT NOT NULL REFERENCES "Event"("id") ON DELETE CASCADE,
  "email" VARCHAR(255) NOT NULL,
  "token" VARCHAR(128) NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "StreamAccess_eventId_idx" ON "StreamAccess" ("eventId");
CREATE INDEX IF NOT EXISTS "StreamAccess_orderId_idx" ON "StreamAccess" ("orderId");
CREATE INDEX IF NOT EXISTS "StreamAccess_token_idx" ON "StreamAccess" ("token");

-- Order items (line items per order, one per ticket type)
CREATE TABLE IF NOT EXISTS "OrderItem" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" INTEGER NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "ticketTypeId" UUID NOT NULL REFERENCES "TicketType"("id") ON DELETE SET NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "price" INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem" ("orderId");
CREATE INDEX IF NOT EXISTS "OrderItem_ticketTypeId_idx" ON "OrderItem" ("ticketTypeId");

-- Tickets (issued per booking)
CREATE TABLE IF NOT EXISTS "Ticket" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "eventId" INTEGER NOT NULL REFERENCES "Event"("id") ON DELETE CASCADE,
  "userId" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
  "email" VARCHAR(255),
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Ticket_eventId_idx" ON "Ticket" ("eventId");
CREATE INDEX IF NOT EXISTS "Ticket_userId_idx" ON "Ticket" ("userId");

-- Membership plans (subscription tiers)
CREATE TABLE IF NOT EXISTS "MembershipPlan" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(255) NOT NULL,
  "price" INTEGER NOT NULL DEFAULT 0,
  "currency" VARCHAR(10) DEFAULT 'NGN',
  "duration" VARCHAR(50),
  "description" TEXT,
  "isActive" BOOLEAN DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- User memberships (subscriptions)
CREATE TABLE IF NOT EXISTS "Membership" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "planId" UUID NOT NULL REFERENCES "MembershipPlan"("id") ON DELETE SET NULL,
  "status" VARCHAR(50) DEFAULT 'pending',
  "startDate" TIMESTAMPTZ,
  "endDate" TIMESTAMPTZ,
  "paystackReference" VARCHAR(255),
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Membership_userId_idx" ON "Membership" ("userId");
CREATE INDEX IF NOT EXISTS "Membership_planId_idx" ON "Membership" ("planId");

-- Hero section config (landing page)
CREATE TABLE IF NOT EXISTS "HeroSection" (
  "id" SERIAL PRIMARY KEY,
  "logoText" VARCHAR(255),
  "logoImageUrl" VARCHAR(512),
  "navLinks" JSONB,
  "signInButtonText" VARCHAR(255),
  "signInButtonHref" VARCHAR(512),
  "backgroundImageUrl" VARCHAR(512),
  "headline" TEXT,
  "subtitle" TEXT,
  "ctaText" VARCHAR(255),
  "ctaHref" VARCHAR(512),
  "featuredItems" JSONB,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- Scan log (gate check-ins)
CREATE TABLE IF NOT EXISTS "ScanLog" (
  "id" SERIAL PRIMARY KEY,
  "orderId" INTEGER NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "scannedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "ScanLog_orderId_idx" ON "ScanLog" ("orderId");

-- Add missing columns to existing tables (safe for existing DBs)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMPTZ;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastPasswordChangeAt" TIMESTAMPTZ;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "suspended" BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS "User_suspended_idx" ON "User" ("suspended") WHERE "suspended" = TRUE;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ticketCode" VARCHAR(255);
-- New column only; existing order amounts/status/items are left unchanged.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "quantityDiscountAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "venue" VARCHAR(512);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "category" VARCHAR(255);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "currency" VARCHAR(10);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "isPublished" BOOLEAN DEFAULT TRUE;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "isTrending" BOOLEAN DEFAULT FALSE;
ALTER TABLE "TopUser" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ DEFAULT NOW();

-- Ensure VerificationCode.id always has a default (app inserts without id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'VerificationCode' AND c.column_name = 'id'
    AND c.data_type IN ('integer', 'bigint', 'smallint')
  ) THEN
    EXECUTE 'CREATE SEQUENCE IF NOT EXISTS "VerificationCode_id_seq"';
    EXECUTE 'ALTER TABLE "VerificationCode" ALTER COLUMN "id" SET DEFAULT nextval(''"VerificationCode_id_seq"'')';
    EXECUTE 'ALTER SEQUENCE "VerificationCode_id_seq" OWNED BY "VerificationCode"."id"';
    EXECUTE 'SELECT setval(''"VerificationCode_id_seq"'', GREATEST(1, COALESCE((SELECT MAX("id") FROM "VerificationCode"), 0)::bigint))';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'VerificationCode' AND c.column_name = 'id'
  ) THEN
    IF (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'VerificationCode' AND column_name = 'id') = 'uuid' THEN
      EXECUTE 'ALTER TABLE "VerificationCode" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()';
    ELSE
      EXECUTE 'ALTER TABLE "VerificationCode" ALTER COLUMN "id" SET DEFAULT (gen_random_uuid()::text)';
    END IF;
  END IF;
END $$;

-- Walk-in sales: manual ticket purchases recorded by admin at the event venue
CREATE TABLE IF NOT EXISTS "WalkInSale" (
  "id" SERIAL PRIMARY KEY,
  "eventId" TEXT NOT NULL REFERENCES "Event"("id") ON DELETE CASCADE,
  "fullName" VARCHAR(255) NOT NULL,
  "email" VARCHAR(255),
  "phone" VARCHAR(50),
  "ticketType" VARCHAR(255) DEFAULT 'General',
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "amount" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(50) DEFAULT 'pending',
  "notes" TEXT,
  "recordedBy" TEXT REFERENCES "User"("id"),
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "WalkInSale_eventId_idx" ON "WalkInSale" ("eventId");
CREATE INDEX IF NOT EXISTS "WalkInSale_status_idx" ON "WalkInSale" ("status");
CREATE INDEX IF NOT EXISTS "WalkInSale_recordedBy_idx" ON "WalkInSale" ("recordedBy");
