import { query, createId } from '../../shared/config/db.js';

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    password: row.password,
    name: row.name,
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
    await query(
      'INSERT INTO "User" (id, email, password, name) VALUES ($1, $2, $3, $4)',
      [id, data.email, data.password, data.name ?? null]
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
