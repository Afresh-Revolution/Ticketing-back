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
CREATE TRIGGER ticket_updated_at BEFORE UPDATE ON "Ticket" FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
