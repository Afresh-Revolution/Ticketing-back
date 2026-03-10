import { query } from '../../shared/config/db.js';

/** True if current user is super admin (sees all events in Supabase). */
function isSuperAdmin(req) {
  if (!req.user) return false;
  const role = (req.user.role || '').toLowerCase();
  const id = req.user.id;
  return role === 'superadmin' || id === 0 || id === '0';
}

/** GET /api/admin/dashboard – stats and recent sales from Supabase; super admin sees all, others only their events. */
export async function getDashboard(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = req.user?.id;

    const stats = {
      totalRevenue: 0,
      ticketRevenue: 0,
      ticketsSold: 0,
      totalEvents: 0,
      activeEvents: 0,
    };
    const recentSales = [];

    // Revenue/sales: join Order -> Event; super admin sees all, others only their events (createdBy = userId)
    const revSql = superAdmin
      ? `SELECT COALESCE(SUM(CASE WHEN o."status" = 'paid' THEN o."totalAmount" ELSE 0 END), 0) AS ticket_rev,
                COALESCE(SUM(CASE WHEN o."status" = 'paid' THEN 1 ELSE 0 END), 0) AS tickets_sold
         FROM "Order" o
         LEFT JOIN "Event" e ON e.id = o."eventId"`
      : `SELECT COALESCE(SUM(CASE WHEN o."status" = 'paid' THEN o."totalAmount" ELSE 0 END), 0) AS ticket_rev,
                COALESCE(SUM(CASE WHEN o."status" = 'paid' THEN 1 ELSE 0 END), 0) AS tickets_sold
         FROM "Order" o
         INNER JOIN "Event" e ON e.id = o."eventId" AND (e."createdBy" = $1 OR (e."createdBy" IS NULL AND ($1 = 0 OR $1 = '0')))`;
    const revParams = superAdmin ? [] : [userId];
    const r = await query(revSql, revParams).catch(() => ({ rows: [{ ticket_rev: 0, tickets_sold: 0 }] }));
    if (r.rows?.[0]) {
      stats.ticketRevenue = Number(r.rows[0].ticket_rev) || 0;
      stats.totalRevenue = stats.ticketRevenue;
      stats.ticketsSold = Number(r.rows[0].tickets_sold) || 0;
    }

    // Event counts: all for super admin, else only events created by this admin (or createdBy IS NULL = super admin’s)
    const countSql = superAdmin
      ? 'SELECT COUNT(*) AS c FROM "Event"'
      : 'SELECT COUNT(*) AS c FROM "Event" WHERE "createdBy" = $1 OR ("createdBy" IS NULL AND ($1 = 0 OR $1 = \'0\'))';
    const countParams = superAdmin ? [] : [userId];
    const e = await query(countSql, countParams).catch(() => ({ rows: [{ c: 0 }] }));
    stats.totalEvents = Number(e.rows?.[0]?.c) || 0;
    stats.activeEvents = stats.totalEvents;

    return res.json({ stats, recentSales });
  } catch (err) {
    console.error('getDashboard', err);
    return res.json({
      stats: {
        totalRevenue: 0,
        ticketRevenue: 0,
        ticketsSold: 0,
        totalEvents: 0,
        activeEvents: 0,
      },
      recentSales: [],
    });
  }
}

/** GET /api/admin/events – list events from Supabase; super admin sees all, others only their own. */
export async function listAdminEvents(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = req.user?.id;

    const sql = superAdmin
      ? `SELECT id, title, date, location, venue, "imageUrl", "isPublished", "isTrending", price, "createdBy"
         FROM "Event"
         ORDER BY date DESC NULLS LAST`
      : `SELECT id, title, date, location, venue, "imageUrl", "isPublished", "isTrending", price, "createdBy"
         FROM "Event"
         WHERE "createdBy" = $1 OR ("createdBy" IS NULL AND ($1 = 0 OR $1 = '0'))
         ORDER BY date DESC NULLS LAST`;
    const params = superAdmin ? [] : [userId];
    const result = await query(sql, params).catch(() => ({ rows: [] }));
    const rows = result.rows || [];
    const list = rows.map((row) => ({
      id: String(row.id),
      title: row.title,
      date: row.date,
      location: row.location || row.venue,
      isPublished: row.isPublished,
      isTrending: row.isTrending,
      price: row.price,
      createdBy: row.createdBy,
    }));
    return res.json(list);
  } catch (err) {
    console.error('listAdminEvents', err);
    return res.json([]);
  }
}

