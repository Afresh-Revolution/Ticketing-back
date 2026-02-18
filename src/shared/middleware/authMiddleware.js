import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { query } from '../config/db.js';

export async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Handle superadmin token for development/hardcoded auth
  if (token.startsWith('superadmin-token-')) {
    req.user = {
      id: 0,
      email: 'ticketing@2026gmail.com',
      name: 'Super Admin',
      role: 'superadmin'
    };
    return next();
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const { rows } = await query(
      'SELECT id, email, name, role FROM "User" WHERE id = $1',
      [decoded.userId]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function authorizeRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
}

export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    req.user = null;
    return next();
  }
  jwt.verify(token, config.jwtSecret, async (err, decoded) => {
    if (err) {
      req.user = null;
      return next();
    }
    try {
      const { rows } = await query(
        'SELECT id, email, name, role FROM "User" WHERE id = $1',
        [decoded.userId]
      );
      req.user = rows[0] ?? null;
    } catch {
      req.user = null;
    }
    next();
  });
}
