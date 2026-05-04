import { query, createId } from '../../../shared/config/db.js';

const RETURNING =
  '"id", "name", "title", "imageUrl", "sortOrder", "isActive", "createdAt", "updatedAt"';

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    title: r.title ?? '',
    imageUrl: r.imageUrl ?? null,
    sortOrder: r.sortOrder ?? 0,
    isActive: r.isActive ?? true,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Insert a TopUser row. Supports SERIAL "id" (omit in INSERT) and legacy TEXT "id" without DB default
 * (explicit UUID) if the first insert fails with NOT NULL on "id".
 */
export async function insertTopUserRecord({ name, title, imageUrl, sortOrder } = {}) {
  const sort = Number(sortOrder) || 0;
  const nm = name || '';
  const tl = title ?? null;
  const img = imageUrl || null;

  try {
    const { rows } = await query(
      `INSERT INTO "TopUser" ("name", "title", "imageUrl", "sortOrder")
       VALUES ($1, $2, $3, $4)
       RETURNING ${RETURNING}`,
      [nm, tl, img, sort]
    );
    return rows[0] || null;
  } catch (err) {
    if (err?.code !== '23502') throw err;
    const id = createId();
    const now = new Date().toISOString();
    const { rows } = await query(
      `INSERT INTO "TopUser" ("id", "name", "title", "imageUrl", "sortOrder", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${RETURNING}`,
      [id, nm, tl, img, sort, now, now]
    );
    return rows[0] || null;
  }
}

export const topUsersModel = {
  async getAll() {
    const { rows } = await query(
      `SELECT "id", "name", "title", "imageUrl", "sortOrder", "isActive", "createdAt", "updatedAt"
       FROM "TopUser"
       ORDER BY "sortOrder" ASC, "createdAt" ASC`
    );
    return rows.map((r) => mapRow(r));
  },

  async create(data) {
    const row = await insertTopUserRecord({
      name: data.name,
      title: data.title,
      imageUrl: data.imageUrl,
      sortOrder: data.sortOrder,
    });
    return mapRow(row);
  },

  async update(id, data) {
    await query(
      `UPDATE "TopUser"
       SET "name" = COALESCE(NULLIF(TRIM($2), ''), "name"),
           "title" = $3,
           "imageUrl" = $4,
           "sortOrder" = COALESCE($5, "sortOrder"),
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      [
        id,
        data.name ?? null,
        data.title !== undefined ? data.title : null,
        data.imageUrl !== undefined ? data.imageUrl : null,
        data.sortOrder != null ? Number(data.sortOrder) : null,
      ]
    );
    const { rows } = await query('SELECT * FROM "TopUser" WHERE "id" = $1', [id]);
    return mapRow(rows[0]);
  },

  async delete(id) {
    const { rowCount } = await query('DELETE FROM "TopUser" WHERE "id" = $1', [id]);
    return rowCount > 0;
  },
};
