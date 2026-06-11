-- Online / hybrid events: streaming, live state, ticket delivery mode, paid watch links

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "eventType" VARCHAR(50) DEFAULT 'in-person';
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "streamUrl" VARCHAR(1024);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "streamProvider" VARCHAR(50) DEFAULT 'youtube';
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "isLive" BOOLEAN DEFAULT FALSE;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "liveStartedAt" TIMESTAMPTZ;

ALTER TABLE "TicketType" ADD COLUMN IF NOT EXISTS "deliveryMode" VARCHAR(50) DEFAULT 'in_person';

-- orderId/eventId must match production Order.id and Event.id (TEXT / UUID strings, not INTEGER)
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
CREATE INDEX IF NOT EXISTS "Event_eventType_idx" ON "Event" ("eventType");
CREATE INDEX IF NOT EXISTS "Event_isLive_idx" ON "Event" ("isLive") WHERE "isLive" = TRUE;
