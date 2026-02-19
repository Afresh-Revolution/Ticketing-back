import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../shared/config/env.js';
import { authModel } from './auth.model.js';
import { verificationModel } from './verification.model.js';
import { sendOtpEmail } from '../../shared/services/email.service.js';

const SALT_ROUNDS = 10;

export async function signUp(email, password, name) {
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await authModel.findUserByEmail(normalizedEmail);
  if (existing) {
    throw Object.assign(new Error('Email already registered'), { statusCode: 400 });
  }

  const hashed = await bcrypt.hash(password, SALT_ROUNDS);

  const { code } = await verificationModel.create(normalizedEmail, 'signup_verify');
  try {
    await sendOtpEmail(normalizedEmail, code, 'signup_verify');
  } catch (emailErr) {
    await verificationModel.deleteByEmailAndType(normalizedEmail, 'signup_verify');
    console.error('[auth.service] Signup: email failed, cleaned up. User not created:', emailErr.message);
    throw Object.assign(
      new Error(emailErr.message?.includes('timed out') ? 'Email delivery timed out. Please try again.' : 'Failed to send verification email. Please try again.'),
      { statusCode: 503 }
    );
  }

  try {
    await authModel.createUser({
      email: normalizedEmail,
      password: hashed,
      name: name?.trim() || null,
    });
  } catch (createErr) {
    await verificationModel.deleteByEmailAndType(normalizedEmail, 'signup_verify');
    if (createErr.message?.includes('duplicate') || createErr.code === '23505') {
      throw Object.assign(new Error('Email already registered'), { statusCode: 400 });
    }
    throw createErr;
  }

  return {
    message: 'Account created. Check your email for a verification code. You will need it when you first sign in.',
  };
}

export async function signIn(email, password, otp) {
  try {
    console.log('[auth.service] Starting signin for email:', email);
    const normalizedEmail = email.trim().toLowerCase();

    const user = await authModel.findUserByEmail(normalizedEmail);
    if (!user) {
      console.log('[auth.service] User not found:', email);
      throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
    }

    console.log('[auth.service] Verifying password...');
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      console.log('[auth.service] Invalid password for user:', email);
      throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
    }

    const needsOtp = !user.emailVerified;
    if (needsOtp && !otp) {
      return { requiresOtp: true, email: normalizedEmail };
    }

    if (needsOtp && otp) {
      const valid = await verificationModel.findValid(normalizedEmail, 'signup_verify', otp);
      if (!valid) {
        throw Object.assign(new Error('Invalid or expired verification code'), { statusCode: 400 });
      }
      await verificationModel.consume(valid.id);
      await authModel.markEmailVerified(normalizedEmail);
    }

    console.log('[auth.service] Generating JWT token...');
    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

    console.log('[auth.service] Signin successful for user:', user.id);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role || 'user',
      },
      token,
    };
  } catch (error) {
    console.error('[auth.service] Signin failed:', error.message);
    throw error;
  }
}

export async function createAdmin(email, password, name) {
  try {
    console.log('[auth.service] Starting admin creation for email:', email);
    
    const existing = await authModel.findUserByEmail(email);
    if (existing) {
      console.log('[auth.service] Email already exists:', email);
      throw Object.assign(new Error('Email already registered'), { statusCode: 400 });
    }
    
    console.log('[auth.service] Hashing password...');
    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    
    console.log('[auth.service] Creating admin user in database...');
    const user = await authModel.createAdmin({
      email,
      password: hashed,
      name,
    });
    
    console.log('[auth.service] Generating JWT token for new admin...');
    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    
    console.log('[auth.service] Admin creation successful for user:', user.id);
    return { 
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name,
        role: user.role 
      }, 
      token 
    };
  } catch (error) {
    console.error('[auth.service] Admin creation failed:', error.message);
    throw error;
  }
}

export async function forgotPassword(email) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await authModel.findUserByEmail(normalizedEmail);
  if (!user) {
    return { message: 'If an account exists with this email, you will receive a reset code.' };
  }

  const { code } = await verificationModel.create(normalizedEmail, 'forgot_password');
  try {
    await sendOtpEmail(normalizedEmail, code, 'forgot_password');
  } catch (emailErr) {
    await verificationModel.deleteByEmailAndType(normalizedEmail, 'forgot_password');
    console.error('[auth.service] Forgot password: email failed:', emailErr.message);
    throw Object.assign(
      new Error(emailErr.message?.includes('timed out') ? 'Email delivery timed out. Please try again.' : 'Failed to send reset code. Please try again.'),
      { statusCode: 503 }
    );
  }

  return { message: 'If an account exists with this email, you will receive a reset code.' };
}

export async function resendVerification(email) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await authModel.findUserByEmail(normalizedEmail);
  if (!user) {
    return { message: 'If an account exists with this email, you will receive a verification code.' };
  }
  if (user.emailVerified) {
    return { message: 'This account is already verified. You can sign in.' };
  }
  const { code } = await verificationModel.create(normalizedEmail, 'signup_verify');
  try {
    await sendOtpEmail(normalizedEmail, code, 'signup_verify');
  } catch (emailErr) {
    await verificationModel.deleteByEmailAndType(normalizedEmail, 'signup_verify');
    console.error('[auth.service] Resend verification: email failed:', emailErr.message);
    throw Object.assign(
      new Error(emailErr.message?.includes('timed out') ? 'Email delivery timed out. Please try again.' : 'Failed to send verification code. Please try again.'),
      { statusCode: 503 }
    );
  }
  return { message: 'Verification code sent. Check your email.' };
}

export async function resetPassword(email, code, newPassword) {
  const normalizedEmail = email.trim().toLowerCase();

  const valid = await verificationModel.findValid(normalizedEmail, 'forgot_password', code);
  if (!valid) {
    throw Object.assign(new Error('Invalid or expired reset code'), { statusCode: 400 });
  }

  const user = await authModel.findUserByEmail(normalizedEmail);
  if (!user) {
    throw Object.assign(new Error('Account not found'), { statusCode: 404 });
  }

  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await authModel.updatePassword(normalizedEmail, hashed);
  await verificationModel.consume(valid.id);

  return { message: 'Password updated successfully. You can now sign in.' };
}
