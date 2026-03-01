import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../../shared/db.js';
import { config } from '../../shared/config/env.js';
import * as emailService from '../../services/email.js';

const OTP_EXIRY_MINUTES = 10;
const CODE_TYPES = { signup: 'signup_verify', reset: 'password_reset', organizer: 'organizer_verify' };

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function createVerificationCode(email, type) {
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_EXIRY_MINUTES * 60 * 1000);
  await query(
    'DELETE FROM "VerificationCode" WHERE "email" = $1 AND "type" = $2',
    [email, type]
  );
  await query(
    'INSERT INTO "VerificationCode" ("email", "code", "type", "expiresAt") VALUES ($1, $2, $3, $4)',
    [email, code, type, expiresAt]
  );
  return code;
}

async function verifyCode(email, code, type) {
  const result = await query(
    'SELECT * FROM "VerificationCode" WHERE "email" = $1 AND "type" = $2 AND "expiresAt" > NOW() ORDER BY "createdAt" DESC LIMIT 1',
    [email, type]
  );
  const row = result.rows[0];
  if (!row || row.code !== code) return false;
  await query('DELETE FROM "VerificationCode" WHERE "id" = $1', [row.id]);
  return true;
}

export async function signIn(req, res) {
  try {
    const { email, password, otp } = req.body || {};
    const em = (email || '').trim().toLowerCase();
    if (!em || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const userResult = await query(
      'SELECT "id", "email", "name", "passwordHash", "role", "emailVerified" FROM "User" WHERE "email" = $1',
      [em]
    );
    const user = userResult.rows[0];
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.emailVerified) {
      if (otp) {
        const ok = await verifyCode(em, otp, CODE_TYPES.signup);
        if (!ok) return res.status(400).json({ error: 'Invalid or expired code' });
        await query('UPDATE "User" SET "emailVerified" = TRUE, "updatedAt" = NOW() WHERE "id" = $1', [user.id]);
      } else {
        return res.status(200).json({ requiresOtp: true, email: user.email });
      }
    } else if (otp) {
      return res.status(400).json({ error: 'Account already verified' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role || 'admin' },
      config.jwtSecret,
      { expiresIn: '7d' }
    );
    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role || 'admin',
      },
      token,
    });
  } catch (err) {
    console.error('signIn', err);
    return res.status(500).json({ error: 'Sign in failed' });
  }
}

