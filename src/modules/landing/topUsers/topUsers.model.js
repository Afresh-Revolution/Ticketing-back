import { query } from '../../../shared/config/db.js';

export const topUsersModel = {
  async getAll() {
    const { rows } = await query(
      `SELECT "id", "name", "title", "imageUrl", "sortOrder", "isActive", "createdAt", "updatedAt"
       FROM "TopUser"
       ORDER BY "sortOrder" ASC, "createdAt" ASC`
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      title: r.title ?? '',
      imageUrl: r.imageUrl ?? null,
      sortOrder: r.sortOrder ?? 0,
      isActive: r.isActive ?? true,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  },

  async create(data) {
    const { rows } = await query(
      `INSERT INTO "TopUser" ("name", "title", "imageUrl", "sortOrder")
       VALUES ($1, $2, $3, $4)
       RETURNING "id", "name", "title", "imageUrl", "sortOrder", "isActive", "createdAt", "updatedAt"`,
      [
        data.name || '',
        data.title ?? null,
        data.imageUrl ?? null,
        Number(data.sortOrder) || 0,
      ]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      title: row.title ?? '',
      imageUrl: row.imageUrl ?? null,
      sortOrder: row.sortOrder ?? 0,
      isActive: row.isActive ?? true,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
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
    if (!rows[0]) return null;
    const r = rows[0];
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
  },

  async delete(id) {
    const { rowCount } = await query('DELETE FROM "TopUser" WHERE "id" = $1', [id]);
    return rowCount > 0;
  },
};
