-- Add createdBy to Event
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "createdBy" TEXT REFERENCES "User"(id);

-- Ticket Types (Pools)
CREATE TABLE IF NOT EXISTS "TicketType" (
  id TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL REFERENCES "Event"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0, -- Total available
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Orders
CREATE TABLE IF NOT EXISTS "Order" (
  id TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL REFERENCES "Event"(id),
  "userId" TEXT REFERENCES "User"(id), -- Nullable for guest checkout
  "fullName" TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  "totalAmount" INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, paid, cancelled
  reference TEXT, -- Payment gateway reference
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Order Items
CREATE TABLE IF NOT EXISTS "OrderItem" (
  id TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "Order"(id) ON DELETE CASCADE,
  "ticketTypeId" TEXT NOT NULL REFERENCES "TicketType"(id),
  quantity INTEGER NOT NULL,
  price INTEGER NOT NULL -- Price at time of purchase
);

-- Indexes
CREATE INDEX IF NOT EXISTS "TicketType_eventId_idx" ON "TicketType"("eventId");
CREATE INDEX IF NOT EXISTS "Order_eventId_idx" ON "Order"("eventId");
CREATE INDEX IF NOT EXISTS "Order_userId_idx" ON "Order"("userId");
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");
