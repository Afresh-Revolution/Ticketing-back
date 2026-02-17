import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../shared/config/env.js';
import { authModel } from './auth.model.js';

const SALT_ROUNDS = 10;

export async function signUp(email, password, name) {
  const existing = await authModel.findUserByEmail(email);
  if (existing) throw Object.assign(new Error('Email already registered'), { statusCode: 400 });
  const hashed = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await authModel.createUser({
    email,
    password: hashed,
    name: name || null,
  });
  const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  return { user: { id: user.id, email: user.email, name: user.name }, token };
}

export async function signIn(email, password) {
  const user = await authModel.findUserByEmail(email);
  if (!user) throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
  const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  return { user: { id: user.id, email: user.email, name: user.name }, token };
}
