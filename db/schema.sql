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

-- Ensure username exists (e.g. if User was created by an older schema)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" VARCHAR(255);
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
  "startTime" VARCHAR(50),
  "description" TEXT,
  "organizer" VARCHAR(255),
  "createdBy" INTEGER REFERENCES "User"("id"),
  "isPublished" BOOLEAN DEFAULT TRUE,
  "isTrending" BOOLEAN DEFAULT FALSE,
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
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "TicketType_eventId_idx" ON "TicketType" ("eventId");

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
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ticketCode" VARCHAR(255);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "venue" VARCHAR(512);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "category" VARCHAR(255);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "currency" VARCHAR(10);
ALTER TABLE "TopUser" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ DEFAULT NOW();
