import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../shared/config/env.js';
import { authModel } from './auth.model.js';

const SALT_ROUNDS = 10;

export async function signUp(email, password, name) {
  try {
    console.log('[auth.service] Starting signup for email:', email);
    
    const existing = await authModel.findUserByEmail(email);
    if (existing) {
      console.log('[auth.service] Email already exists:', email);
      throw Object.assign(new Error('Email already registered'), { statusCode: 400 });
    }
    
    console.log('[auth.service] Hashing password...');
    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    
    console.log('[auth.service] Creating user in database...');
    const user = await authModel.createUser({
      email,
      password: hashed,
      name: name || null,
    });
    
    if (!config.jwtSecret || config.jwtSecret === 'change-me-in-production') {
      console.error('[auth.service] CRITICAL: JWT_SECRET not set or using default value!');
    }
    
    console.log('[auth.service] Generating JWT token...');
    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    
    console.log('[auth.service] Signup successful for user:', user.id);
    return { user: { id: user.id, email: user.email, name: user.name }, token };
  } catch (error) {
    console.error('[auth.service] Signup failed:', error.message);
    console.error('[auth.service] Error stack:', error.stack);
    throw error;
  }
}

export async function signIn(email, password) {
  try {
    console.log('[auth.service] Starting signin for email:', email);
    
    const user = await authModel.findUserByEmail(email);
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
    
    console.log('[auth.service] Generating JWT token...');
    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    
    console.log('[auth.service] Signin successful for user:', user.id);
    return { 
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name,
        role: user.role || 'user' 
      }, 
      token 
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
