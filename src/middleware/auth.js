const jwt = require('jsonwebtoken');
const config = require('../shared/config/env');

/**
 * Optional: attach user from JWT if present (for routes that work with or without auth).
 */
function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.userId = payload.userId;
    req.userRole = payload.role || 'admin';
    next();
  } catch {
    next();
  }
}

/**
 * Require valid JWT (admin/organizer). Used for create-admin, membership creation, etc.
 */
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.userId = payload.userId;
    req.userRole = payload.role || 'admin';
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Require superadmin role (e.g. for create-admin, edit plans).
 */
function requireSuperAdmin(req, res, next) {
  if (req.userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

module.exports = { optionalAuth, requireAuth, requireSuperAdmin };