/** GET /api/admin/events/:eventId – single event; 404 if not owner (unless super admin). */
export async function getAdminEvent(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = req.user?.id;
    const eventId = req.params.eventId;

    const sql = superAdmin
      ? 'SELECT * FROM "Event" WHERE id = $1'
      : 'SELECT * FROM "Event" WHERE id = $1 AND ("createdBy" = $2 OR ("createdBy" IS NULL AND ($2 = 0 OR $2 = \'0\')))';
    const params = superAdmin ? [eventId] : [eventId, userId];
    const result = await query(sql, params).catch(() => ({ rows: [] }));
    if (!result.rows?.length) return res.status(404).json({ error: 'Event not found' });
    const row = result.rows[0];
    return res.json({
      id: String(row.id),
      title: row.title,
      date: row.date,
      location: row.location || row.venue,
      venue: row.venue,
      price: row.price,
      imageUrl: row.imageUrl,
      startTime: row.startTime,
      description: row.description,
      organizer: row.organizer,
      isPublished: row.isPublished,
      isTrending: row.isTrending,
    });
  } catch (err) {
    console.error('getAdminEvent', err);
    return res.status(500).json({ error: 'Not found' });
  }
}

/** GET /api/admin/events/:eventId/orders – orders for an event; only if user owns event or is super admin. */
export async function getEventOrders(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = req.user?.id;
    const eventId = req.params.eventId;

    const checkSql = superAdmin
      ? 'SELECT id FROM "Event" WHERE id = $1'
      : 'SELECT id FROM "Event" WHERE id = $1 AND ("createdBy" = $2 OR ("createdBy" IS NULL AND ($2 = 0 OR $2 = \'0\')))';
    const checkParams = superAdmin ? [eventId] : [eventId, userId];
    const check = await query(checkSql, checkParams).catch(() => ({ rows: [] }));
    if (!check.rows?.length) return res.status(404).json({ error: 'Event not found' });

    const result = await query(
      'SELECT * FROM "Order" WHERE "eventId" = $1 ORDER BY "createdAt" DESC',
      [eventId]
    ).catch(() => ({ rows: [] }));
    return res.json(result.rows || []);
  } catch (err) {
    console.error('getEventOrders', err);
    return res.json([]);
  }
}

/** GET /api/admin/sales – sales from Supabase; super admin sees all, others only for their events. */
export async function getSales(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = req.user?.id;

    const sql = superAdmin
      ? `SELECT o.id, o."fullName", o.email, o."totalAmount", o."status", o."createdAt", e.title AS event_title
         FROM "Order" o
         LEFT JOIN "Event" e ON e.id = o."eventId"
         ORDER BY o."createdAt" DESC
         LIMIT 100`
      : `SELECT o.id, o."fullName", o.email, o."totalAmount", o."status", o."createdAt", e.title AS event_title
         FROM "Order" o
         LEFT JOIN "Event" e ON e.id = o."eventId"
         WHERE e."createdBy" = $1 OR (e."createdBy" IS NULL AND ($1 = 0 OR $1 = '0'))
         ORDER BY o."createdAt" DESC
         LIMIT 100`;
    const params = superAdmin ? [] : [userId];
    const result = await query(sql, params).catch(() => ({ rows: [] }));
    const list = (result.rows || []).map((r) => ({
      id: r.id,
      buyer_name: r.fullName,
      buyer_email: r.email,
      amount: r.totalAmount,
      ticket_count: 1,
      status: r.status,
      created_at: r.createdAt,
      event_title: r.event_title,
    }));
    return res.json(list);
  } catch (err) {
    console.error('getSales', err);
    return res.json([]);
  }
}

// --- Super-admin-only and shared admin ---

/** GET /api/admin/password-change-status – any authenticated admin. */
export async function getPasswordChangeStatus(req, res) {
  try {
    const userId = req.user?.id;
    if (userId == null || userId === 0 || userId === '0') {
      return res.json({ canChange: true, nextChangeAllowedAt: null });
    }
    const result = await query(
      'SELECT "lastPasswordChangeAt" FROM "User" WHERE "id" = $1',
      [userId]
    ).catch(() => ({ rows: [] }));
    const last = result.rows?.[0]?.lastPasswordChangeAt;
    const nextAllowed = last ? new Date(new Date(last).getTime() + 30 * 24 * 60 * 60 * 1000) : null;
    const canChange = !nextAllowed || new Date() >= nextAllowed;
    return res.json({
      canChange: !!canChange,
      nextChangeAllowedAt: nextAllowed ? nextAllowed.toISOString() : null,
    });
  } catch {
    return res.json({ canChange: true, nextChangeAllowedAt: null });
  }
}

