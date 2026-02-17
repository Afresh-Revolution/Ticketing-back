import { query, createId } from '../../shared/config/db.js';

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    password: row.password,
    name: row.name,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const authModel = {
  async findUserByEmail(email) {
    const { rows } = await query('SELECT * FROM "User" WHERE email = $1', [email]);
    return rowToUser(rows[0]);
  },
  async createUser(data) {
    const id = createId();
    const now = new Date().toISOString();
    await query(
      'INSERT INTO "User" (id, email, password, name, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [id, data.email, data.password, data.name ?? null, now, now]
    );
    const { rows } = await query('SELECT * FROM "User" WHERE id = $1', [id]);
    return rowToUser(rows[0]);
  },
  async createAdmin(data) {
    const id = createId();
    const now = new Date().toISOString();
    await query(
      'INSERT INTO "User" (id, email, password, name, role, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, data.email, data.password, data.name, 'admin', now, now]
    );
    const { rows } = await query('SELECT * FROM "User" WHERE id = $1', [id]);
    return rowToUser(rows[0]);
  },
  async findUserById(id) {
    const { rows } = await query(
      'SELECT id, email, name FROM "User" WHERE id = $1',
      [id]
    );
    return rowToUser(rows[0]);
  },
};
