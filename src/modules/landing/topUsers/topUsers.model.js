import { query, createId } from '../../../shared/config/db.js';

export const topUsersModel = {
  async getAll() {
    const { rows } = await query(
      'SELECT id, name, title, "imageUrl", "sortOrder", "createdAt", "updatedAt" FROM "TopUser" ORDER BY "sortOrder" ASC, "createdAt" ASC'
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      title: r.title ?? '',
      imageUrl: r.imageUrl ?? null,
      sortOrder: r.sortOrder ?? 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  },

  async create(data) {
    const id = createId();
    const now = new Date().toISOString();
    await query(
      `INSERT INTO "TopUser" (id, name, title, "imageUrl", "sortOrder", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [
        id,
        data.name || '',
        data.title ?? null,
        data.imageUrl ?? null,
        Number(data.sortOrder) || 0,
        now,
      ]
    );
    const { rows } = await query('SELECT * FROM "TopUser" WHERE id = $1', [id]);
    return rows[0] ? { id: rows[0].id, name: rows[0].name, title: rows[0].title, imageUrl: rows[0].imageUrl, sortOrder: rows[0].sortOrder, createdAt: rows[0].createdAt, updatedAt: rows[0].updatedAt } : null;
  },

  async update(id, data) {
    const now = new Date().toISOString();
    await query(
      `UPDATE "TopUser" SET name = COALESCE(NULLIF(TRIM($2), ''), name), title = $3, "imageUrl" = $4, "sortOrder" = COALESCE($5, "sortOrder"), "updatedAt" = $6 WHERE id = $1`,
      [id, data.name ?? null, data.title !== undefined ? data.title : null, data.imageUrl !== undefined ? data.imageUrl : null, data.sortOrder != null ? Number(data.sortOrder) : null, now]
    );
    const { rows } = await query('SELECT * FROM "TopUser" WHERE id = $1', [id]);
    return rows[0] ? { id: rows[0].id, name: rows[0].name, title: rows[0].title, imageUrl: rows[0].imageUrl, sortOrder: rows[0].sortOrder, createdAt: rows[0].createdAt, updatedAt: rows[0].updatedAt } : null;
  },

  async delete(id) {
    const { rowCount } = await query('DELETE FROM "TopUser" WHERE id = $1', [id]);
    return rowCount > 0;
  },
};
