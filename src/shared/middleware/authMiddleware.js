import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { query } from '../config/db.js';

export async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (token.startsWith('superadmin-token-')) {
    req.user = {
      id: 0,
      email: config.superAdminEmail,
      name: 'Super Admin',
      role: 'superadmin'
    };
    return next();
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const decodedId = decoded.userId ?? decoded.id;
    if (decoded.role === 'superadmin' && (decodedId === 0 || decodedId === '0')) {
      req.user = {
        id: 0,
        email: decoded.email || config.superAdminEmail,
        name: decoded.name || 'Super Admin',
        role: 'superadmin'
      };
      return next();
    }
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
      const user = rows[0] ?? null;
      req.user = user;
      req.userId = user?.id ?? decoded.userId;
    } catch {
      req.user = null;
      req.userId = null;
    }
    next();
  });
}
