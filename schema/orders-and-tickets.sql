-- Schema reference: Order, OrderItem, and ticket count per order
-- Used for admin dashboard "Recent sales" and any reporting that needs tickets bought per order.

-- Order: one per purchase (one per user/checkout per event).
-- Columns used in admin recent sales: id, eventId, fullName, email, totalAmount, status, createdAt.
CREATE TABLE IF NOT EXISTS "Order" (
  id            TEXT PRIMARY KEY,
  "eventId"     TEXT NOT NULL REFERENCES "Event"(id),
  "userId"      TEXT REFERENCES "User"(id),
  "fullName"    TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  address       TEXT,
  "totalAmount" NUMERIC NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  reference     TEXT,
  "ticketCode"  TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OrderItem: one row per ticket type in an order. quantity = number of tickets of that type.
-- Tickets bought per order = SUM(quantity) over all OrderItems for that order.
CREATE TABLE IF NOT EXISTS "OrderItem" (
  id             TEXT PRIMARY KEY,
  "orderId"      TEXT NOT NULL REFERENCES "Order"(id) ON DELETE CASCADE,
  "ticketTypeId" TEXT NOT NULL REFERENCES "TicketType"(id),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  price          NUMERIC NOT NULL
);

-- Ticket count per order (for admin dashboard recent sales):
--   SELECT o.id, ..., (SELECT COALESCE(SUM(oi.quantity), 0)::int FROM "OrderItem" oi WHERE oi."orderId" = o.id) AS ticket_count, ...
--   FROM "Order" o ...
-- This works for both existing orders (with OrderItem rows) and any edge case where an order has no items (0).
