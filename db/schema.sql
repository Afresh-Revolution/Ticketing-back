-- Gatewav Ticketing – schema for User, VerificationCode, MembershipPlan, Membership
-- Run: psql $DATABASE_URL -f db/schema.sql
-- Or: npm run db:schema (with DATABASE_URL in .env)

-- Users (attendees + admins/organizers)
CREATE TABLE IF NOT EXISTS "User" (
  "id" SERIAL PRIMARY KEY,
  "email" VARCHAR(255) NOT NULL UNIQUE,
  "name" VARCHAR(255),
  "passwordHash" VARCHAR(255),
  "role" VARCHAR(50) DEFAULT 'user',
  "emailVerified" BOOLEAN DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User" ("email");
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User" ("role");

-- Verification codes (OTP for signup, forgot password, organizer verify)
CREATE TABLE IF NOT EXISTS "VerificationCode" (
  "id" SERIAL PRIMARY KEY,
  "email" VARCHAR(255) NOT NULL,
  "code" VARCHAR(10) NOT NULL,
  "type" VARCHAR(50) NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "VerificationCode_email_type_idx" ON "VerificationCode" ("email", "type");

-- Membership plans (yearly/monthly)
CREATE TABLE IF NOT EXISTS "MembershipPlan" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "price" INTEGER NOT NULL,
  "currency" VARCHAR(10) DEFAULT 'NGN',
  "duration" VARCHAR(20) NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- User memberships (subscriptions)
CREATE TABLE IF NOT EXISTS "Membership" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "planId" INTEGER NOT NULL REFERENCES "MembershipPlan"("id"),
  "status" VARCHAR(50) DEFAULT 'active',
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "paystackReference" VARCHAR(255),
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Membership_userId_idx" ON "Membership" ("userId");
CREATE INDEX IF NOT EXISTS "Membership_status_idx" ON "Membership" ("status");

-- Optional: add emailVerified to User if upgrading existing DB
-- ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN DEFAULT FALSE;
-- ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" VARCHAR(50) DEFAULT 'user';
