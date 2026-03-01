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

-- Optional: add columns to User if upgrading existing DB
-- ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN DEFAULT FALSE;
-- ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" VARCHAR(50) DEFAULT 'user';
-- ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" VARCHAR(255);
-- ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastPasswordChangeAt" TIMESTAMPTZ;
