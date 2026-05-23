import crypto from 'crypto';
import { query } from '../../../shared/config/db.js';

const LANDING_VIDEO_COLUMNS =
  '"id", "videoUrl", "thumbnailUrl", "publicId", "externalUrl", "sortOrder", "isActive", "createdAt", "updatedAt"';

export async function ensureLandingVideosTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS "LandingVideo" (
      "id" text PRIMARY KEY,
      "videoUrl" text NOT NULL,
      "thumbnailUrl" text,
      "publicId" text,
      "externalUrl" text,
      "sortOrder" integer NOT NULL DEFAULT 0,
      "isActive" boolean NOT NULL DEFAULT TRUE,
      "createdAt" timestamptz NOT NULL DEFAULT NOW(),
      "updatedAt" timestamptz NOT NULL DEFAULT NOW()
    )`
  );
  await query(
    `ALTER TABLE "LandingVideo" ADD COLUMN IF NOT EXISTS "externalUrl" text`
  ).catch(() => {});
}

export async function listLandingVideos({ activeOnly = false } = {}) {
  await ensureLandingVideosTable();
  const where = activeOnly ? 'WHERE "isActive" = TRUE' : '';
  const result = await query(
    `SELECT ${LANDING_VIDEO_COLUMNS}
     FROM "LandingVideo"
     ${where}
     ORDER BY "sortOrder" ASC, "createdAt" ASC`
  );
  return result.rows || [];
}

export async function createLandingVideo({
  videoUrl,
  thumbnailUrl = null,
  publicId = null,
  externalUrl = null,
  sortOrder = 0,
}) {
  await ensureLandingVideosTable();
  const id = crypto.randomUUID();
  const result = await query(
    `INSERT INTO "LandingVideo" ("id", "videoUrl", "thumbnailUrl", "publicId", "externalUrl", "sortOrder", "isActive", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW(), NOW())
     RETURNING ${LANDING_VIDEO_COLUMNS}`,
    [id, videoUrl, thumbnailUrl, publicId, externalUrl, Number(sortOrder) || 0]
  );
  return result.rows?.[0] || null;
}

export async function updateLandingVideo(id, patch = {}) {
  await ensureLandingVideosTable();
  const sets = ['"updatedAt" = NOW()'];
  const params = [String(id)];
  let idx = 2;

  if (patch.sortOrder != null) {
    sets.push(`"sortOrder" = $${idx++}`);
    params.push(Number(patch.sortOrder));
  }
  if (typeof patch.isActive === 'boolean') {
    sets.push(`"isActive" = $${idx++}`);
    params.push(patch.isActive);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'externalUrl')) {
    sets.push(`"externalUrl" = $${idx++}`);
    params.push(patch.externalUrl);
  }

  if (sets.length === 1) {
    const existing = await query(
      `SELECT ${LANDING_VIDEO_COLUMNS} FROM "LandingVideo" WHERE "id" = $1`,
      [String(id)]
    );
    return existing.rows?.[0] || null;
  }

  const result = await query(
    `UPDATE "LandingVideo"
     SET ${sets.join(', ')}
     WHERE "id" = $1
     RETURNING ${LANDING_VIDEO_COLUMNS}`,
    params
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
