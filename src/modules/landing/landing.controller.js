import { query } from '../../shared/config/db.js';

/** GET /api/landing/top-users - returns array of { id, name, title, imageUrl, sortOrder } */
export async function getTopUsers(req, res) {
  try {
    const result = await query(
      `SELECT "id", "name", "title", "imageUrl", "sortOrder"
       FROM "TopUser"
       WHERE "isActive" = TRUE
       ORDER BY "sortOrder" ASC, "id" ASC`
    ).catch(() => ({ rows: [] }));
    const list = (result.rows || []).map((row) => ({
      id: String(row.id),
      name: row.name || '',
      title: row.title || '',
      imageUrl: row.imageUrl || null,
      sortOrder: row.sortOrder ?? 0,
    }));
    return res.json(list);
  } catch {
    return res.json([]);
  }
}
