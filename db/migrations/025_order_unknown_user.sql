-- Bank-transfer checkout inserts "Order"."userId" from the signed-in session.
-- The built-in admin session uses id 0, which is not a "User" row, and any
-- other unknown id hits Order_userId_fkey and blocks the order.
-- This does not change columns, constraints, or existing rows. Unknown ids
-- are stored as NULL so the same INSERT succeeds as a guest order.

CREATE OR REPLACE FUNCTION clear_unknown_order_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."userId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "User" WHERE id = NEW."userId"
  ) THEN
    NEW."userId" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_clear_unknown_user ON "Order";
CREATE TRIGGER order_clear_unknown_user
  BEFORE INSERT OR UPDATE OF "userId" ON "Order"
  FOR EACH ROW
  EXECUTE PROCEDURE clear_unknown_order_user();
