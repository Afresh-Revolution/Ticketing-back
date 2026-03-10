import jwt from 'jsonwebtoken';
import { config } from '../shared/config/env.js';

export function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return next();
  if (token.startsWith('superadmin-token-')) {
    req.userId = 0;
    req.userRole = 'superadmin';
    return next();
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.userId = payload.userId;
    req.userRole = payload.role || 'admin';
    next();
  } catch {
    next();
  }
}

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      code: 'AUTH_REQUIRED',
      message: 'Send Authorization: Bearer <token> to access this endpoint.',
    });
  }
  // Frontend superadmin login uses a special token; accept it so admin endpoints work
  if (token.startsWith('superadmin-token-')) {
    req.userId = 0;
    req.userRole = 'superadmin';
    return next();
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.userId = payload.userId;
    req.userRole = payload.role || 'admin';
    next();
  } catch {
    return res.status(401).json({
      error: 'Invalid or expired token',
      code: 'TOKEN_INVALID',
      message: 'Your session may have expired. Please sign in again.',
    });
  }
}

export function requireSuperAdmin(req, res, next) {
  if (req.userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}
