import { query, createId } from '../../shared/config/db.js';

export function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

export function userIdOf(req) {
  const raw = req.userId ?? req.user?.id;
  if (raw == null || raw === '') return null;
  const id = Number(raw);
  return Number.isNaN(id) ? null : id;
}

export function isSuper(req) {
  return req.userRole === 'superadmin' || userIdOf(req) === 0;
}

export async function audit(actorUserId, action, resourceType, resourceId, meta = {}) {
  await query(
    `INSERT INTO "AuditEntry" (id, "actorUserId", action, "resourceType", "resourceId", meta)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [createId(), actorUserId, action, resourceType, resourceId != null ? String(resourceId) : null, JSON.stringify(meta)],
  ).catch((err) => {
    if (err?.code !== '42P01') console.error('[gatewav2] audit', err.message);
  });
}

export async function loadEvent(eventId) {
  const id = String(eventId);
  try {
    const result = await query(`SELECT * FROM "Event" WHERE id::text = $1 LIMIT 1`, [id]);
    return result.rows?.[0] || null;
  } catch (err) {
    if (err?.code !== '42703' && err?.code !== '42883') throw err;
    const result = await query(`SELECT * FROM "Event" WHERE id = $1 LIMIT 1`, [eventId]);
    return result.rows?.[0] || null;
  }
}

export async function eventRole(req, eventId) {
  const event = await loadEvent(eventId);
  if (!event) throw httpError(404, 'Event not found');
  if (isSuper(req)) return { event, role: 'superadmin' };
  const uid = userIdOf(req);
  if (uid != null && String(event.createdBy) === String(uid)) return { event, role: 'owner' };
  if (uid == null) return { event, role: 'none' };
  const staff = await query(
    `SELECT role, status FROM "EventStaff" WHERE "eventId" = $1 AND "userId" = $2 LIMIT 1`,
    [String(event.id), uid],
  ).catch((err) => {
    if (err?.code === '42P01') return { rows: [] };
    throw err;
  });
  const row = staff.rows?.[0];
  if (row && row.status === 'active') return { event, role: row.role === 'manager' ? 'manager' : 'checkin' };
  return { event, role: 'none' };
}

export async function assertManager(req, eventId) {
  const access = await eventRole(req, eventId);
  if (!['superadmin', 'owner', 'manager'].includes(access.role)) {
    throw httpError(403, 'You do not have access to this organizer workspace.');
  }
  return access;
}

export async function assertCheckin(req, eventId) {
  const access = await eventRole(req, eventId);
  if (!['superadmin', 'owner', 'manager', 'checkin'].includes(access.role)) {
    throw httpError(403, 'Check-in access is limited to assigned staff.');
  }
  return access;
}

export async function flagEnabled(key) {
  const disabled = String(process.env.GATEWAV2_DISABLE || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (disabled.includes(key)) return false;
  const result = await query(`SELECT enabled FROM "FeatureFlag" WHERE key = $1`, [key]).catch(() => ({ rows: [] }));
  if (!result.rows?.length) return true;
  return Boolean(result.rows[0].enabled);
}

export async function requireFlag(key) {
  if (!(await flagEnabled(key))) throw httpError(404, 'This feature is not enabled.');
}

const BLOCKED_PROP_KEYS = ['email', 'phone', 'name', 'lat', 'lng', 'latitude', 'longitude', 'ip'];

export function safeProps(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (BLOCKED_PROP_KEYS.includes(key.toLowerCase())) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 80);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}
