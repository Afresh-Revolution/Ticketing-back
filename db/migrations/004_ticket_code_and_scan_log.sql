-- Ticket code on paid orders (unique, scanned at entry)
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ticketCode" TEXT UNIQUE;

-- Scan log: each scan of a ticket by an admin (for "used" count)
CREATE TABLE IF NOT EXISTS "ScanLog" (
  id           TEXT PRIMARY KEY,
  "orderId"    TEXT NOT NULL REFERENCES "Order"(id) ON DELETE CASCADE,
  "eventId"    TEXT NOT NULL REFERENCES "Event"(id) ON DELETE CASCADE,
  "scannedAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "scannedBy"  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "ScanLog_orderId_idx" ON "ScanLog"("orderId");
CREATE INDEX IF NOT EXISTS "ScanLog_eventId_idx" ON "ScanLog"("eventId");
