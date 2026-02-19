import { query, createId } from '../../shared/config/db.js';

const OTP_EXPIRY_MINUTES = 10;
const OTP_LENGTH = 6;

function generateOtp() {
  let code = '';
  for (let i = 0; i < OTP_LENGTH; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}

export const verificationModel = {
  async create(email, type) {
    await this.deleteByEmailAndType(email, type);
    const id = createId();
    const code = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
    await query(
      `INSERT INTO "VerificationCode" (id, email, code, type, "expiresAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, now())`,
      [id, email.toLowerCase(), code, type, expiresAt]
    );
    return { code, expiresAt, id };
  },

  async findValid(email, type, code) {
    const { rows } = await query(
      `SELECT id FROM "VerificationCode"
       WHERE email = $1 AND type = $2 AND code = $3 AND "expiresAt" > now()
       LIMIT 1`,
      [email.toLowerCase(), type, code]
    );
    return rows[0] || null;
  },

  async consume(id) {
    await query('DELETE FROM "VerificationCode" WHERE id = $1', [id]);
  },

  async deleteByEmailAndType(email, type) {
    await query(
      'DELETE FROM "VerificationCode" WHERE email = $1 AND type = $2',
      [email.toLowerCase(), type]
    );
  },

  generateOtp,
};