export async function signUp(req, res) {
  try {
    const { email, password, name } = req.body || {};
    const em = (email || '').trim().toLowerCase();
    if (!em || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await query('SELECT "id" FROM "User" WHERE "email" = $1', [em]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await query(
      'INSERT INTO "User" ("email", "name", "passwordHash", "role", "emailVerified") VALUES ($1, $2, $3, $4, $5)',
      [em, (name || '').trim() || null, passwordHash, 'user', false]
    );

    const code = await createVerificationCode(em, CODE_TYPES.signup);
    await emailService.sendSignupVerificationOtp({ to: em, code });

    return res.status(201).json({ message: 'Account created. Check your email for the verification code.' });
  } catch (err) {
    console.error('signUp', err);
    return res.status(500).json({ error: err.message || 'Sign up failed' });
  }
}

export async function forgotPassword(req, res) {
  try {
    const { email } = req.body || {};
    const em = (email || '').trim().toLowerCase();
    if (!em) return res.status(400).json({ error: 'Email required' });

    const code = await createVerificationCode(em, CODE_TYPES.reset);
    await emailService.sendPasswordResetOtp({ to: em, code });

    return res.json({ message: 'If an account exists, you will receive a reset code.' });
  } catch (err) {
    console.error('forgotPassword', err);
    return res.status(500).json({ error: err.message || 'Failed to send code' });
  }
}

export async function resetPassword(req, res) {
  try {
    const { email, code, newPassword } = req.body || {};
    const em = (email || '').trim().toLowerCase();
    if (!em || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, code and new password required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const ok = await verifyCode(em, String(code).trim(), CODE_TYPES.reset);
    if (!ok) return res.status(400).json({ error: 'Invalid or expired code' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const result = await query(
      'UPDATE "User" SET "passwordHash" = $1, "updatedAt" = NOW() WHERE "email" = $2 RETURNING "id"',
      [passwordHash, em]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'User not found' });
    }
    return res.json({ message: 'Password updated' });
  } catch (err) {
    console.error('resetPassword', err);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
}

export async function resendVerification(req, res) {
  try {
    const { email } = req.body || {};
    const em = (email || '').trim().toLowerCase();
    if (!em) return res.status(400).json({ error: 'Email required' });

    const code = await createVerificationCode(em, CODE_TYPES.signup);
    await emailService.sendSignupVerificationOtp({ to: em, code });

    return res.json({ message: 'Verification code sent' });
  } catch (err) {
    console.error('resendVerification', err);
    return res.status(500).json({ error: err.message || 'Failed to send code' });
  }
}

export async function createAdmin(req, res) {
  try {
    const { name, email, password } = req.body || {};
    const em = (email || '').trim().toLowerCase();
    if (!em || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await query('SELECT "id" FROM "User" WHERE "email" = $1', [em]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const insert = await query(
      'INSERT INTO "User" ("email", "name", "passwordHash", "role", "emailVerified") VALUES ($1, $2, $3, $4, $5) RETURNING "id", "email", "name", "role"',
      [em, (name || '').trim() || null, passwordHash, 'admin', true]
    );
    const user = insert.rows[0];
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: '7d' }
    );
    return res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
    });
  } catch (err) {
    console.error('createAdmin', err);
    return res.status(500).json({ error: 'Failed to create admin' });
  }
}

export async function organizerSignup(req, res) {
  try {
    const { username, email, password } = req.body || {};
    const em = (email || '').trim().toLowerCase();
    const un = (username || '').trim();
    if (!em || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    if (!un) return res.status(400).json({ error: 'Username required' });
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existingUser = await query(
      'SELECT u."id", u."emailVerified", u."role" FROM "User" u WHERE LOWER(u."email") = $1',
      [em]
    );
    const user = existingUser.rows[0];

    if (user && user.role === 'admin' && user.emailVerified) {
      return res.status(400).json({ error: 'An account with this email already exists. Sign in at the admin login.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    if (user) {
      await query(
        'UPDATE "User" SET "name" = $1, "passwordHash" = $2, "role" = $3, "emailVerified" = FALSE, "updatedAt" = NOW() WHERE "id" = $4',
        [un || null, passwordHash, 'admin', user.id]
      );
    } else {
      await query(
        'INSERT INTO "User" ("email", "name", "passwordHash", "role", "emailVerified") VALUES ($1, $2, $3, $4, $5)',
        [em, un || null, passwordHash, 'admin', false]
      );
    }

    const code = await createVerificationCode(em, CODE_TYPES.organizer);

    try {
      await emailService.sendOrganizerVerificationOtp({ to: em, code });
      return res.status(201).json({ message: 'Verification code sent to your email.' });
    } catch (emailErr) {
      console.error('organizerSignup: email send failed', emailErr.message || emailErr);
      return res.status(201).json({
        message: 'Account created. We could not send the verification email right now (e.g. network or certificate issue). Please try again in a few minutes or contact support.',
      });
    }
  } catch (err) {
    console.error('organizerSignup', err);
    return res.status(500).json({ error: err.message || 'Failed to register as organizer' });
  }
}

export async function organizerVerifyOtp(req, res) {
  try {
    const { email, otp } = req.body || {};
    const em = (email || '').trim().toLowerCase();
    const code = String(otp || '').replace(/\D/g, '').slice(0, 6);
    if (!em || code.length !== 6) {
      return res.status(400).json({ error: 'Email and 6-digit code required' });
    }

    const ok = await verifyCode(em, code, CODE_TYPES.organizer);
    if (!ok) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    const result = await query(
      'UPDATE "User" SET "emailVerified" = TRUE, "updatedAt" = NOW() WHERE "email" = $1 RETURNING "id"',
      [em]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'User not found' });
    }
    return res.json({ message: 'Email verified. You can now sign in to the admin dashboard.' });
  } catch (err) {
    console.error('organizerVerifyOtp', err);
    return res.status(500).json({ error: 'Invalid or expired code' });
  }
}
