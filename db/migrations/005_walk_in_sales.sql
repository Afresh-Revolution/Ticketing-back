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
  "status" VARCHAR(50) DEFAULT 'pending',  -- 'pending' or 'paid'
  "notes" TEXT,
  "recordedBy" TEXT REFERENCES "User"("id"),
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "WalkInSale_eventId_idx" ON "WalkInSale" ("eventId");
CREATE INDEX IF NOT EXISTS "WalkInSale_status_idx" ON "WalkInSale" ("status");
CREATE INDEX IF NOT EXISTS "WalkInSale_recordedBy_idx" ON "WalkInSale" ("recordedBy");
