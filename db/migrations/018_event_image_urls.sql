-- Up to 3 event images per event (JSON array); imageUrl remains primary/cover for legacy clients

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "imageUrls" JSONB DEFAULT '[]'::jsonb;

UPDATE "Event"
SET "imageUrls" = jsonb_build_array("imageUrl")
WHERE "imageUrl" IS NOT NULL
  AND TRIM("imageUrl") <> ''
  AND (
    "imageUrls" IS NULL
    OR "imageUrls" = '[]'::jsonb
    OR jsonb_array_length("imageUrls") = 0
  );
