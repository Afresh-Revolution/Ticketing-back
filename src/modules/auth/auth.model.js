import { query, createId } from '../../shared/config/db.js';

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    password: row.password,
    name: row.name,
    role: row.role,
    emailVerified: row.emailVerified ?? false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export const authModel = {
  async findUserByEmail(email) {
    const normalized = normalizeEmail(email);
    const { rows } = await query('SELECT * FROM "User" WHERE LOWER(TRIM(email)) = $1', [normalized]);
    return rowToUser(rows[0]);
  },
  async createUser(data) {
    const id = createId();
    const now = new Date().toISOString();
    const email = normalizeEmail(data.email);
    await query(
      `INSERT INTO "User" (id, email, password, name, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, FALSE, $5, $6)`,
      [id, email, data.password, data.name ?? null, now, now]
    );
    const { rows } = await query('SELECT * FROM "User" WHERE id = $1', [id]);
    return rowToUser(rows[0]);
  },
  async createAdmin(data) {
    const id = createId();
    const now = new Date().toISOString();
    const email = normalizeEmail(data.email);
    await query(
      `INSERT INTO "User" (id, email, password, name, role, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7)`,
      [id, email, data.password, data.name, 'admin', now, now]
    );
    const { rows } = await query('SELECT * FROM "User" WHERE id = $1', [id]);
    return rowToUser(rows[0]);
  },
  async findUserById(id) {
    const { rows } = await query(
      'SELECT id, email, name, "emailVerified" FROM "User" WHERE id = $1',
      [id]
    );
    return rowToUser(rows[0]);
  },
  /** For admin change-password: get user with password hash (and passwordChangedAt). Returns null if not found. */
  async findUserByIdWithPassword(id) {
    const { rows } = await query(
      'SELECT id, email, name, password, role, "emailVerified", "passwordChangedAt" FROM "User" WHERE id = $1',
      [id]
    );
    if (!rows[0]) return null;
    return {
      id: rows[0].id,
      email: rows[0].email,
      password: rows[0].password,
      name: rows[0].name,
      role: rows[0].role,
      emailVerified: rows[0].emailVerified ?? false,
      passwordChangedAt: rows[0].passwordChangedAt ? new Date(rows[0].passwordChangedAt) : null,
    };
  },
  async getPasswordChangedAt(userId) {
    const { rows } = await query(
      'SELECT "passwordChangedAt" FROM "User" WHERE id = $1',
      [userId]
    );
    if (!rows[0] || rows[0].passwordChangedAt == null) return null;
    return new Date(rows[0].passwordChangedAt);
  },
  async updatePasswordById(userId, hashedPassword) {
    const now = new Date().toISOString();
    await query(
      'UPDATE "User" SET password = $1, "passwordChangedAt" = $2, "updatedAt" = $3 WHERE id = $4',
      [hashedPassword, now, now, userId]
    );
  },
  async updatePassword(email, hashedPassword) {
    const now = new Date().toISOString();
    const normalized = normalizeEmail(email);
    await query(
      `UPDATE "User" SET password = $1, "updatedAt" = $2 WHERE LOWER(TRIM(email)) = $3`,
      [hashedPassword, now, normalized]
    );
  },
  async markEmailVerified(email) {
    const now = new Date().toISOString();
    const normalized = normalizeEmail(email);
    await query(
      `UPDATE "User" SET "emailVerified" = TRUE, "updatedAt" = $1 WHERE LOWER(TRIM(email)) = $2`,
      [now, normalized]
    );
  },
};
