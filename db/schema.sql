-- Gatewave Ticketing – PostgreSQL schema
-- Run with: psql $DATABASE_URL -f db/schema.sql
-- Or from app: node -e "require('pg').Client(...).query(require('fs').readFileSync('db/schema.sql','utf8'))"

-- Extensions (optional, for gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users
CREATE TABLE IF NOT EXISTS "User" (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  password   TEXT NOT NULL,
  name       TEXT,
  role       TEXT NOT NULL DEFAULT 'user', -- 'user', 'admin', 'superadmin'
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hero section (landing)
CREATE TABLE IF NOT EXISTS "HeroSection" (
  id                 TEXT PRIMARY KEY,
  headline           TEXT NOT NULL,
  subtitle           TEXT NOT NULL,
  "ctaText"          TEXT NOT NULL,
  "ctaHref"          TEXT NOT NULL DEFAULT '/events',
  "backgroundImageUrl" TEXT,
  "logoText"         TEXT NOT NULL DEFAULT 'GATEWAVE',
  "logoImageUrl"     TEXT,
  "navLinks"         JSONB,
  "signInButtonText" TEXT NOT NULL DEFAULT 'Sign In',
  "signInButtonHref" TEXT NOT NULL DEFAULT '/signin',
  "featuredItems"    JSONB,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Events
CREATE TABLE IF NOT EXISTS "Event" (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  date        TIMESTAMPTZ NOT NULL,
  venue       TEXT,
  "imageUrl"  TEXT,
  category    TEXT,
  "startTime" TEXT,
  price       INTEGER,
  currency    TEXT,
  "isTrending" BOOLEAN DEFAULT FALSE,
  location    TEXT,
  "createdBy" TEXT REFERENCES "User"(id),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tickets
CREATE TABLE IF NOT EXISTS "Ticket" (
  id         TEXT PRIMARY KEY,
  "eventId"  TEXT NOT NULL REFERENCES "Event"(id) ON DELETE CASCADE,
  "userId"   TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  email      TEXT NOT NULL,
  quantity   INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "Ticket_eventId_idx" ON "Ticket"("eventId");
CREATE INDEX IF NOT EXISTS "Ticket_userId_idx" ON "Ticket"("userId");

-- Optional: trigger to auto-update "updatedAt" (EXECUTE PROCEDURE works in all PG versions)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_updated_at ON "User";
CREATE TRIGGER user_updated_at BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS herosection_updated_at ON "HeroSection";
CREATE TRIGGER herosection_updated_at BEFORE UPDATE ON "HeroSection" FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS event_updated_at ON "Event";
CREATE TRIGGER event_updated_at BEFORE UPDATE ON "Event" FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS ticket_updated_at ON "Ticket";

-- Membership Plans (Packages)
CREATE TABLE IF NOT EXISTS "MembershipPlan" (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  price       INTEGER NOT NULL, -- in kobo/smallest currency unit
  currency    TEXT NOT NULL DEFAULT 'NGN',
  duration    TEXT NOT NULL, -- 'monthly', 'yearly'
  description TEXT,
  "isActive"  BOOLEAN DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User Memberships
CREATE TABLE IF NOT EXISTS "Membership" (
  id                 TEXT PRIMARY KEY,
  "userId"           TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "planId"           TEXT REFERENCES "MembershipPlan"(id) ON DELETE SET NULL,
  "startDate"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "endDate"          TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active', -- 'active', 'expired', 'cancelled', 'suspended'
  "paystackReference" TEXT,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Triggers for updatedAt
DROP TRIGGER IF EXISTS membershipplan_updated_at ON "MembershipPlan";
CREATE TRIGGER membershipplan_updated_at BEFORE UPDATE ON "MembershipPlan" FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS membership_updated_at ON "Membership";
CREATE TRIGGER membership_updated_at BEFORE UPDATE ON "Membership" FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Ensure Event has createdBy (idempotent for existing DBs)
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "createdBy" TEXT REFERENCES "User"(id);

-- Bank account details per admin (withdrawals)
CREATE TABLE IF NOT EXISTS "BankAccount" (
  id              TEXT PRIMARY KEY,
  "userId"        TEXT NOT NULL UNIQUE REFERENCES "User"(id) ON DELETE CASCADE,
  "accountName"   TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "bankCode"      TEXT NOT NULL,
  "bankName"      TEXT NOT NULL,
  "recipientCode" TEXT,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Withdrawal records
CREATE TABLE IF NOT EXISTS "Withdrawal" (
  id                  TEXT PRIMARY KEY,
  "eventId"           TEXT NOT NULL REFERENCES "Event"(id) ON DELETE CASCADE,
  "adminId"           TEXT NOT NULL,
  "grossAmount"       NUMERIC(12,2) NOT NULL,
  "platformFee"       NUMERIC(12,2) NOT NULL,
  "netAmount"         NUMERIC(12,2) NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  "paystackReference" TEXT,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ticket types (pools) per event
CREATE TABLE IF NOT EXISTS "TicketType" (
  id         TEXT PRIMARY KEY,
  "eventId"  TEXT NOT NULL REFERENCES "Event"(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  description TEXT,
  price      INTEGER NOT NULL DEFAULT 0,
  quantity   INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Orders
CREATE TABLE IF NOT EXISTS "Order" (
  id           TEXT PRIMARY KEY,
  "eventId"    TEXT NOT NULL REFERENCES "Event"(id),
  "userId"     TEXT REFERENCES "User"(id),
  "fullName"   TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT,
  address      TEXT,
  "totalAmount" INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  reference    TEXT,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Order items (ticket type + quantity)
CREATE TABLE IF NOT EXISTS "OrderItem" (
  id             TEXT PRIMARY KEY,
  "orderId"      TEXT NOT NULL REFERENCES "Order"(id) ON DELETE CASCADE,
  "ticketTypeId" TEXT NOT NULL REFERENCES "TicketType"(id),
  quantity       INTEGER NOT NULL,
  price          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "TicketType_eventId_idx" ON "TicketType"("eventId");
CREATE INDEX IF NOT EXISTS "Order_eventId_idx" ON "Order"("eventId");
CREATE INDEX IF NOT EXISTS "Order_userId_idx" ON "Order"("userId");
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");

DROP TRIGGER IF EXISTS bankaccount_updated_at ON "BankAccount";
CREATE TRIGGER bankaccount_updated_at BEFORE UPDATE ON "BankAccount" FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS withdrawal_updated_at ON "Withdrawal";
CREATE TRIGGER withdrawal_updated_at BEFORE UPDATE ON "Withdrawal" FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS tickettype_updated_at ON "TicketType";
CREATE TRIGGER tickettype_updated_at BEFORE UPDATE ON "TicketType" FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

DROP TRIGGER IF EXISTS order_updated_at ON "Order";
CREATE TRIGGER order_updated_at BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
