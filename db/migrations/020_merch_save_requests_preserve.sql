-- Keep merch save requests when event merch is replaced (avoid ON DELETE CASCADE data loss).
ALTER TABLE merch_save_requests ADD COLUMN IF NOT EXISTS merch_description TEXT;

UPDATE merch_save_requests msr
SET merch_description = em.description
FROM event_merch em
WHERE msr.merch_id = em.id
  AND (msr.merch_description IS NULL OR msr.merch_description = '');

ALTER TABLE merch_save_requests ALTER COLUMN merch_id DROP NOT NULL;

ALTER TABLE merch_save_requests DROP CONSTRAINT IF EXISTS merch_save_requests_merch_id_fkey;

ALTER TABLE merch_save_requests
  ADD CONSTRAINT merch_save_requests_merch_id_fkey
  FOREIGN KEY (merch_id) REFERENCES event_merch (id) ON DELETE SET NULL;
