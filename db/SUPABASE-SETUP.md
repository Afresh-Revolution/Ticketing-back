# Add ticket types to Supabase so tickets show on the event page

Admin-created ticket types (from the "Ticket Types" / "Ticket Pool" section when creating or editing an event) are stored in the **TicketType** table. If that table doesn’t exist in your Supabase database, tickets won’t show on the user-side event detail page.

## 1. Apply the SQL in Supabase

1. Open your **Supabase** project.
2. Go to **SQL Editor**.
3. Open the file **`db/supabase-ticket-types.sql`** in this repo (or copy the SQL below).
4. Paste the SQL into the editor and click **Run**.

### SQL to run (copy-paste)

```sql
-- Ensure Event has createdBy (for admin ownership)
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "createdBy" TEXT REFERENCES "User"(id);

-- Ticket types (pools) per event
CREATE TABLE IF NOT EXISTS "TicketType" (
  id         TEXT PRIMARY KEY,
  "eventId"  TEXT NOT NULL REFERENCES "Event"(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  description TEXT,
  price      INTEGER NOT NULL DEFAULT 0,
  quantity   INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "TicketType_eventId_idx" ON "TicketType"("eventId");

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickettype_updated_at ON "TicketType";
CREATE TRIGGER tickettype_updated_at
  BEFORE UPDATE ON "TicketType"
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
```

## 2. After running the SQL

- **New events**: When you create an event from the admin panel and fill in "Ticket Types" (e.g. General Admission, price, quantity), those rows are saved into **TicketType** and will show on the event detail page under "Select Tickets".
- **Existing events**: Events created *before* you had this table (or before the admin was sending ticket types) have no ticket rows. Edit those events in the admin ("Edit Event") and add at least one ticket type, then save — they will then show on the user side.

## 3. If you prefer to run the full schema

To match the backend’s full schema (all tables, including Order, OrderItem, BankAccount, Withdrawal, etc.), run the entire **`db/schema.sql`** once in the Supabase SQL Editor instead of only `supabase-ticket-types.sql`.