/** GET /api/admin/admins – super admin only; list users with role admin or superadmin. */
export async function listAdmins(req, res) {
  try {
    const result = await query(
      `SELECT "id", "email", "name", "role", "emailVerified", "createdAt", "updatedAt"
       FROM "User"
       WHERE "role" IN ('admin', 'superadmin')
       ORDER BY "id"`,
      []
    ).catch(() => ({ rows: [] }));
    const list = (result.rows || []).map((row) => ({
      id: String(row.id),
      email: row.email,
      name: row.name,
      role: row.role || 'admin',
      emailVerified: !!row.emailVerified,
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
    }));
    return res.json(list);
  } catch (err) {
    console.error('listAdmins', err);
    return res.json([]);
  }
}

/** DELETE /api/admin/admins/:id – super admin only; do not delete super admins. */
export async function deleteAdmin(req, res) {
  try {
    const id = req.params.id;
    if (id === '0' || id === 0) {
      return res.status(403).json({ error: 'Cannot delete super admin.' });
    }
    await query('DELETE FROM "User" WHERE "id" = $1 AND "role" = \'admin\'', [id]).catch(() => ({}));
    return res.json({ message: 'Deleted' });
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
}

/** GET /api/admin/top-users – super admin only. */
export async function listTopUsers(req, res) {
  try {
    const result = await query(
      `SELECT "id", "name", "title", "imageUrl", "sortOrder"
       FROM "TopUser"
       ORDER BY "sortOrder" ASC NULLS LAST, "id" ASC`,
      []
    ).catch(() => ({ rows: [] }));
    const list = (result.rows || []).map((row) => ({
      id: String(row.id),
      name: row.name || '',
      title: row.title || '',
      imageUrl: row.imageUrl ?? null,
      sortOrder: row.sortOrder ?? 0,
    }));
    return res.json(list);
  } catch (err) {
    console.error('listTopUsers', err);
    return res.json([]);
  }
}

/** POST /api/admin/top-users – super admin only. */
export async function createTopUser(req, res) {
  try {
    const { name, title, imageUrl, sortOrder } = req.body || {};
    const result = await query(
      `INSERT INTO "TopUser" ("name", "title", "imageUrl", "sortOrder")
       VALUES ($1, $2, $3, $4)
       RETURNING "id", "name", "title", "imageUrl", "sortOrder"`,
      [name ?? '', title ?? '', imageUrl ?? null, sortOrder ?? 0]
    ).catch((e) => {
      if (e.code === '42P01') return { rows: [] };
      throw e;
    });
    if (!result.rows?.length) {
      return res.status(501).json({ error: 'TopUser table not configured' });
    }
    const row = result.rows[0];
    return res.status(201).json({
      id: String(row.id),
      name: row.name || '',
      title: row.title || '',
      imageUrl: row.imageUrl ?? null,
      sortOrder: row.sortOrder ?? 0,
    });
  } catch (err) {
    console.error('createTopUser', err);
    return res.status(500).json({ error: err.message || 'Failed' });
  }
}

/** PATCH /api/admin/top-users/:id – super admin only. */
export async function updateTopUser(req, res) {
  try {
    const { id } = req.params;
    const { name, title, imageUrl } = req.body || {};
    const result = await query(
      `UPDATE "TopUser"
       SET "name" = COALESCE($1, "name"),
           "title" = COALESCE($2, "title"),
           "imageUrl" = COALESCE($3, "imageUrl")
       WHERE "id" = $4
       RETURNING "id"`,
      [name, title, imageUrl, id]
    ).catch(() => ({ rows: [] }));
    if (!result.rows?.length) return res.status(404).json({ error: 'Not found' });
    return res.json({ message: 'Updated' });
  } catch (err) {
    console.error('updateTopUser', err);
    return res.status(500).json({ error: 'Failed' });
  }
}

/** DELETE /api/admin/top-users/:id – super admin only. */
export async function deleteTopUser(req, res) {
  try {
    const { id } = req.params;
    await query('DELETE FROM "TopUser" WHERE "id" = $1', [id]).catch(() => ({}));
    return res.json({ message: 'Deleted' });
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
}
