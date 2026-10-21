-- Gatewav 2.0 additive schema.
-- Does not rewrite Event, Order, Ticket, or Paystack tables.
-- Safe to run more than once.

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "citySlug" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Africa/Lagos';
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS accessibility TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS format TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "listingStatus" TEXT DEFAULT 'published';
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "skillLevel" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "ageGuidance" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "safetyNotes" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "contactNotes" TEXT;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;

CREATE TABLE IF NOT EXISTS "City" (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  state TEXT,
  country TEXT NOT NULL DEFAULT 'Nigeria',
  timezone TEXT NOT NULL DEFAULT 'Africa/Lagos',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  "isPilot" BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS "Favorite" (
  id TEXT PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "eventId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("userId", "eventId")
);

CREATE TABLE IF NOT EXISTS "OrganizerFollow" (
  id TEXT PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "organizerUserId" INTEGER,
  "organizerName" TEXT NOT NULL,
  "notifyNextEvent" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("userId", "organizerName")
);

CREATE TABLE IF NOT EXISTS "CuratedCollection" (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  "citySlug" TEXT,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'editorial',
  "isPublished" BOOLEAN NOT NULL DEFAULT TRUE,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "CollectionEvent" (
  id TEXT PRIMARY KEY,
  "collectionId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  UNIQUE ("collectionId", "eventId")
);

CREATE TABLE IF NOT EXISTS "EventSession" (
  id TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "startsAt" TIMESTAMPTZ NOT NULL,
  "endsAt" TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'Africa/Lagos',
  capacity INTEGER,
  price INTEGER,
  status TEXT NOT NULL DEFAULT 'scheduled',
  "cancelReason" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("eventId", "startsAt")
);

CREATE TABLE IF NOT EXISTS "Plan" (
  id TEXT PRIMARY KEY,
  "ownerUserId" INTEGER NOT NULL,
  name TEXT NOT NULL,
  "budgetMin" INTEGER,
  "budgetMax" INTEGER,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "PlanMember" (
  id TEXT PRIMARY KEY,
  "planId" TEXT NOT NULL,
  "userId" INTEGER,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  rsvp TEXT NOT NULL DEFAULT 'invited',
  "sharePayment" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "PlanOption" (
  id TEXT PRIMARY KEY,
  "planId" TEXT NOT NULL,
  "eventId" TEXT,
  "proposedDate" DATE,
  label TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "PlanVote" (
  id TEXT PRIMARY KEY,
  "optionId" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  choice TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("optionId", "userId")
);

CREATE TABLE IF NOT EXISTS "PlanInvite" (
  token TEXT PRIMARY KEY,
  "planId" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "revokedAt" TIMESTAMPTZ,
  "createdBy" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "Circle" (
  id TEXT PRIMARY KEY,
  "planId" TEXT,
  "eventId" TEXT,
  name TEXT NOT NULL,
  "ownerUserId" INTEGER NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'invite_only',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "Circle" ADD COLUMN IF NOT EXISTS official BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS "CircleMembership" (
  id TEXT PRIMARY KEY,
  "circleId" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  "adultConfirmed" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("circleId", "userId")
);

CREATE TABLE IF NOT EXISTS "CircleInvite" (
  token TEXT PRIMARY KEY,
  "circleId" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "revokedAt" TIMESTAMPTZ,
  "createdBy" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "UserBlock" (
  "blockerUserId" INTEGER NOT NULL,
  "blockedUserId" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("blockerUserId", "blockedUserId")
);

CREATE TABLE IF NOT EXISTS "ModerationRecord" (
  id TEXT PRIMARY KEY,
  "reporterUserId" INTEGER,
  "targetUserId" INTEGER,
  "circleId" TEXT,
  "eventId" TEXT,
  "reviewId" TEXT,
  "mediaId" TEXT,
  kind TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "PromoterCampaign" (
  id TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "organizerUserId" INTEGER NOT NULL,
  name TEXT NOT NULL,
  "commissionType" TEXT NOT NULL DEFAULT 'percent',
  "commissionValue" INTEGER NOT NULL DEFAULT 0,
  "windowDays" INTEGER NOT NULL DEFAULT 14,
  "attributionRule" TEXT NOT NULL DEFAULT 'last_touch',
  "refundPolicy" TEXT NOT NULL DEFAULT 'reverse_on_refund_or_chargeback',
  status TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "PromoterMember" (
  id TEXT PRIMARY KEY,
  "campaignId" TEXT NOT NULL,
  "userId" INTEGER,
  email TEXT,
  "shareCode" TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "PromoterClick" (
  id TEXT PRIMARY KEY,
  "shareCode" TEXT NOT NULL,
  "anonId" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "PromoterConversion" (
  id TEXT PRIMARY KEY,
  "campaignId" TEXT NOT NULL,
  "shareCode" TEXT NOT NULL,
  "orderId" TEXT NOT NULL UNIQUE,
  "grossAmount" INTEGER NOT NULL DEFAULT 0,
  "commissionAmount" INTEGER NOT NULL DEFAULT 0,
  "ticketCount" INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  "reversedReason" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "CheckoutAttribution" (
  "orderId" TEXT PRIMARY KEY,
  "shareCode" TEXT,
  "sessionId" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "AttendanceStamp" (
  id TEXT PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "eventId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'checkin',
  "awardedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("userId", "eventId", "orderId")
);

CREATE TABLE IF NOT EXISTS "PassportPrivacy" (
  "userId" INTEGER PRIMARY KEY,
  hidden BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS "Perk" (
  id TEXT PRIMARY KEY,
  "eventId" TEXT,
  "organizerUserId" INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  quota INTEGER NOT NULL DEFAULT 1,
  "redeemedCount" INTEGER NOT NULL DEFAULT 0,
  "validUntil" TIMESTAMPTZ,
  "costOwner" TEXT NOT NULL DEFAULT 'organizer',
  status TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "PerkRedemption" (
  id TEXT PRIMARY KEY,
  "perkId" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "stampId" TEXT,
  "redeemedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("perkId", "userId")
);

CREATE TABLE IF NOT EXISTS "EventReview" (
  id TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "orderId" TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT,
  attended BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'published',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("eventId", "userId")
);

CREATE TABLE IF NOT EXISTS "MediaAsset" (
  id TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "organizerUserId" INTEGER,
  "contributorUserId" INTEGER,
  url TEXT NOT NULL,
  caption TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "EventStaff" (
  id TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'checkin',
  status TEXT NOT NULL DEFAULT 'active',
  "invitedBy" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("eventId", "userId")
);

CREATE TABLE IF NOT EXISTS "RefundCase" (
  id TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "eventId" TEXT,
  status TEXT NOT NULL DEFAULT 'initiated',
  reason TEXT,
  "actorUserId" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "VerificationCase" (
  id TEXT PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "organizerName" TEXT,
  evidence TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  "reviewNote" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "AnalyticsEvent" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  "anonId" TEXT,
  "userId" INTEGER,
  "eventId" TEXT,
  "citySlug" TEXT,
  props JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "AuditEntry" (
  id TEXT PRIMARY KEY,
  "actorUserId" INTEGER,
  action TEXT NOT NULL,
  "resourceType" TEXT,
  "resourceId" TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "NotificationPreference" (
  "userId" INTEGER PRIMARY KEY,
  "organizerAnnouncements" BOOLEAN NOT NULL DEFAULT TRUE,
  reminders BOOLEAN NOT NULL DEFAULT TRUE,
  marketing BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS "AnnouncementLog" (
  id TEXT PRIMARY KEY,
  "organizerUserId" INTEGER,
  "userId" INTEGER NOT NULL,
  "eventId" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "FeatureFlag" (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "WebhookReceipt" (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  reference TEXT NOT NULL,
  event TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, reference, event)
);

CREATE INDEX IF NOT EXISTS "Favorite_user_idx" ON "Favorite" ("userId");
CREATE INDEX IF NOT EXISTS "EventSession_event_idx" ON "EventSession" ("eventId", "startsAt");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_name_idx" ON "AnalyticsEvent" (name, "createdAt");
CREATE INDEX IF NOT EXISTS "PromoterClick_code_idx" ON "PromoterClick" ("shareCode", "createdAt");

INSERT INTO "City" (slug, name, state, latitude, longitude, "isPilot")
VALUES
  ('jos', 'Jos', 'Plateau', 9.8965, 8.8583, TRUE),
  ('lagos', 'Lagos', 'Lagos', 6.5244, 3.3792, FALSE),
  ('abuja', 'Abuja', 'FCT', 9.0765, 7.3986, FALSE),
  ('port-harcourt', 'Port Harcourt', 'Rivers', 4.8156, 7.0498, FALSE),
  ('ibadan', 'Ibadan', 'Oyo', 7.3775, 3.9470, FALSE),
  ('kano', 'Kano', 'Kano', 12.0022, 8.5920, FALSE),
  ('enugu', 'Enugu', 'Enugu', 6.5244, 7.5086, FALSE)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO "CuratedCollection" (id, slug, title, "citySlug", description, kind, "sortOrder")
VALUES (
  'col_this_weekend_jos',
  'this-weekend-in-jos',
  'This Weekend in Jos',
  'jos',
  'A curated look at what is on in Jos this weekend. Editors can pin listings; otherwise this page shows published Jos events dated this weekend.',
  'weekend',
  0
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO "FeatureFlag" (key, enabled) VALUES
  ('around_me', TRUE),
  ('organizer_os', TRUE),
  ('distribution', TRUE),
  ('experiences', TRUE),
  ('promoters', TRUE),
  ('plans', TRUE),
  ('passport', TRUE),
  ('post_event', TRUE),
  ('circles', TRUE),
  ('circles_public', FALSE)
ON CONFLICT (key) DO NOTHING;
