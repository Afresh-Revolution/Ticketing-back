import { query } from '../../shared/config/db.js';
import { listLandingVideos } from './videos/videos.model.js';

/** GET /api/landing/top-users - returns array of { id, name, title, imageUrl, sortOrder } */
export async function getTopUsers(req, res) {
  try {
    const result = await query(
      `SELECT "id", "name", "title", "imageUrl", "sortOrder"
       FROM "TopUser"
       WHERE "isActive" = TRUE
       ORDER BY "sortOrder" ASC, "id" ASC`
    );
    const list = (result.rows || []).map((row) => ({
      id: String(row.id),
      name: row.name || '',
      title: row.title || '',
      imageUrl: row.imageUrl || null,
      sortOrder: row.sortOrder ?? 0,
    }));
    return res.json(list);
  } catch (err) {
    console.error('[landing] getTopUsers:', err?.message || err);
    return res.json([]);
  }
}

/** GET /api/landing/videos - active landing videos for public home page */
export async function getLandingVideos(req, res) {
  try {
    const rows = await listLandingVideos({ activeOnly: true });
    const list = rows.map((row) => ({
      id: String(row.id),
      videoUrl: row.videoUrl || '',
      thumbnailUrl: row.thumbnailUrl || null,
      externalUrl: row.externalUrl || null,
      sortOrder: Number(row.sortOrder) || 0,
    }));
    return res.json(list);
  } catch (err) {
    console.error('[landing] getLandingVideos:', err?.message || err);
    return res.json([]);
  }
}
