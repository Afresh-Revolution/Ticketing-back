import crypto from 'crypto';
import { query } from '../../../shared/config/db.js';

export async function ensureLandingVideosTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS "LandingVideo" (
      "id" text PRIMARY KEY,
      "videoUrl" text NOT NULL,
      "thumbnailUrl" text,
      "publicId" text,
      "sortOrder" integer NOT NULL DEFAULT 0,
      "isActive" boolean NOT NULL DEFAULT TRUE,
      "createdAt" timestamptz NOT NULL DEFAULT NOW(),
      "updatedAt" timestamptz NOT NULL DEFAULT NOW()
    )`
  );
}

export async function listLandingVideos({ activeOnly = false } = {}) {
  await ensureLandingVideosTable();
  const where = activeOnly ? 'WHERE "isActive" = TRUE' : '';
  const result = await query(
    `SELECT "id", "videoUrl", "thumbnailUrl", "publicId", "sortOrder", "isActive", "createdAt", "updatedAt"
     FROM "LandingVideo"
     ${where}
     ORDER BY "sortOrder" ASC, "createdAt" ASC`
  );
  return result.rows || [];
}

export async function createLandingVideo({ videoUrl, thumbnailUrl = null, publicId = null, sortOrder = 0 }) {
  await ensureLandingVideosTable();
  const id = crypto.randomUUID();
  const result = await query(
    `INSERT INTO "LandingVideo" ("id", "videoUrl", "thumbnailUrl", "publicId", "sortOrder", "isActive", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
     RETURNING "id", "videoUrl", "thumbnailUrl", "publicId", "sortOrder", "isActive", "createdAt", "updatedAt"`,
    [id, videoUrl, thumbnailUrl, publicId, Number(sortOrder) || 0]
  );
  return result.rows?.[0] || null;
}

export async function updateLandingVideo(id, patch = {}) {
  await ensureLandingVideosTable();
  const result = await query(
    `UPDATE "LandingVideo"
     SET "sortOrder" = COALESCE($2, "sortOrder"),
         "isActive" = COALESCE($3, "isActive"),
         "updatedAt" = NOW()
     WHERE "id" = $1
     RETURNING "id", "videoUrl", "thumbnailUrl", "publicId", "sortOrder", "isActive", "createdAt", "updatedAt"`,
    [
      String(id),
      patch.sortOrder == null ? null : Number(patch.sortOrder),
      typeof patch.isActive === 'boolean' ? patch.isActive : null,
    ]
  );
  return result.rows?.[0] || null;
}

export async function deleteLandingVideo(id) {
  await ensureLandingVideosTable();
  const result = await query(
    `DELETE FROM "LandingVideo"
     WHERE "id" = $1
     RETURNING "id", "publicId", "videoUrl"`,
    [String(id)]
  );
  return result.rows?.[0] || null;
}
