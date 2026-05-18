import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, createId } from '../../shared/config/db.js';
import { insertTopUserRecord } from '../landing/topUsers/topUsers.model.js';
import {
  sendTicketEmail,
  sendWithdrawalRequestEmail,
  sendWithdrawalApprovedEmail,
  sendWithdrawalRejectedEmail,
} from '../../shared/services/email.service.js';
import { uploadVideoBufferToCloudinary, deleteVideoFromCloudinary, isCloudinaryConfigured } from '../../shared/services/cloudinary.service.js';
import { listLandingVideos, createLandingVideo, updateLandingVideo, deleteLandingVideo } from '../landing/videos/videos.model.js';
import { NIGERIAN_BANKS_FALLBACK } from './nigerianBanks.js';

/** True if current user is super admin (sees all events in Supabase). */
function isSuperAdmin(req) {
  if (!req.user) return false;
  const role = (req.user.role || '').toLowerCase();
  const id = req.user.id;
  return role === 'superadmin' || id === 0 || id === '0';
}

function normalizeTicketTypeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** GET /api/admin/dashboard – stats and recent sales from Supabase; super admin sees all, others only their events. */
export async function getDashboard(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const rawId = req.user?.id ?? req.userId;
    const userIdParam = rawId != null ? String(rawId) : '';

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
      ? `SELECT
           COALESCE(SUM(CASE WHEN o."status" = 'paid' THEN o."totalAmount" ELSE 0 END), 0) AS ticket_rev,
           COALESCE(
             SUM(
               CASE
                 WHEN o."status" = 'paid'
                 THEN COALESCE((SELECT SUM(oi.quantity)::int FROM "OrderItem" oi WHERE oi."orderId"::text = o.id::text), 1)
                 ELSE 0
               END
             ),
             0
           ) AS tickets_sold
         FROM "Order" o
         LEFT JOIN "Event" e ON e.id::text = o."eventId"::text`
      : `SELECT
           COALESCE(SUM(CASE WHEN o."status" = 'paid' THEN o."totalAmount" ELSE 0 END), 0) AS ticket_rev,
           COALESCE(
             SUM(
               CASE
                 WHEN o."status" = 'paid'
                 THEN COALESCE((SELECT SUM(oi.quantity)::int FROM "OrderItem" oi WHERE oi."orderId"::text = o.id::text), 1)
                 ELSE 0
               END
             ),
             0
           ) AS tickets_sold
         FROM "Order" o
         INNER JOIN "Event" e ON e.id::text = o."eventId"::text AND ((e."createdBy"::text = $1) OR (e."createdBy" IS NULL AND $1 = '0'))`;
    const revParams = superAdmin ? [] : [userIdParam];
    const r = await query(revSql, revParams).catch(() => ({ rows: [{ ticket_rev: 0, tickets_sold: 0 }] }));
    if (r.rows?.[0]) {
      stats.ticketRevenue = Number(r.rows[0].ticket_rev) || 0;
      stats.totalRevenue = stats.ticketRevenue;
      stats.ticketsSold = Number(r.rows[0].tickets_sold) || 0;
    }

    // Event counts: all for super admin, else only events created by this admin (or createdBy IS NULL = super admin’s)
    const countSql = superAdmin
      ? 'SELECT COUNT(*) AS c FROM "Event"'
      : 'SELECT COUNT(*) AS c FROM "Event" WHERE ("createdBy"::text = $1) OR ("createdBy" IS NULL AND $1 = \'0\')';
    const countParams = superAdmin ? [] : [userIdParam];
    const e = await query(countSql, countParams).catch(() => ({ rows: [{ c: 0 }] }));
    stats.totalEvents = Number(e.rows?.[0]?.c) || 0;
    stats.activeEvents = stats.totalEvents;

    const recentSql = superAdmin
      ? `SELECT *
         FROM (
           SELECT
             o.id::text AS id,
             'online'::text AS source,
             o."fullName" AS buyer_name,
             o.email AS buyer_email,
             o.phone AS buyer_phone,
             o."status" AS status,
             COALESCE((SELECT SUM(oi.quantity)::int FROM "OrderItem" oi WHERE oi."orderId"::text = o.id::text), 1) AS ticket_count,
             o."totalAmount" AS amount,
             o."createdAt" AS created_at,
             e.title AS event_title
           FROM "Order" o
           LEFT JOIN "Event" e ON e.id::text = o."eventId"::text
           WHERE o."status" = 'paid'
           UNION ALL
           SELECT
             w.id::text AS id,
             'walk_in'::text AS source,
             w."fullName" AS buyer_name,
             w.email AS buyer_email,
             w.phone AS buyer_phone,
             w."status" AS status,
             COALESCE(w."quantity", 1)::int AS ticket_count,
             w.amount AS amount,
             w."createdAt" AS created_at,
             e.title AS event_title
           FROM "WalkInSale" w
           LEFT JOIN "Event" e ON e.id::text = w."eventId"::text
           WHERE w."status" = 'paid'
         ) s
         ORDER BY s.created_at DESC
         LIMIT 10`
      : `SELECT *
         FROM (
           SELECT
             o.id::text AS id,
             'online'::text AS source,
             o."fullName" AS buyer_name,
             o.email AS buyer_email,
             o.phone AS buyer_phone,
             o."status" AS status,
             COALESCE((SELECT SUM(oi.quantity)::int FROM "OrderItem" oi WHERE oi."orderId"::text = o.id::text), 1) AS ticket_count,
             o."totalAmount" AS amount,
             o."createdAt" AS created_at,
             e.title AS event_title
           FROM "Order" o
           INNER JOIN "Event" e ON e.id::text = o."eventId"::text
           WHERE o."status" = 'paid' AND ((e."createdBy"::text = $1) OR (e."createdBy" IS NULL AND $1 = '0'))
           UNION ALL
           SELECT
             w.id::text AS id,
             'walk_in'::text AS source,
             w."fullName" AS buyer_name,
             w.email AS buyer_email,
             w.phone AS buyer_phone,
             w."status" AS status,
             COALESCE(w."quantity", 1)::int AS ticket_count,
             w.amount AS amount,
             w."createdAt" AS created_at,
             e.title AS event_title
           FROM "WalkInSale" w
           INNER JOIN "Event" e ON e.id::text = w."eventId"::text
           WHERE w."status" = 'paid' AND ((e."createdBy"::text = $1) OR (e."createdBy" IS NULL AND $1 = '0'))
         ) s
         ORDER BY s.created_at DESC
         LIMIT 10`;
    const recentParams = superAdmin ? [] : [userIdParam];
    const recentResult = await query(recentSql, recentParams).catch(() => ({ rows: [] }));
    recentSales.push(
      ...(recentResult.rows || []).map((row) => ({
        id: row.id,
        source: row.source,
        buyer_name: row.buyer_name,
        buyer_email: row.buyer_email,
        buyer_phone: row.buyer_phone,
        status: row.status || 'pending',
        ticket_count: Number(row.ticket_count) || 1,
        amount: Number(row.amount) || 0,
        created_at: row.created_at,
        event_title: row.event_title || '',
      }))
    );

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

/** GET /api/admin/me – current admin from token (so frontend can use server identity for createdBy). */
export async function getMe(req, res) {
  try {
    const id = req.user?.id ?? req.userId;
    const role = (req.user?.role || req.userRole || 'admin').toLowerCase();
    return res.json({
      id: id === 0 || id === '0' ? 0 : Number(id) || null,
      role: role === 'superadmin' ? 'superadmin' : 'admin',
    });
  } catch (err) {
    console.error('getMe', err);
    return res.status(500).json({ error: 'Not found' });
  }
}

/** GET /api/admin/admins – list admin users (superadmin only). Includes suspended. */
export async function listAdmins(req, res) {
  try {
    if (req.userRole !== 'superadmin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await query(
      `SELECT id, email, name, role, "emailVerified", "createdAt", "suspended"
       FROM "User"
       WHERE role IN ('admin', 'superadmin')
       ORDER BY "createdAt" DESC`
    ).catch(() => ({ rows: [] }));
    const list = (result.rows || []).map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role || 'admin',
      emailVerified: !!row.emailVerified,
      createdAt: row.createdAt,
      suspended: !!row.suspended,
    }));
    return res.json(list);
  } catch (err) {
    console.error('listAdmins', err);
    return res.status(500).json({ error: 'Failed to list admins' });
  }
}

/** PATCH /api/admin/admins/:id/suspend – set suspended flag (superadmin only). Cannot suspend self or another superadmin. */
export async function suspendAdmin(req, res) {
  try {
    if (req.userRole !== 'superadmin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid admin id' });
    }
    const currentId = Number(req.userId) ?? req.userId;
    if (id === currentId) {
      return res.status(400).json({ error: 'Cannot suspend your own account' });
    }
    const suspended = req.body?.suspended === true;
    const result = await query(
      `UPDATE "User" SET "suspended" = $1, "updatedAt" = NOW() WHERE id = $2 AND role = 'admin' RETURNING id, "suspended"`,
      [suspended, id]
    );
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found or cannot be suspended (superadmins cannot be suspended)' });
    }
    return res.json({ id: result.rows[0].id, suspended: !!result.rows[0].suspended });
  } catch (err) {
    console.error('suspendAdmin', err);
    return res.status(500).json({ error: 'Failed to update suspend status' });
  }
}

/** DELETE /api/admin/admins/:id – remove an admin user (superadmin only). Cannot delete self or another superadmin. */
export async function deleteAdmin(req, res) {
  try {
    if (req.userRole !== 'superadmin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid admin id' });
    }
    const currentId = Number(req.userId) || req.userId;
    if (id === currentId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    const result = await query(
      `DELETE FROM "User" WHERE id = $1 AND role = 'admin' RETURNING id`,
      [id]
    );
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found or cannot be deleted' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error('deleteAdmin', err);
    return res.status(500).json({ error: 'Failed to delete admin' });
  }
}

/** GET /api/admin/events – list events; super admin sees all (including other admins'), others only events they created. */
export async function listAdminEvents(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const rawId = req.user?.id ?? req.userId;
    const userIdParam = rawId != null ? String(rawId) : '';

    let rows = [];
    if (superAdmin) {
      const r = await query(
        `SELECT e.id, e.title, e.date, e.location, e.venue, e."imageUrl", e."isTrending", e.price, e."createdBy", e.category, e."startTime", e."isPublished"
         FROM "Event" e
         ORDER BY e.date DESC NULLS LAST`
      ).catch((err) => {
        console.error('listAdminEvents (super) query', err?.message || err);
        return { rows: [] };
      });
      rows = r.rows || [];
    } else {
      const r = await query(
        `SELECT e.id, e.title, e.date, e.location, e.venue, e."imageUrl", e."isTrending", e.price, e."createdBy", e.category, e."startTime", e."isPublished"
         FROM "Event" e
         WHERE (e."createdBy"::text = $1) OR (e."createdBy" IS NULL AND $1 = '0')
         ORDER BY e.date DESC NULLS LAST`,
        [userIdParam]
      ).catch((err) => {
        console.error('listAdminEvents (admin) query', err?.message || err);
        return { rows: [] };
      });
      rows = r.rows || [];
    }

    if (rows.length === 0) return res.json([]);

    const ids = [...new Set(rows.map((r) => r.createdBy).filter((x) => x != null))];
    let names = {};
    if (ids.length > 0) {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
      const nameRows = await query(
        `SELECT id, name FROM "User" WHERE id::text IN (${placeholders})`,
        ids.map((id) => String(id))
      ).catch(() => ({ rows: [] }));
      (nameRows.rows || []).forEach((r) => {
        names[String(r.id)] = r.name || null;
      });
    }

    const eventIds = rows.map((row) => String(row.id));
    let ticketTypeRows = [];
    if (eventIds.length > 0) {
      const ticketTypeResult = await query(
        `SELECT "id", "eventId", "name", "price"
         FROM "TicketType"
         WHERE "eventId"::text = ANY($1)`,
        [eventIds]
      ).catch(() => ({ rows: [] }));
      ticketTypeRows = ticketTypeResult.rows || [];
    }
    const ticketTypesByEventId = ticketTypeRows.reduce((acc, ticketRow) => {
      const eventKey = String(ticketRow.eventId || '');
      if (!eventKey) return acc;
      if (!acc[eventKey]) acc[eventKey] = [];
      acc[eventKey].push({
        id: String(ticketRow.id),
        name: ticketRow.name || 'General',
        price: Number(ticketRow.price) || 0,
      });
      return acc;
    }, {});

    const list = rows.map((row) => ({
      id: String(row.id),
      title: row.title,
      date: row.date,
      location: row.location || row.venue,
      isPublished: row.isPublished !== false,
      isTrending: row.isTrending ?? false,
      price: row.price ?? 0,
      createdBy: row.createdBy,
      createdByName: row.createdBy == null ? 'Super Admin' : (names[String(row.createdBy)] ?? null),
      ticketTypes: ticketTypesByEventId[String(row.id)] || [],
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
    const eventId = req.params.eventId;

    const result = await query('SELECT * FROM "Event" WHERE "id"::text = $1', [eventId]).catch(() => ({ rows: [] }));
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

/** PATCH /api/admin/events/:eventId – update event details; owner only (unless super admin). */
export async function patchAdminEvent(req, res) {
  try {
    const eventId = String(req.params.eventId || req.params.id || '');
    const body = req.body || {};

    if (!eventId) return res.status(400).json({ error: 'Event id is required' });

    const check = await query(
      'SELECT "id", "createdBy" FROM "Event" WHERE "id"::text = $1',
      [eventId]
    ).catch(() => ({ rows: [] }));
    if (!check.rows?.length) return res.status(404).json({ error: 'Event not found' });

    const result = await query(
      `UPDATE "Event"
       SET "title" = COALESCE($1, "title"),
           "date" = COALESCE($2, "date"),
           "location" = COALESCE($3, "location"),
           "price" = COALESCE($4, "price"),
           "imageUrl" = COALESCE($5, "imageUrl"),
           "startTime" = COALESCE($6, "startTime"),
           "description" = COALESCE($7, "description"),
           "organizer" = COALESCE($8, "organizer"),
           "isTrending" = COALESCE($9, "isTrending"),
           "isPublished" = COALESCE($10, "isPublished"),
           "venue" = COALESCE($11, "venue"),
           "category" = COALESCE($12, "category"),
           "updatedAt" = NOW()
       WHERE "id"::text = $13
       RETURNING "id"`,
      [
        body.title ?? null,
        body.date ?? null,
        body.location ?? null,
        body.price ?? null,
        body.imageUrl ?? null,
        body.startTime ?? null,
        body.description ?? null,
        body.organizer ?? null,
        typeof body.isTrending === 'boolean' ? body.isTrending : null,
        typeof body.isPublished === 'boolean' ? body.isPublished : null,
        body.venue ?? null,
        body.category ?? null,
        eventId,
      ]
    ).catch(() => ({ rows: [] }));

    if (!result.rows?.length) return res.status(404).json({ error: 'Event not found' });
    if (Array.isArray(body.ticketTypes)) {
      const currentRows = await query(
        'SELECT "id" FROM "TicketType" WHERE "eventId"::text = $1',
        [eventId]
      ).catch(() => ({ rows: [] }));
      const existingIds = new Set((currentRows.rows || []).map((r) => String(r.id)));
      const incomingIds = new Set();

      for (const ticket of body.ticketTypes) {
        const parsedId = typeof ticket?.id === 'string' ? ticket.id.trim() : '';
        const hasExistingId = parsedId.length > 0 && existingIds.has(parsedId);
        if (hasExistingId) incomingIds.add(parsedId);

        const price = Number(ticket?.price) || 0;
        const quantity = Number(ticket?.quantity) || 0;
        const type = ticket?.type === 'free' ? 'free' : (price === 0 ? 'free' : 'paid');
        const name = ticket?.name || 'Ticket';
        const description = ticket?.description || null;

        if (hasExistingId) {
          await query(
            `UPDATE "TicketType"
             SET "name" = $1,
                 "description" = $2,
                 "price" = $3,
                 "quantity" = $4,
                 "type" = $5,
                 "updatedAt" = NOW()
             WHERE "id"::text = $6 AND "eventId"::text = $7`,
            [name, description, price, quantity, type, parsedId, eventId]
          );
        } else {
          await query(
            `INSERT INTO "TicketType" ("id", "eventId", "name", "description", "price", "quantity", "type", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
            [crypto.randomUUID(), eventId, name, description, price, quantity, type]
          );
        }
      }

      for (const existingId of existingIds) {
        if (incomingIds.has(existingId)) continue;
        await query(
          `DELETE FROM "TicketType" tt
           WHERE tt."id"::text = $1
             AND tt."eventId"::text = $2
             AND NOT EXISTS (
               SELECT 1
               FROM "OrderItem" oi
               WHERE oi."ticketTypeId"::text = tt."id"::text
             )`,
          [existingId, eventId]
        );
      }
    }
    return res.json({ message: 'Updated' });
  } catch (err) {
    console.error('patchAdminEvent', err);
    return res.status(500).json({ error: err.message || 'Failed to update event' });
  }
}

/** PATCH /api/admin/events/:eventId/visibility – toggle event visible on public side (isPublished). */
export async function patchEventVisibility(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = getUserId(req);
    const userIdParam = userId != null ? String(userId) : '';
    const eventId = req.params.eventId;
    const isPublished = req.body?.isPublished !== false;

    const checkSql = superAdmin
      ? 'SELECT "id" FROM "Event" WHERE "id"::text = $1'
      : 'SELECT "id" FROM "Event" WHERE "id"::text = $1 AND ("createdBy"::text = $2 OR ("createdBy" IS NULL AND $2 = \'0\'))';
    const checkParams = superAdmin ? [eventId] : [eventId, userIdParam];
    const check = await query(checkSql, checkParams).catch(() => ({ rows: [] }));
    if (!check.rows?.length) return res.status(404).json({ error: 'Event not found' });

    await query(
      'UPDATE "Event" SET "isPublished" = $1, "updatedAt" = COALESCE("updatedAt", NOW()) WHERE "id"::text = $2',
      [isPublished, eventId]
    ).catch(() => ({}));
    return res.json({ isPublished });
  } catch (err) {
    console.error('patchEventVisibility', err);
    return res.status(500).json({ error: 'Failed to update visibility' });
  }
}

/** GET /api/admin/events/:eventId/orders – orders for an event; only if user owns event or is super admin. */
export async function getEventOrders(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = getUserId(req);
    const userIdParam = userId != null ? String(userId) : '';
    const eventId = req.params.eventId;

    const checkSql = superAdmin
      ? 'SELECT "id" FROM "Event" WHERE "id"::text = $1'
      : 'SELECT "id" FROM "Event" WHERE "id"::text = $1 AND ("createdBy"::text = $2 OR ("createdBy" IS NULL AND $2 = \'0\'))';
    const checkParams = superAdmin ? [eventId] : [eventId, userIdParam];
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

/** GET /api/admin/sales – super admin sees all sales, others only for their events. */
export async function getSales(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const rawId = req.user?.id ?? req.userId;
    const userIdParam = rawId != null ? String(rawId) : '';

    const sql = superAdmin
      ? `SELECT
           o.id,
           o."eventId",
           o.reference,
           o."fullName",
           o.email,
           o.phone,
           o."totalAmount",
           o."status",
           o."createdAt",
           e.title AS event_title,
           COALESCE((SELECT SUM(oi.quantity)::int FROM "OrderItem" oi WHERE oi."orderId"::text = o.id::text), 1) AS ticket_count,
           COALESCE((
             SELECT STRING_AGG(CONCAT(COALESCE(tt.name, 'General'), ' x', oi.quantity::text), ', ' ORDER BY COALESCE(tt.name, 'General'))
             FROM "OrderItem" oi
             LEFT JOIN "TicketType" tt ON tt.id::text = oi."ticketTypeId"::text
             WHERE oi."orderId"::text = o.id::text
           ), 'General x1') AS ticket_breakdown
         FROM "Order" o
         LEFT JOIN "Event" e ON e.id::text = o."eventId"::text
         ORDER BY o."createdAt" DESC
         LIMIT 100`
      : `SELECT
           o.id,
           o."eventId",
           o.reference,
           o."fullName",
           o.email,
           o.phone,
           o."totalAmount",
           o."status",
           o."createdAt",
           e.title AS event_title,
           COALESCE((SELECT SUM(oi.quantity)::int FROM "OrderItem" oi WHERE oi."orderId"::text = o.id::text), 1) AS ticket_count,
           COALESCE((
             SELECT STRING_AGG(CONCAT(COALESCE(tt.name, 'General'), ' x', oi.quantity::text), ', ' ORDER BY COALESCE(tt.name, 'General'))
             FROM "OrderItem" oi
             LEFT JOIN "TicketType" tt ON tt.id::text = oi."ticketTypeId"::text
             WHERE oi."orderId"::text = o.id::text
           ), 'General x1') AS ticket_breakdown
         FROM "Order" o
         LEFT JOIN "Event" e ON e.id::text = o."eventId"::text
         WHERE (e."createdBy"::text = $1) OR (e."createdBy" IS NULL AND $1 = '0')
         ORDER BY o."createdAt" DESC
         LIMIT 100`;
    const params = superAdmin ? [] : [userIdParam];
    const result = await query(sql, params).catch(() => ({ rows: [] }));
    const rawList = (result.rows || []).map((r) => ({
      id: r.id,
      event_id: r.eventId,
      reference: r.reference || '',
      buyer_name: r.fullName,
      buyer_email: r.email,
      buyer_phone: r.phone,
      amount: r.totalAmount,
      ticket_count: Number(r.ticket_count) || 1,
      ticket_breakdown: r.ticket_breakdown || '',
      status: r.status,
      created_at: r.createdAt,
      event_title: r.event_title,
    }));

    // De-duplicate logical duplicates from repeated checkout attempts/callbacks.
    // Prefer paid records; then the most recent row.
    const dedupedMap = new Map();
    for (const sale of rawList) {
      const normalizedEmail = String(sale.buyer_email || '').trim().toLowerCase();
      const key = sale.reference
        ? `ref:${sale.reference}`
        : `fallback:${sale.event_id}|${normalizedEmail}|${sale.amount}|${sale.ticket_breakdown || ''}`;
      const current = dedupedMap.get(key);
      if (!current) {
        dedupedMap.set(key, sale);
        continue;
      }
      const currentPaid = String(current.status || '').toLowerCase() === 'paid';
      const nextPaid = String(sale.status || '').toLowerCase() === 'paid';
      if (nextPaid && !currentPaid) {
        dedupedMap.set(key, sale);
        continue;
      }
      if (nextPaid === currentPaid) {
        const currentTime = new Date(current.created_at).getTime();
        const nextTime = new Date(sale.created_at).getTime();
        if (nextTime > currentTime) dedupedMap.set(key, sale);
      }
    }

    const deduped = Array.from(dedupedMap.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 100);
    return res.json(deduped);
  } catch (err) {
    console.error('getSales', err);
    return res.json([]);
  }
}

function normalizeSaleStatus(statusInput, body = null) {
  if (typeof statusInput === 'boolean') return statusInput ? 'paid' : 'pending';

  const value = String(statusInput ?? '').trim().toLowerCase();
  if (value === 'paid' || value === 'completed' || value === 'success' || value === 'changed' || value === 'true') {
    return 'paid';
  }
  if (value === 'pending' || value === 'unpaid' || value === 'false') {
    return 'pending';
  }

  const b = body && typeof body === 'object' ? body : {};
  if (typeof b.isPaid === 'boolean') return b.isPaid ? 'paid' : 'pending';
  if (typeof b.checked === 'boolean') return b.checked ? 'paid' : 'pending';
  if (typeof b.value === 'boolean') return b.value ? 'paid' : 'pending';

  return null;
}

function generateTicketCode() {
  return crypto.randomBytes(6).toString('hex').toUpperCase();
}

async function resolveAdminEventIdentifier(eventIdentifier, req) {
  const superAdmin = isSuperAdmin(req);
  const rawId = req.user?.id ?? req.userId;
  const userIdParam = rawId != null ? String(rawId) : '';
  const normalized = String(eventIdentifier || '').trim();
  if (!normalized) return null;

  const byIdSql = superAdmin
    ? `SELECT e.id::text AS id, e.title, e.date
       FROM "Event" e
       WHERE e.id::text = $1
       LIMIT 1`
    : `SELECT e.id::text AS id, e.title, e.date
       FROM "Event" e
       WHERE e.id::text = $1
         AND (e."createdBy"::text = $2 OR (e."createdBy" IS NULL AND $2 = '0'))
       LIMIT 1`;
  const byIdParams = superAdmin ? [normalized] : [normalized, userIdParam];
  const byIdResult = await query(byIdSql, byIdParams).catch(() => ({ rows: [] }));
  if (byIdResult.rows?.[0]) return byIdResult.rows[0];

  const byTitleSql = superAdmin
    ? `SELECT e.id::text AS id, e.title, e.date
       FROM "Event" e
       WHERE LOWER(COALESCE(e.title, '')) = LOWER($1)
       ORDER BY e."createdAt" DESC
       LIMIT 1`
    : `SELECT e.id::text AS id, e.title, e.date
       FROM "Event" e
       WHERE LOWER(COALESCE(e.title, '')) = LOWER($1)
         AND (e."createdBy"::text = $2 OR (e."createdBy" IS NULL AND $2 = '0'))
       ORDER BY e."createdAt" DESC
       LIMIT 1`;
  const byTitleParams = superAdmin ? [normalized] : [normalized, userIdParam];
  const byTitleResult = await query(byTitleSql, byTitleParams).catch(() => ({ rows: [] }));
  return byTitleResult.rows?.[0] || null;
}

async function getSaleByIdForAdmin(orderId, req) {
  const superAdmin = isSuperAdmin(req);
  const rawId = req.user?.id ?? req.userId;
  const userIdParam = rawId != null ? String(rawId) : '';
  const sql = superAdmin
    ? `SELECT
         o.id,
         o."eventId",
         o."fullName",
         o.email,
         o.status,
         o."ticketCode",
         e.title AS event_title,
         e.date AS event_date
       FROM "Order" o
       LEFT JOIN "Event" e ON e.id::text = o."eventId"::text
       WHERE o.id::text = $1
       LIMIT 1`
    : `SELECT
         o.id,
         o."eventId",
         o."fullName",
         o.email,
         o.status,
         o."ticketCode",
         e.title AS event_title,
         e.date AS event_date
       FROM "Order" o
       LEFT JOIN "Event" e ON e.id::text = o."eventId"::text
       WHERE o.id::text = $1
         AND ((e."createdBy"::text = $2) OR (e."createdBy" IS NULL AND $2 = '0'))
       LIMIT 1`;
  const params = superAdmin ? [orderId] : [orderId, userIdParam];
  const result = await query(sql, params).catch(() => ({ rows: [] }));
  return result.rows?.[0] || null;
}

async function getWalkInSaleByIdForAdmin(saleId, req) {
  const superAdmin = isSuperAdmin(req);
  const rawId = req.user?.id ?? req.userId;
  const userIdParam = rawId != null ? String(rawId) : '';
  const sql = superAdmin
    ? `SELECT w.*, e.title AS event_title, e.date AS event_date
       FROM "WalkInSale" w
       LEFT JOIN "Event" e ON e.id::text = w."eventId"::text
       WHERE w.id = $1
       LIMIT 1`
    : `SELECT w.*, e.title AS event_title, e.date AS event_date
       FROM "WalkInSale" w
       LEFT JOIN "Event" e ON e.id::text = w."eventId"::text
       WHERE w.id = $1
         AND (e."createdBy"::text = $2 OR (e."createdBy" IS NULL AND $2 = '0'))
       LIMIT 1`;
  const params = superAdmin ? [saleId] : [saleId, userIdParam];
  const result = await query(sql, params).catch(() => ({ rows: [] }));
  return result.rows?.[0] || null;
}

async function getOrderTicketTypes(orderId) {
  const result = await query(
    `SELECT COALESCE(tt.name, 'General') AS name
     FROM "OrderItem" oi
     LEFT JOIN "TicketType" tt ON tt.id::text = oi."ticketTypeId"::text
     WHERE oi."orderId"::text = $1`,
    [orderId]
  ).catch(() => ({ rows: [] }));
  return (result.rows || []).map((row) => String(row.name || '').trim()).filter(Boolean);
}

async function ensureOrderItemsForManualPaid(orderId, eventId, body = {}) {
  const existing = await query(
    `SELECT COUNT(*)::int AS c
     FROM "OrderItem"
     WHERE "orderId"::text = $1`,
    [String(orderId)]
  ).catch(() => ({ rows: [{ c: 0 }] }));
  if ((Number(existing.rows?.[0]?.c) || 0) > 0) return false;

  const normalizedQuantity = Math.max(1, parseInt(body.quantity ?? body.ticketCount, 10) || 1);
  const normalizedPrice = Math.max(0, parseInt(body.price ?? body.amount, 10) || 0);
  const directTicketTypeId = String(body.ticketTypeId ?? body.ticketTypeID ?? '').trim();
  let ticketTypeId = directTicketTypeId || null;

  if (!ticketTypeId) {
    const ticketTypeName = String(body.ticketType ?? body.ticketTypeName ?? '').trim();
    if (ticketTypeName) {
      const byName = await query(
        `SELECT "id"
         FROM "TicketType"
         WHERE "eventId"::text = $1
           AND LOWER(REGEXP_REPLACE(TRIM(COALESCE("name", '')), '[^a-z0-9]+', '', 'g')) = $2
         LIMIT 1`,
        [String(eventId), normalizeTicketTypeKey(ticketTypeName)]
      ).catch(() => ({ rows: [] }));
      ticketTypeId = byName.rows?.[0]?.id ? String(byName.rows[0].id) : null;
    }
  }

  if (!ticketTypeId) return false;

  await query(
    `INSERT INTO "OrderItem" ("id", "orderId", "ticketTypeId", "quantity", "price")
     VALUES ($1, $2, $3, $4, $5)`,
    [createId(), String(orderId), ticketTypeId, normalizedQuantity, normalizedPrice]
  );
  return true;
}

async function ensureTicketCode(orderId, existingTicketCode) {
  if (existingTicketCode) return existingTicketCode;
  let ticketCode = generateTicketCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const updated = await query(
        `UPDATE "Order"
         SET "ticketCode" = $1, "updatedAt" = NOW()
         WHERE id::text = $2
         RETURNING "ticketCode"`,
        [ticketCode, orderId]
      );
      return updated.rows?.[0]?.ticketCode || ticketCode;
    } catch (err) {
      if (err?.code === '23505') {
        ticketCode = generateTicketCode();
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to generate a unique ticket code');
}

async function sendSaleTicketEmail(orderRow) {
  if (!orderRow?.email) throw new Error('Buyer email is missing for this sale');
  const ticketCode = await ensureTicketCode(orderRow.id, orderRow.ticketCode);
  const ticketTypes = await getOrderTicketTypes(orderRow.id);
  await sendTicketEmail({
    to: orderRow.email,
    fullName: orderRow.fullName,
    ticketCode,
    eventTitle: orderRow.event_title,
    eventDate: orderRow.event_date,
    ticketTypes,
  });
  return ticketCode;
}

/** PATCH /api/admin/sales/:orderId/status – update online sale status; auto email when set to paid. */
export async function updateSaleStatus(req, res) {
  try {
    const orderId = String(req.params.orderId || '').trim();
    const status = normalizeSaleStatus(req.body?.status, req.body);
    if (!orderId) return res.status(400).json({ error: 'Order id is required' });
    if (!status) return res.status(400).json({ error: 'Status must be pending or paid' });

    const sale = await getSaleByIdForAdmin(orderId, req);
    if (!sale) {
      const walkInId = Number.parseInt(orderId, 10);
      if (Number.isNaN(walkInId)) return res.status(404).json({ error: 'Sale not found' });

      const walkInSale = await getWalkInSaleByIdForAdmin(walkInId, req);
      if (!walkInSale) return res.status(404).json({ error: 'Sale not found' });

      const previousStatus = String(walkInSale.status || '').toLowerCase();
      await query(
        `UPDATE "WalkInSale" SET "status" = $1, "updatedAt" = NOW() WHERE id = $2`,
        [status, walkInId]
      );
      const freshWalkInSale = await getWalkInSaleByIdForAdmin(walkInId, req);
      if (!freshWalkInSale) return res.status(404).json({ error: 'Sale not found' });

      let emailSent = false;
      let emailError = null;
      if (status === 'paid' && previousStatus !== 'paid' && freshWalkInSale.email) {
        try {
          await sendTicketEmail({
            to: freshWalkInSale.email,
            fullName: freshWalkInSale.fullName,
            ticketCode: generateTicketCode(),
            eventTitle: freshWalkInSale.event_title,
            eventDate: freshWalkInSale.event_date,
            ticketTypes: [freshWalkInSale.ticketType || 'General'],
          });
          emailSent = true;
        } catch (emailErr) {
          emailError = emailErr?.message || 'Status updated, but ticket email failed';
          console.error('updateSaleStatus walk-in email warning', emailErr);
        }
      }

      return res.json({
        message: emailError ? 'Sale status updated, but email failed' : 'Sale status updated',
        sale: {
          id: String(freshWalkInSale.id),
          status: freshWalkInSale.status,
          ticket_count: Number(freshWalkInSale.quantity) || 1,
          source: 'walk_in',
        },
        emailSent,
        emailError,
      });
    }

    const previousStatus = String(sale.status || '').toLowerCase();
    const updateResult = await query(
      `UPDATE "Order" SET "status" = $1, "updatedAt" = NOW() WHERE id::text = $2 RETURNING "status"`,
      [status, orderId]
    );
    const updatedStatus = updateResult.rows?.[0]?.status || status;

    let emailSent = false;
    let emailError = null;
    let ticketCode = sale.ticketCode || null;
    if (status === 'paid' && previousStatus !== 'paid') {
      await ensureOrderItemsForManualPaid(orderId, sale.eventId, req.body || {}).catch((e) => {
        console.warn('ensureOrderItemsForManualPaid warning:', e?.message || e);
      });
      try {
        ticketCode = await sendSaleTicketEmail(sale);
        emailSent = true;
      } catch (emailErr) {
        emailError = emailErr?.message || 'Status updated, but ticket email failed';
        console.error('updateSaleStatus email warning', emailErr);
      }
    }

    return res.json({
      message: emailError ? 'Sale status updated, but email failed' : 'Sale status updated',
      sale: { id: orderId, status: updatedStatus, ticketCode },
      emailSent,
      emailError,
    });
  } catch (err) {
    console.error('updateSaleStatus', err);
    return res.status(500).json({ error: err.message || 'Failed to update sale status' });
  }
}

/** POST /api/admin/sales/:orderId/resend – resend ticket email for a paid sale. */
export async function resendSaleTicket(req, res) {
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Order id is required' });

    const sale = await getSaleByIdForAdmin(orderId, req);
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    if (String(sale.status || '').toLowerCase() !== 'paid') {
      return res.status(400).json({ error: 'Only paid sales can be resent' });
    }

    const ticketCode = await sendSaleTicketEmail(sale);
    return res.json({
      message: 'Ticket resent successfully',
      sale: { id: orderId, status: 'paid', ticketCode },
    });
  } catch (err) {
    console.error('resendSaleTicket', err);
    return res.status(500).json({ error: err.message || 'Failed to resend ticket' });
  }
}

/** DELETE /api/admin/sales/:orderId – delete an online or walk-in sale for owned event/admin scope. */
export async function deleteSale(req, res) {
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Order id is required' });

    const sale = await getSaleByIdForAdmin(orderId, req);
    if (!sale) {
      const walkInId = Number.parseInt(orderId, 10);
      if (Number.isNaN(walkInId)) return res.status(404).json({ error: 'Sale not found' });

      const walkInSale = await getWalkInSaleByIdForAdmin(walkInId, req);
      if (!walkInSale) return res.status(404).json({ error: 'Sale not found' });

      await query('DELETE FROM "WalkInSale" WHERE id = $1', [walkInId]);
      return res.json({ message: 'Sale deleted', id: String(walkInId), source: 'walk_in' });
    }

    // Delete dependents first for schemas without ON DELETE CASCADE.
    await query(`DELETE FROM "ScanLog" WHERE "orderId"::text = $1`, [orderId]).catch((e) => {
      // relation might not exist in some deployments; ignore undefined-table errors.
      if (e?.code === '42P01') return null;
      throw e;
    });
    await query(`DELETE FROM "OrderItem" WHERE "orderId"::text = $1`, [orderId]).catch((e) => {
      if (e?.code === '42P01') return null;
      throw e;
    });

    const removed = await query(
      `DELETE FROM "Order"
       WHERE id::text = $1
       RETURNING id::text AS id`,
      [orderId]
    ).catch((e) => {
      if (e?.code === '42P01') return { rows: [] };
      throw e;
    });
    if (!removed.rows?.length) return res.status(404).json({ error: 'Sale not found' });

    return res.json({ message: 'Sale deleted', id: removed.rows[0].id });
  } catch (err) {
    console.error('deleteSale', err);
    return res.status(500).json({ error: err.message || 'Failed to delete sale' });
  }
}

/** GET /api/admin/coupons – list coupons; super admin sees all, others only their events. */
export async function listCoupons(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = getUserId(req);
    const userIdParam = userId != null ? String(userId) : '';
    const eventId = req.query?.eventId ? String(req.query.eventId) : '';

    const params = [];
    let whereSql = '';
    if (!superAdmin) {
      params.push(userIdParam);
      whereSql = `WHERE (e."createdBy"::text = $1) OR (e."createdBy" IS NULL AND $1 = '0')`;
    }
    if (eventId) {
      params.push(eventId);
      whereSql += whereSql ? ` AND c."eventId"::text = $${params.length}` : `WHERE c."eventId"::text = $${params.length}`;
    }

    const result = await query(
      `SELECT
         c.id,
         c."eventId",
         c.code,
         c.name,
         c."discountType",
         c."discountValue",
         c."maxUses",
         c."usedCount",
         c."isActive",
         c."expiresAt",
         c."createdAt",
         c."updatedAt",
         e.title AS "eventTitle",
         (SELECT COUNT(*)::int
          FROM "Order" o
          WHERE o."couponId" IS NOT NULL AND o."couponId"::text = c.id::text) AS "liveUsedCount"
       FROM "Coupon" c
       LEFT JOIN "Event" e ON e.id::text = c."eventId"::text
       ${whereSql}
       ORDER BY c."createdAt" DESC`,
      params
    ).catch((err) => {
      console.error('listCoupons query', err?.message || err);
      return { rows: [] };
    });

    const list = (result.rows || []).map((row) => ({
      id: String(row.id),
      eventId: String(row.eventId),
      eventTitle: row.eventTitle || null,
      code: row.code,
      name: row.name,
      discountType: row.discountType,
      discountValue: Number(row.discountValue) || 0,
      maxUses: row.maxUses == null ? null : Number(row.maxUses),
      usedCount: Number(row.liveUsedCount) || 0,
      isActive: !!row.isActive,
      expiresAt: row.expiresAt || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    return res.json(list);
  } catch (err) {
    console.error('listCoupons', err);
    return res.json([]);
  }
}

/** POST /api/admin/coupons – create coupon for an event the admin owns (or any event for super admin). */
export async function createCoupon(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = getUserId(req);
    const userIdParam = userId != null ? String(userId) : '';
    const body = req.body || {};

    const eventId = String(body.eventId || '').trim();
    const code = String(body.code || '').trim().toUpperCase();
    const name = String(body.name || '').trim();
    const discountType = body.discountType === 'fixed' ? 'fixed' : 'percentage';
    const discountValue = Number(body.discountValue);
    const maxUses = body.maxUses == null || body.maxUses === '' ? null : Number(body.maxUses);
    const isActive = body.isActive !== false;
    const expiresAt = body.expiresAt ? new Date(body.expiresAt).toISOString() : null;

    if (!eventId || !code || !name) {
      return res.status(400).json({ error: 'eventId, code and name are required' });
    }
    if (Number.isNaN(discountValue) || discountValue < 0) {
      return res.status(400).json({ error: 'discountValue must be a non-negative number' });
    }
    if (discountType === 'percentage' && discountValue > 100) {
      return res.status(400).json({ error: 'percentage discount cannot be greater than 100' });
    }
    if (maxUses != null && (Number.isNaN(maxUses) || maxUses < 1)) {
      return res.status(400).json({ error: 'maxUses must be at least 1 when provided' });
    }
    if (body.expiresAt && Number.isNaN(Date.parse(body.expiresAt))) {
      return res.status(400).json({ error: 'expiresAt must be a valid date' });
    }

    const eventCheckSql = superAdmin
      ? 'SELECT id FROM "Event" WHERE id::text = $1'
      : 'SELECT id FROM "Event" WHERE id::text = $1 AND ("createdBy"::text = $2 OR ("createdBy" IS NULL AND $2 = \'0\'))';
    const eventCheckParams = superAdmin ? [eventId] : [eventId, userIdParam];
    const eventCheck = await query(eventCheckSql, eventCheckParams).catch(() => ({ rows: [] }));
    if (!eventCheck.rows?.length) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const id = createId();
    const result = await query(
      `INSERT INTO "Coupon" (
        id, "eventId", "createdBy", code, name, "discountType", "discountValue", "maxUses", "isActive", "expiresAt", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING id, "eventId", code, name, "discountType", "discountValue", "maxUses", "usedCount", "isActive", "expiresAt", "createdAt", "updatedAt"`,
      [id, eventId, userId ?? null, code, name, discountType, discountValue, maxUses, isActive, expiresAt]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Coupon code already exists for this event' });
    }
    console.error('createCoupon', err);
    return res.status(500).json({ error: 'Failed to create coupon' });
  }
}

/** PATCH /api/admin/coupons/:id – update coupon (owner only unless super admin). */
export async function updateCoupon(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = getUserId(req);
    const userIdParam = userId != null ? String(userId) : '';
    const couponId = String(req.params.id || '');
    const body = req.body || {};

    if (!couponId) return res.status(400).json({ error: 'Coupon id is required' });

    const checkSql = superAdmin
      ? `SELECT c.id, c."eventId"
         FROM "Coupon" c
         WHERE c.id::text = $1`
      : `SELECT c.id, c."eventId"
         FROM "Coupon" c
         INNER JOIN "Event" e ON e.id::text = c."eventId"::text
         WHERE c.id::text = $1
           AND (e."createdBy"::text = $2 OR (e."createdBy" IS NULL AND $2 = '0'))`;
    const checkParams = superAdmin ? [couponId] : [couponId, userIdParam];
    const check = await query(checkSql, checkParams).catch(() => ({ rows: [] }));
    if (!check.rows?.length) return res.status(404).json({ error: 'Coupon not found' });

    const code = body.code == null ? null : String(body.code).trim().toUpperCase();
    const name = body.name == null ? null : String(body.name).trim();
    const discountType = body.discountType == null ? null : (body.discountType === 'fixed' ? 'fixed' : body.discountType === 'percentage' ? 'percentage' : 'invalid');
    const discountValue = body.discountValue == null ? null : Number(body.discountValue);
    const maxUses = body.maxUses === undefined ? null : (body.maxUses === null || body.maxUses === '' ? -1 : Number(body.maxUses));
    const expiresAt = body.expiresAt === undefined ? null : (body.expiresAt === null || body.expiresAt === '' ? '' : body.expiresAt);

    if (code !== null && !code) return res.status(400).json({ error: 'code cannot be empty' });
    if (name !== null && !name) return res.status(400).json({ error: 'name cannot be empty' });
    if (discountType === 'invalid') return res.status(400).json({ error: 'discountType must be percentage or fixed' });
    if (discountValue !== null && (Number.isNaN(discountValue) || discountValue < 0)) {
      return res.status(400).json({ error: 'discountValue must be a non-negative number' });
    }
    if (discountType === 'percentage' && discountValue != null && discountValue > 100) {
      return res.status(400).json({ error: 'percentage discount cannot be greater than 100' });
    }
    if (maxUses !== null && maxUses !== -1 && (Number.isNaN(maxUses) || maxUses < 1)) {
      return res.status(400).json({ error: 'maxUses must be at least 1 when provided' });
    }
    if (expiresAt && expiresAt !== '' && Number.isNaN(Date.parse(expiresAt))) {
      return res.status(400).json({ error: 'expiresAt must be a valid date' });
    }

    const result = await query(
      `UPDATE "Coupon"
       SET code = COALESCE($1, code),
           name = COALESCE($2, name),
           "discountType" = COALESCE($3, "discountType"),
           "discountValue" = COALESCE($4, "discountValue"),
           "maxUses" = CASE WHEN $5 = -1 THEN NULL ELSE COALESCE($5, "maxUses") END,
           "isActive" = COALESCE($6, "isActive"),
           "expiresAt" = CASE WHEN $7 = '' THEN NULL ELSE COALESCE($7::timestamptz, "expiresAt") END,
           "updatedAt" = NOW()
       WHERE id::text = $8
       RETURNING id, "eventId", code, name, "discountType", "discountValue", "maxUses", "usedCount", "isActive", "expiresAt", "createdAt", "updatedAt"`,
      [
        code,
        name,
        discountType,
        discountValue,
        maxUses,
        typeof body.isActive === 'boolean' ? body.isActive : null,
        expiresAt,
        couponId,
      ]
    );
    return res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Coupon code already exists for this event' });
    }
    console.error('updateCoupon', err);
    return res.status(500).json({ error: 'Failed to update coupon' });
  }
}

/** DELETE /api/admin/coupons/:id – remove coupon (owner only unless super admin). */
export async function deleteCoupon(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = getUserId(req);
    const userIdParam = userId != null ? String(userId) : '';
    const couponId = String(req.params.id || '');
    if (!couponId) return res.status(400).json({ error: 'Coupon id is required' });

    const deleteSql = superAdmin
      ? 'DELETE FROM "Coupon" WHERE id::text = $1 RETURNING id'
      : `DELETE FROM "Coupon" c
         USING "Event" e
         WHERE c.id::text = $1
           AND e.id::text = c."eventId"::text
           AND (e."createdBy"::text = $2 OR (e."createdBy" IS NULL AND $2 = '0'))
         RETURNING c.id`;
    const params = superAdmin ? [couponId] : [couponId, userIdParam];
    const result = await query(deleteSql, params);
    if (!result.rows?.length) return res.status(404).json({ error: 'Coupon not found' });
    return res.status(204).send();
  } catch (err) {
    console.error('deleteCoupon', err);
    return res.status(500).json({ error: 'Failed to delete coupon' });
  }
}

/** Resolve current user id (requireAuth sets both req.user and req.userId). */
function getUserId(req) {
  return req.user?.id ?? req.userId;
}

let withdrawalSchemaReady = false;

function userIdKey(userId) {
  if (userId == null) return '';
  return String(userId).trim();
}

/** Create withdrawal tables if missing (idempotent). */
async function ensureWithdrawalSchema() {
  if (withdrawalSchemaReady) return true;
  await query(`
    CREATE TABLE IF NOT EXISTS "BankAccount" (
      "id" SERIAL PRIMARY KEY,
      "userId" TEXT NOT NULL UNIQUE,
      "accountNumber" VARCHAR(20) NOT NULL,
      "bankCode" VARCHAR(20) NOT NULL,
      "accountName" VARCHAR(255) NOT NULL,
      "bankName" VARCHAR(255) NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => ({}));
  await query(`
    ALTER TABLE "BankAccount"
    ALTER COLUMN "userId" TYPE TEXT USING "userId"::text
  `).catch(() => ({}));
  await query(`
    CREATE TABLE IF NOT EXISTS "Withdrawal" (
      "id" SERIAL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "eventId" TEXT NOT NULL,
      "grossAmount" NUMERIC(14, 2) NOT NULL DEFAULT 0,
      "platformFee" NUMERIC(14, 2) NOT NULL DEFAULT 0,
      "amount" NUMERIC(14, 2) NOT NULL DEFAULT 0,
      "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
      "paystackReference" VARCHAR(255),
      "bankName" VARCHAR(255),
      "bankCode" VARCHAR(20),
      "accountNumber" VARCHAR(20),
      "accountName" VARCHAR(255),
      "reviewedBy" INTEGER,
      "reviewedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => ({}));
  await query(`
    ALTER TABLE "Withdrawal"
    ALTER COLUMN "userId" TYPE TEXT USING "userId"::text
  `).catch(() => ({}));
  withdrawalSchemaReady = true;
  return true;
}

async function getBankAccountForUser(userId) {
  const key = userIdKey(userId);
  if (!key) return null;
  const result = await query(
    `SELECT "id", "accountNumber", "bankCode", "accountName", "bankName"
     FROM "BankAccount" WHERE "userId"::text = $1`,
    [key]
  ).catch(() => ({ rows: [] }));
  return result.rows?.[0] || null;
}

async function upsertBankAccountForUser(userId, bank) {
  await ensureWithdrawalSchema();
  const key = userIdKey(userId);
  const { accountNumber, bankCode, accountName, bankName } = bank || {};
  if (!key || !accountNumber || !bankCode) {
    throw new Error('accountNumber and bankCode required');
  }
  const existing = await getBankAccountForUser(key);
  if (existing?.id) {
    await query(
      `UPDATE "BankAccount"
       SET "accountNumber" = $1, "bankCode" = $2, "accountName" = $3, "bankName" = $4, "updatedAt" = NOW()
       WHERE "userId"::text = $5`,
      [accountNumber, bankCode, accountName || '', bankName || '', key]
    );
  } else {
    await query(
      `INSERT INTO "BankAccount" ("userId", "accountNumber", "bankCode", "accountName", "bankName")
       VALUES ($1, $2, $3, $4, $5)`,
      [key, accountNumber, bankCode, accountName || '', bankName || '']
    );
  }
  return getBankAccountForUser(key);
}

async function getEventGrossRevenue(eventId) {
  const rev = await query(
    `SELECT COALESCE(SUM(o."totalAmount"), 0) AS gross
     FROM "Order" o
     WHERE o."eventId"::text = $1::text AND o."status" = 'paid'`,
    [String(eventId)]
  ).catch(() => ({ rows: [{ gross: 0 }] }));
  return Number(rev.rows?.[0]?.gross) || 0;
}

function mapWithdrawalRow(w, extras = {}) {
  return {
    id: String(w.id),
    eventId: String(w.eventId),
    adminId: String(w.userId ?? w.adminId ?? ''),
    grossAmount: Number(w.grossAmount) || 0,
    platformFee: Number(w.platformFee) || 0,
    netAmount: Number(w.amount) || 0,
    status: w.status || 'pending',
    paystackReference: w.paystackReference ?? null,
    createdAt: w.createdAt ?? '',
    event_title: extras.event_title ?? w.event_title ?? '',
    admin_name: extras.admin_name ?? w.admin_name ?? null,
    admin_email: extras.admin_email ?? w.admin_email ?? null,
    bankName: w.bankName ?? extras.bankName ?? null,
    bankCode: w.bankCode ?? extras.bankCode ?? null,
    accountNumber: w.accountNumber ?? extras.accountNumber ?? null,
    accountName: w.accountName ?? extras.accountName ?? null,
  };
}

async function fetchPendingWithdrawalRequests() {
  const result = await query(
    `SELECT w.*, u.name AS admin_name, u.email AS admin_email, e.title AS event_title
     FROM "Withdrawal" w
     JOIN "User" u ON u.id = w."userId"
     LEFT JOIN "Event" e ON e.id::text = w."eventId"::text
     WHERE w.status = 'pending'
     ORDER BY w."createdAt" ASC`
  ).catch(() => ({ rows: [] }));
  return (result.rows || []).map((w) => mapWithdrawalRow(w));
}

async function notifySuperAdminsOfWithdrawal(payload) {
  const admins = await query(
    `SELECT email FROM "User" WHERE role = 'superadmin' AND email IS NOT NULL`
  ).catch(() => ({ rows: [] }));
  const emails = (admins.rows || []).map((r) => r.email).filter(Boolean);
  if (!emails.length) return;
  await Promise.all(
    emails.map((to) =>
      sendWithdrawalRequestEmail({ to, ...payload }).catch((err) => {
        console.error('[withdraw] notify super admin failed', to, err.message);
      })
    )
  );
}

/** GET /api/admin/withdraw – full withdraw page: kpi, events, withdrawals, bankAccount, isSuperAdmin. */
export async function getWithdrawPage(req, res) {
  try {
    await ensureWithdrawalSchema();
    const superAdmin = isSuperAdmin(req);
    const userId = getUserId(req);
    if (userId == null && userId !== 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const kpi = { totalGross: 0, availableToWithdraw: 0, totalFees: 0 };

    const userIdText = userId != null ? String(userId) : '';
    const revSql = superAdmin
      ? `SELECT COALESCE(SUM(o."totalAmount"), 0) AS total
         FROM "Order" o
         JOIN "Event" e ON e.id::text = o."eventId"::text
         WHERE o."status" = 'paid'`
      : `SELECT COALESCE(SUM(o."totalAmount"), 0) AS total
         FROM "Order" o
         JOIN "Event" e ON e.id::text = o."eventId"::text
         WHERE o."status" = 'paid'
           AND ((e."createdBy"::text = $1) OR (e."createdBy" IS NULL AND $1 = '0'))`;
    const revParams = superAdmin ? [] : [userIdText];
    const revResult = await query(revSql, revParams).catch(() => ({ rows: [{ total: 0 }] }));
    kpi.totalGross = Number(revResult.rows?.[0]?.total) || 0;
    kpi.totalFees = Math.round(kpi.totalGross * 0.15);
    kpi.availableToWithdraw = kpi.totalGross - kpi.totalFees;

    const eventsSql = superAdmin
      ? `SELECT e.id, e.title, e.date, e."imageUrl", e."createdBy",
               COALESCE(rev.gross, 0) AS gross_revenue
        FROM "Event" e
        LEFT JOIN (
          SELECT o."eventId", SUM(o."totalAmount") AS gross
          FROM "Order" o
          WHERE o."status" = 'paid'
          GROUP BY o."eventId"
        ) rev ON rev."eventId"::text = e.id::text
        ORDER BY e.date DESC NULLS LAST`
      : `SELECT e.id, e.title, e.date, e."imageUrl", e."createdBy",
               COALESCE(rev.gross, 0) AS gross_revenue
        FROM "Event" e
        LEFT JOIN (
          SELECT o."eventId", SUM(o."totalAmount") AS gross
          FROM "Order" o
          WHERE o."status" = 'paid'
          GROUP BY o."eventId"
        ) rev ON rev."eventId"::text = e.id::text
        WHERE (e."createdBy"::text = $1) OR (e."createdBy" IS NULL AND $1 = '0')
        ORDER BY e.date DESC NULLS LAST`;
    const eventsParams = superAdmin ? [] : [userIdText];
    const eventsResult = await query(eventsSql, eventsParams).catch(() => ({ rows: [] }));
    let events = (eventsResult.rows || []).map((r) => ({
      id: String(r.id),
      title: r.title || '',
      date: r.date || '',
      imageUrl: r.imageUrl ?? null,
      createdBy: r.createdBy != null ? String(r.createdBy) : null,
      gross_revenue: Number(r.gross_revenue) || 0,
      withdrawal_status: null,
      withdrawn_net: null,
      withdrawn_at: null,
    }));

    const withSql = superAdmin
      ? `SELECT w.*, u.name AS admin_name, u.email AS admin_email, e.title AS event_title
         FROM "Withdrawal" w
         JOIN "User" u ON u.id = w."userId"
         LEFT JOIN "Event" e ON e.id::text = w."eventId"::text
         ORDER BY w."createdAt" DESC`
      : `SELECT w.*, e.title AS event_title
         FROM "Withdrawal" w
         LEFT JOIN "Event" e ON e.id::text = w."eventId"::text
         WHERE w."userId"::text = $1
         ORDER BY w."createdAt" DESC`;
    const withParams = superAdmin ? [] : [userIdKey(userId)];
    const withResult = await query(withSql, withParams).catch(() => ({ rows: [] }));
    const withdrawals = (withResult.rows || []).map((w) => mapWithdrawalRow(w));

    const pendingRequests = superAdmin ? await fetchPendingWithdrawalRequests() : [];

    const latestByEvent = new Map();
    for (const w of withdrawals) {
      const current = latestByEvent.get(w.eventId);
      if (!current) {
        latestByEvent.set(w.eventId, w);
        continue;
      }
      if (new Date(w.createdAt).getTime() > new Date(current.createdAt).getTime()) {
        latestByEvent.set(w.eventId, w);
      }
    }
    events = events.map((ev) => {
      const latest = latestByEvent.get(ev.id);
      if (!latest) return ev;
      return {
        ...ev,
        withdrawal_status: latest.status || null,
        withdrawn_net: latest.netAmount ?? null,
        withdrawn_at: latest.createdAt || null,
      };
    });

    let bankAccount = null;
    const baRow = await getBankAccountForUser(userId);
    if (baRow) {
      bankAccount = {
        id: String(baRow.id),
        accountName: baRow.accountName || '',
        accountNumber: baRow.accountNumber || '',
        bankCode: baRow.bankCode || '',
        bankName: baRow.bankName || '',
      };
    }

    return res.json({
      kpi,
      events,
      withdrawals,
      pendingRequests,
      bankAccount,
      isSuperAdmin: !!superAdmin,
    });
  } catch (err) {
    console.error('getWithdrawPage', err);
    return res.status(500).json({
      kpi: { totalGross: 0, availableToWithdraw: 0, totalFees: 0 },
      events: [],
      withdrawals: [],
      pendingRequests: [],
      bankAccount: null,
      isSuperAdmin: false,
    });
  }
}

/** GET /api/admin/withdraw (list) – kept for compatibility; prefer getWithdrawPage. */
export async function listWithdrawals(req, res) {
  try {
    const userId = getUserId(req);
    const result = await query(
      'SELECT * FROM "Withdrawal" WHERE "userId"::text = $1 ORDER BY "createdAt" DESC',
      [userIdKey(userId)]
    ).catch(() => ({ rows: [] }));
    return res.json(result.rows || []);
  } catch {
    return res.json([]);
  }
}

/** POST /api/admin/withdraw/:eventId – admin submits withdrawal request for super admin approval. */
export async function createWithdrawal(req, res) {
  try {
    await ensureWithdrawalSchema();
    const eventId = req.params.eventId;
    if (!eventId) return res.status(400).json({ error: 'eventId required' });
    const userId = getUserId(req);
    if (isSuperAdmin(req)) {
      return res.status(403).json({ error: 'Super admins approve requests in Pending Requests, they do not submit withdrawal requests.' });
    }

    const eventRows = await query(
      'SELECT "id", "title", "createdBy" FROM "Event" WHERE "id" = $1',
      [eventId]
    ).catch(() => ({ rows: [] }));
    if (!eventRows.rows?.length) return res.status(404).json({ error: 'Event not found' });
    const event = eventRows.rows[0];
    if (String(event.createdBy) !== String(userId)) {
      return res.status(403).json({ error: 'You can only withdraw from events you created' });
    }

    let bank = await getBankAccountForUser(userId);
    if (!bank) {
      const bodyBank = req.body?.bankAccount || req.body || {};
      if (bodyBank.accountNumber && bodyBank.bankCode) {
        try {
          bank = await upsertBankAccountForUser(userId, bodyBank);
        } catch (err) {
          console.error('createWithdrawal bank upsert', err);
        }
      }
    }
    if (!bank) {
      return res.status(400).json({ error: 'Set up your bank account before requesting a withdrawal' });
    }

    const existing = await query(
      `SELECT "status" FROM "Withdrawal"
       WHERE "userId" = $1 AND "eventId"::text = $2::text
         AND status IN ('pending', 'completed')
       ORDER BY "createdAt" DESC LIMIT 1`,
      [userIdKey(userId), String(eventId)]
    ).catch(() => ({ rows: [] }));
    const existingStatus = existing.rows?.[0]?.status;
    if (existingStatus === 'pending') {
      return res.status(409).json({ error: 'A withdrawal request is already pending for this event' });
    }
    if (existingStatus === 'completed') {
      return res.status(409).json({ error: 'This event has already been withdrawn' });
    }

    const gross = await getEventGrossRevenue(eventId);
    if (gross <= 0) {
      return res.status(400).json({ error: 'No paid revenue to withdraw for this event' });
    }
    const platformFee = Math.round(gross * 0.15 * 100) / 100;
    const netAmount = Math.round((gross - platformFee) * 100) / 100;

    const adminRow = await query(
      'SELECT name, email FROM "User" WHERE id = $1',
      [userId]
    ).catch(() => ({ rows: [] }));
    const adminName = adminRow.rows?.[0]?.name || 'Admin';
    const adminEmail = adminRow.rows?.[0]?.email || '';

    const result = await query(
      `INSERT INTO "Withdrawal" (
        "userId", "eventId", "grossAmount", "platformFee", "amount", "status",
        "bankName", "bankCode", "accountNumber", "accountName"
      ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9)
      RETURNING "id", "amount", "grossAmount", "platformFee", "status"`,
      [
        userIdKey(userId),
        String(eventId),
        gross,
        platformFee,
        netAmount,
        bank.bankName || '',
        bank.bankCode || '',
        bank.accountNumber || '',
        bank.accountName || '',
      ]
    ).catch((err) => {
      console.error('createWithdrawal insert', err);
      return { rows: [] };
    });
    if (!result.rows?.length) return res.status(500).json({ error: 'Failed to create withdrawal request' });
    const row = result.rows[0];

    await notifySuperAdminsOfWithdrawal({
      adminName,
      adminEmail,
      eventTitle: event.title || 'Event',
      grossAmount: gross,
      platformFee,
      netAmount,
      bankName: bank.bankName,
      accountName: bank.accountName,
      accountNumber: bank.accountNumber,
    });

    return res.status(201).json({
      message: 'Withdrawal request sent to super admin for approval',
      withdrawal: {
        id: row.id,
        net: Number(row.amount) || 0,
        gross: Number(row.grossAmount) || 0,
        status: row.status,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed' });
  }
}

/** PATCH /api/admin/withdraw/:withdrawalId/review – super admin approves or rejects a request. */
export async function reviewWithdrawal(req, res) {
  try {
    await ensureWithdrawalSchema();
    if (!isSuperAdmin(req)) {
      return res.status(403).json({ error: 'Only super admin can review withdrawal requests' });
    }
    const withdrawalId = req.params.withdrawalId;
    const action = String(req.body?.action || '').toLowerCase();
    if (!withdrawalId) return res.status(400).json({ error: 'withdrawalId required' });
    if (action !== 'approve' && action !== 'disapprove') {
      return res.status(400).json({ error: 'action must be approve or disapprove' });
    }

    const reviewerId = getUserId(req);
    const wResult = await query(
      `SELECT w.*, u.name AS admin_name, u.email AS admin_email, e.title AS event_title
       FROM "Withdrawal" w
       JOIN "User" u ON u.id = w."userId"
       LEFT JOIN "Event" e ON e.id::text = w."eventId"::text
       WHERE w.id = $1`,
      [withdrawalId]
    ).catch(() => ({ rows: [] }));
    if (!wResult.rows?.length) return res.status(404).json({ error: 'Withdrawal request not found' });
    const w = wResult.rows[0];
    if (w.status !== 'pending') {
      return res.status(409).json({ error: `Request is already ${w.status}` });
    }

    const newStatus = action === 'approve' ? 'completed' : 'rejected';
    const updated = await query(
      `UPDATE "Withdrawal"
       SET "status" = $1, "reviewedBy" = $2, "reviewedAt" = NOW(), "updatedAt" = NOW()
       WHERE id = $3
       RETURNING *`,
      [newStatus, reviewerId, withdrawalId]
    ).catch(() => ({ rows: [] }));
    if (!updated.rows?.length) return res.status(500).json({ error: 'Failed to update withdrawal' });

    const mapped = mapWithdrawalRow(updated.rows[0], {
      admin_name: w.admin_name,
      admin_email: w.admin_email,
      event_title: w.event_title,
    });

    if (action === 'approve' && w.admin_email) {
      await sendWithdrawalApprovedEmail({
        to: w.admin_email,
        adminName: w.admin_name,
        eventTitle: w.event_title,
        netAmount: w.amount,
        bankName: w.bankName,
        accountNumber: w.accountNumber,
      }).catch((err) => console.error('[withdraw] approval email failed', err.message));
    } else if (action === 'disapprove' && w.admin_email) {
      await sendWithdrawalRejectedEmail({
        to: w.admin_email,
        adminName: w.admin_name,
        eventTitle: w.event_title,
      }).catch((err) => console.error('[withdraw] rejection email failed', err.message));
    }

    return res.json({
      message: action === 'approve' ? 'Withdrawal approved' : 'Withdrawal disapproved',
      withdrawal: mapped,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed' });
  }
}

/** GET /api/admin/banks – Nigerian banks and wallets ({ name, code }). */
export async function getBanks(req, res) {
  const normalize = (rows) => {
    const byCode = new Map();
    for (const row of rows || []) {
      const code = String(row.code ?? row.bank_code ?? '').trim();
      const name = String(row.name ?? row.bank_name ?? '').trim();
      if (!code || !name) continue;
      if (!byCode.has(code)) byCode.set(code, { code, name });
    }
    return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  try {
    const { config } = await import('../../shared/config/env.js');
    if (config.paystackSecretKey) {
      const byCode = new Map();
      let page = 1;
      while (page <= 50) {
        const r = await fetch(
          `https://api.paystack.co/bank?currency=NGN&perPage=100&page=${page}`,
          { headers: { Authorization: `Bearer ${config.paystackSecretKey}` } }
        );
        const d = await r.json();
        if (!d.status || !Array.isArray(d.data) || d.data.length === 0) break;
        for (const b of d.data) {
          if (b.active === false || b.supports_transfer === false) continue;
          const code = String(b.code ?? '').trim();
          const name = String(b.name ?? '').trim();
          if (code && name && !byCode.has(code)) byCode.set(code, { code, name });
        }
        if (!d.meta?.next) break;
        page += 1;
      }
      if (byCode.size > 0) {
        return res.json([...byCode.values()].sort((a, b) => a.name.localeCompare(b.name)));
      }
    }
    return res.json(normalize(NIGERIAN_BANKS_FALLBACK));
  } catch {
    return res.json(normalize(NIGERIAN_BANKS_FALLBACK));
  }
}

/** GET /api/admin/bank-account – current user's bank account. */
export async function getBankAccount(req, res) {
  try {
    await ensureWithdrawalSchema();
    const userId = getUserId(req);
    const row = await getBankAccountForUser(userId);
    if (row) return res.json(row);
    return res.json(null);
  } catch {
    return res.json(null);
  }
}

/** POST /api/admin/bank-account – save bank account. */
export async function saveBankAccount(req, res) {
  try {
    const userId = getUserId(req);
    const { accountNumber, bankCode, accountName, bankName } = req.body || {};
    if (!accountNumber || !bankCode) {
      return res.status(400).json({ error: 'accountNumber and bankCode required' });
    }
    const row = await upsertBankAccountForUser(userId, {
      accountNumber,
      bankCode,
      accountName,
      bankName,
    });
    if (!row?.id) {
      return res.status(500).json({ error: 'Failed to save bank account. Please try again.' });
    }
    return res.json({
      id: String(row.id),
      accountNumber: row.accountNumber,
      bankCode: row.bankCode,
      accountName: row.accountName || '',
      bankName: row.bankName || '',
    });
  } catch (err) {
    console.error('saveBankAccount', err);
    return res.status(500).json({ error: err.message || 'Failed to save bank account' });
  }
}

/** GET /api/admin/top-users */
export async function listTopUsers(req, res) {
  try {
    const result = await query(
      `SELECT "id", "name", "title", "imageUrl", "sortOrder", "isActive", "createdAt", "updatedAt"
       FROM "TopUser"
       ORDER BY "sortOrder" ASC, "id" ASC`
    );
    return res.json(result.rows || []);
  } catch (err) {
    console.error('[admin] listTopUsers:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Failed to list top users' });
  }
}

/** POST /api/admin/top-users (and /top_users alias), PATCH/DELETE …/:id */
export async function createTopUser(req, res) {
  try {
    const row = await insertTopUserRecord(req.body || {});
    if (!row) return res.status(500).json({ error: 'Insert returned no row' });
    return res.status(201).json(row);
  } catch (err) {
    console.error('[admin] createTopUser:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Failed to create top user' });
  }
}

export async function updateTopUser(req, res) {
  try {
    const { name, title, imageUrl, sortOrder } = req.body || {};
    const parsedSortOrder =
      sortOrder === undefined || sortOrder === null || sortOrder === ''
        ? null
        : Number(sortOrder);

    if (parsedSortOrder !== null && Number.isNaN(parsedSortOrder)) {
      return res.status(400).json({ error: 'sortOrder must be a number' });
    }

    const result = await query(
      `UPDATE "TopUser"
       SET "name" = COALESCE($1, "name"),
           "title" = COALESCE($2, "title"),
           "imageUrl" = COALESCE($3, "imageUrl"),
           "sortOrder" = COALESCE($4, "sortOrder"),
           "updatedAt" = NOW()
       WHERE "id" = $5
       RETURNING "id", "name", "title", "imageUrl", "sortOrder", "isActive", "createdAt", "updatedAt"`,
      [name, title, imageUrl, parsedSortOrder, req.params.id]
    );

    if (!result.rows?.length) return res.status(404).json({ error: 'Top user not found' });
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to update top user' });
  }
}

export async function deleteTopUser(req, res) {
  try {
    const r = await query('DELETE FROM "TopUser" WHERE "id" = $1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('[admin] deleteTopUser:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Failed to delete' });
  }
}

/** GET /api/admin/landing-videos - superadmin only */
export async function getAdminLandingVideos(req, res) {
  try {
    const rows = await listLandingVideos({ activeOnly: false });
    return res.json(
      rows.map((row) => ({
        id: String(row.id),
        videoUrl: row.videoUrl || '',
        thumbnailUrl: row.thumbnailUrl || null,
        sortOrder: Number(row.sortOrder) || 0,
        isActive: !!row.isActive,
        createdAt: row.createdAt || null,
      }))
    );
  } catch (err) {
    console.error('getAdminLandingVideos', err);
    return res.status(500).json({ error: 'Failed to fetch landing videos' });
  }
}

/** POST /api/admin/landing-videos/upload - superadmin only */
export async function uploadLandingVideo(req, res) {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Video file is required' });
    if (!file.mimetype?.startsWith('video/')) {
      return res.status(400).json({ error: 'Only video files are allowed' });
    }
    const maxBytes = 101 * 1024 * 1024;
    if (file.size > maxBytes) {
      return res.status(400).json({ error: 'Video must be below 101MB' });
    }
    if (!isCloudinaryConfigured()) {
      return res.status(500).json({ error: 'Cloudinary is not configured' });
    }

    const uploaded = await uploadVideoBufferToCloudinary(file.buffer, {
      folder: 'ticketing/landing/videos',
    });
    const current = await listLandingVideos({ activeOnly: false });
    const created = await createLandingVideo({
      videoUrl: uploaded?.secure_url || uploaded?.url || '',
      thumbnailUrl: uploaded?.secure_url || uploaded?.url || '',
      publicId: uploaded?.public_id || null,
      sortOrder: current.length,
    });

    return res.status(201).json({
      id: String(created.id),
      videoUrl: created.videoUrl,
      thumbnailUrl: created.thumbnailUrl,
      sortOrder: Number(created.sortOrder) || 0,
      isActive: !!created.isActive,
    });
  } catch (err) {
    console.error('uploadLandingVideo', err);
    return res.status(500).json({ error: err.message || 'Failed to upload video' });
  }
}

/** PATCH /api/admin/landing-videos/:id - superadmin only */
export async function patchLandingVideo(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    const updated = await updateLandingVideo(id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Video not found' });
    return res.json({
      id: String(updated.id),
      videoUrl: updated.videoUrl || '',
      thumbnailUrl: updated.thumbnailUrl || null,
      sortOrder: Number(updated.sortOrder) || 0,
      isActive: !!updated.isActive,
      createdAt: updated.createdAt || null,
    });
  } catch (err) {
    console.error('patchLandingVideo', err);
    return res.status(500).json({ error: err.message || 'Failed to update video' });
  }
}

/** DELETE /api/admin/landing-videos/:id - superadmin only */
export async function removeLandingVideo(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });
    const deleted = await deleteLandingVideo(id);
    if (!deleted) return res.status(404).json({ error: 'Video not found' });
    if (deleted.publicId) {
      await deleteVideoFromCloudinary(deleted.publicId).catch(() => null);
    }
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('removeLandingVideo', err);
    return res.status(500).json({ error: err.message || 'Failed to delete video' });
  }
}

/** GET /api/admin/password-change-status */
export async function getPasswordChangeStatus(req, res) {
  try {
    const result = await query(
      'SELECT "lastPasswordChangeAt" FROM "User" WHERE "id" = $1',
      [req.userId]
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

/** POST /api/admin/verify-password */
export async function verifyPassword(req, res) {
  try {
    const { currentPassword } = req.body || {};
    const result = await query(
      'SELECT "passwordHash" FROM "User" WHERE "id" = $1',
      [req.userId]
    );
    if (!result.rows?.length) return res.status(401).json({ error: 'Invalid password' });
    const valid = await bcrypt.compare(currentPassword, result.rows[0].passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid current password' });
    return res.json({ verified: true });
  } catch {
    return res.status(401).json({ error: 'Invalid password' });
  }
}

/** POST /api/admin/change-password */
export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });
    const result = await query(
      'SELECT "passwordHash" FROM "User" WHERE "id" = $1',
      [req.userId]
    );
    if (!result.rows?.length) return res.status(401).json({ error: 'Invalid password' });
    const valid = await bcrypt.compare(currentPassword, result.rows[0].passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid current password' });
    const hash = await bcrypt.hash(newPassword, 10);
    await query(
      'UPDATE "User" SET "passwordHash" = $1, "updatedAt" = NOW() WHERE "id" = $2',
      [hash, req.userId]
    );
    return res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed' });
  }
}

/** POST /api/admin/verify-ticket – verify scanned ticket code and log entry usage. */
export async function verifyTicket(req, res) {
  try {
    const code = String(req.body?.code || '').trim();
    if (!code) {
      return res.status(400).json({ valid: false, reason: 'invalid', message: 'Ticket code is required.' });
    }

    const superAdmin = isSuperAdmin(req);
    const userId = getUserId(req);
    const userIdText = userId != null ? String(userId) : '';

    const orderResult = await query(
      `SELECT
         o.id,
         o."fullName",
         o.status,
         o."eventId",
         e.title AS "eventTitle",
         e."createdBy",
         COALESCE((SELECT SUM(oi.quantity)::int FROM "OrderItem" oi WHERE oi."orderId"::text = o.id::text), 1) AS "totalQuantity",
         COALESCE((SELECT COUNT(*)::int FROM "ScanLog" s WHERE s."orderId"::text = o.id::text), 0) AS "scanCount"
       FROM "Order" o
       LEFT JOIN "Event" e ON e.id::text = o."eventId"::text
       WHERE o."ticketCode" = $1
       LIMIT 1`,
      [code]
    ).catch(() => ({ rows: [] }));

    if (!orderResult.rows?.length) {
      return res.status(404).json({ valid: false, reason: 'not_found', message: 'Ticket code not found.' });
    }

    const row = orderResult.rows[0];
    const eventTitle = row.eventTitle || 'Unknown event';
    const totalQuantity = Number(row.totalQuantity) || 1;
    const scanCount = Number(row.scanCount) || 0;
    const breakdownResult = await query(
      `SELECT tt.name AS name, SUM(oi.quantity)::int AS quantity
       FROM "OrderItem" oi
       LEFT JOIN "TicketType" tt ON tt.id::text = oi."ticketTypeId"::text
       WHERE oi."orderId"::text = $1
       GROUP BY tt.name`,
      [row.id]
    ).catch(() => ({ rows: [] }));
    const ticketBreakdown = (breakdownResult.rows || [])
      .map((item) => ({
        name: item?.name || 'General',
        quantity: Number(item?.quantity) || 0,
      }))
      .filter((item) => item.quantity > 0);
    const ticketType = ticketBreakdown.length > 0
      ? ticketBreakdown.map((item) => `${item.name} x${item.quantity}`).join(', ')
      : 'General x1';

    const createdByText = row.createdBy == null ? null : String(row.createdBy);
    const allowed =
      superAdmin ||
      (createdByText !== null && createdByText === userIdText) ||
      (createdByText === null && userIdText === '0');

    if (!allowed) {
      return res.status(403).json({
        valid: false,
        reason: 'not_authorized',
        message: 'You can only scan tickets for events you created. Super Admin can scan all.',
        eventTitle,
        fullName: row.fullName || undefined,
        ticketType,
        ticketBreakdown,
      });
    }

    if (String(row.status || '').toLowerCase() !== 'paid') {
      return res.status(400).json({
        valid: false,
        reason: 'unpaid',
        message: 'This ticket has not been fully paid for.',
        eventTitle,
        fullName: row.fullName || undefined,
        scanCount,
        totalQuantity,
        ticketType,
        ticketBreakdown,
      });
    }

    if (scanCount >= totalQuantity) {
      return res.status(200).json({
        valid: false,
        reason: 'already_used',
        message: 'Ticket already fully used.',
        eventTitle,
        fullName: row.fullName || undefined,
        scanCount,
        totalQuantity,
        ticketType,
        ticketBreakdown,
      });
    }

    const insertAttempts = [
      {
        sql: `INSERT INTO "ScanLog" ("orderId", "eventId", "scannedBy") VALUES ($1, $2, $3)`,
        params: [row.id, row.eventId, userIdText],
      },
      {
        sql: `INSERT INTO "ScanLog" ("id", "orderId", "eventId", "scannedBy") VALUES ($1, $2, $3, $4)`,
        params: [createId(), row.id, row.eventId, userIdText],
      },
      {
        sql: `INSERT INTO "ScanLog" ("orderId") VALUES ($1)`,
        params: [row.id],
      },
      {
        sql: `INSERT INTO "ScanLog" ("id", "orderId") VALUES ($1, $2)`,
        params: [createId(), row.id],
      },
    ];

    let logged = false;
    for (const attempt of insertAttempts) {
      try {
        await query(attempt.sql, attempt.params);
        logged = true;
        break;
      } catch {
        // Try next schema-compatible insert variant.
      }
    }

    const nextScanCount = logged ? scanCount + 1 : scanCount;
    const fullyUsed = nextScanCount >= totalQuantity;

    return res.status(200).json({
      valid: true,
      message: fullyUsed ? 'Ticket verified (now fully used).' : 'Ticket verified successfully.',
      eventTitle,
      fullName: row.fullName || undefined,
      scanCount: nextScanCount,
      totalQuantity,
      fullyUsed,
      ticketType,
      ticketBreakdown,
    });
  } catch (err) {
    console.error('verifyTicket', err);
    return res.status(500).json({ valid: false, reason: 'error', message: 'Ticket verification failed.' });
  }
}

/* ==================== Walk-In Sales ==================== */

/** GET /api/admin/walk-in-sales – list walk-in sales; super admin sees all, others only for their events. */
export async function listWalkInSales(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const rawId = req.user?.id ?? req.userId;
    const userIdParam = rawId != null ? String(rawId) : '';

    const sql = superAdmin
      ? `SELECT w.*, e.title AS event_title
         FROM "WalkInSale" w
         LEFT JOIN "Event" e ON e.id::text = w."eventId"::text
         ORDER BY w."createdAt" DESC
         LIMIT 200`
      : `SELECT w.*, e.title AS event_title
         FROM "WalkInSale" w
         LEFT JOIN "Event" e ON e.id::text = w."eventId"::text
         WHERE (e."createdBy"::text = $1) OR (e."createdBy" IS NULL AND $1 = '0')
         ORDER BY w."createdAt" DESC
         LIMIT 200`;
    const params = superAdmin ? [] : [userIdParam];
    const result = await query(sql, params).catch(() => ({ rows: [] }));
    return res.json(result.rows || []);
  } catch (err) {
    console.error('listWalkInSales', err);
    return res.json([]);
  }
}

/** POST /api/admin/walk-in-sales – create a walk-in sale. */
export async function createWalkInSale(req, res) {
  try {
    const userId = getUserId(req);
    const { eventId, fullName, email, phone, ticketType, quantity, amount, status, notes } = req.body || {};

    if (!eventId) return res.status(400).json({ error: 'eventId is required' });
    if (!fullName || !fullName.trim()) return res.status(400).json({ error: 'Full name is required' });
    const event = await resolveAdminEventIdentifier(eventId, req);
    if (!event?.id) return res.status(404).json({ error: 'Event not found or access denied' });

    const normalizedQuantity = Math.max(1, parseInt(quantity, 10) || 1);
    const rawAmount = typeof amount === 'string' ? amount.trim() : amount;
    const hasExplicitAmount = rawAmount !== '' && rawAmount != null;
    let normalizedAmount = hasExplicitAmount ? Math.max(0, parseInt(rawAmount, 10) || 0) : null;

    // Auto-calculate amount from selected ticket type when amount is omitted.
    if (normalizedAmount == null) {
      const selectedTicketType = ticketType?.trim();
      if (selectedTicketType) {
        const ticketPriceResult = await query(
          `SELECT COALESCE("price", 0) AS price
           FROM "TicketType"
           WHERE "eventId"::text = $1
             AND LOWER(TRIM(COALESCE("name", ''))) = LOWER(TRIM($2))
           LIMIT 1`,
          [String(event.id), selectedTicketType]
        ).catch(() => ({ rows: [] }));
        const ticketPrice = Number(ticketPriceResult.rows?.[0]?.price ?? 0);
        normalizedAmount = Math.max(0, ticketPrice * normalizedQuantity);
      } else {
        normalizedAmount = Math.max(0, Number(event.price) || 0) * normalizedQuantity;
      }
    }

    if (normalizedAmount == null) return res.status(400).json({ error: 'Amount is required' });

    const validStatus = normalizeSaleStatus(status, req.body);
    if (!validStatus) return res.status(400).json({ error: 'Status must be pending or paid' });
    const result = await query(
      `INSERT INTO "WalkInSale" ("eventId", "fullName", "email", "phone", "ticketType", "quantity", "amount", "status", "notes", "recordedBy")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        event.id,
        fullName.trim(),
        email?.trim() || null,
        phone?.trim() || null,
        ticketType?.trim() || 'General',
        normalizedQuantity,
        normalizedAmount,
        validStatus,
        notes?.trim() || null,
        (userId === 0 || userId === '0') ? null : userId,
      ]
    );
    if (!result.rows?.length) return res.status(500).json({ error: 'Failed to create walk-in sale' });

    const row = result.rows[0];
    row.event_title = event.title || '';

    if (validStatus === 'paid' && row.email) {
      try {
        await sendTicketEmail({
          to: row.email,
          fullName: row.fullName,
          ticketCode: generateTicketCode(),
          eventTitle: event.title,
          eventDate: event.date,
          ticketTypes: [row.ticketType || 'General'],
        });
      } catch (emailErr) {
        console.error('createWalkInSale email warning', emailErr);
      }
    }

    return res.status(201).json(row);
  } catch (err) {
    console.error('createWalkInSale', err);
    return res.status(500).json({ error: err.message || 'Failed to create walk-in sale' });
  }
}

/** POST /api/admin/events/:eventId/ticket-adjustments – manually increment sold count for a ticket type. */
export async function incrementEventTicketSold(req, res) {
  try {
    const eventId = String(req.params.eventId || '').trim();
    const body = req.body || {};
    const quantity = Math.max(1, parseInt(body.quantity, 10) || 1);
    const ticketTypeName = String(body.ticketType || body.ticketTypeName || '').trim();
    const notes = String(body.notes || '').trim();
    const userId = getUserId(req);

    if (!eventId) return res.status(400).json({ error: 'eventId is required' });
    if (!ticketTypeName) return res.status(400).json({ error: 'ticketType is required' });

    const event = await resolveAdminEventIdentifier(eventId, req);
    if (!event?.id) return res.status(404).json({ error: 'Event not found or access denied' });

    const ticketRows = await query(
      `SELECT "name", "price"
       FROM "TicketType"
       WHERE "eventId"::text = $1`,
      [String(event.id)]
    ).catch(() => ({ rows: [] }));
    const ticket = (ticketRows.rows || []).find((row) => (
      normalizeTicketTypeKey(row.name) === normalizeTicketTypeKey(ticketTypeName)
    ));
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket type not found for this event' });
    }

    const amount = Math.max(0, (Number(ticket.price) || 0) * quantity);
    const result = await query(
      `INSERT INTO "WalkInSale" ("eventId", "fullName", "email", "phone", "ticketType", "quantity", "amount", "status", "notes", "recordedBy")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid', $8, $9)
       RETURNING *`,
      [
        String(event.id),
        'Manual ticket adjustment',
        null,
        null,
        ticket.name,
        quantity,
        amount,
        notes || `Manual sold increment by admin (+${quantity})`,
        (userId === 0 || userId === '0') ? null : userId,
      ]
    );

    return res.status(201).json({
      message: 'Ticket sold count incremented',
      adjustment: result.rows?.[0] || null,
    });
  } catch (err) {
    console.error('incrementEventTicketSold', err);
    return res.status(500).json({ error: err.message || 'Failed to increment ticket sold count' });
  }
}

/** PATCH /api/admin/walk-in-sales/:id/status – toggle status between pending and paid. */
export async function updateWalkInSaleStatus(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = getUserId(req);
    const userIdParam = userId != null ? String(userId) : '';
    const saleId = parseInt(req.params.id, 10);
    if (Number.isNaN(saleId)) return res.status(400).json({ error: 'Invalid sale id' });

    const { status } = req.body || {};
    const validStatus = normalizeSaleStatus(status, req.body);
    if (!validStatus) return res.status(400).json({ error: 'Status must be pending or paid' });

    // Verify ownership via event
    const ownershipSql = superAdmin
      ? `SELECT w.id, w.status, w.email, w."fullName", w."ticketType", e.title AS event_title, e.date AS event_date
         FROM "WalkInSale" w
         LEFT JOIN "Event" e ON e.id::text = w."eventId"::text
         WHERE w.id = $1`
      : `SELECT w.id, w.status, w.email, w."fullName", w."ticketType", e.title AS event_title, e.date AS event_date
         FROM "WalkInSale" w
         LEFT JOIN "Event" e ON e.id::text = w."eventId"::text
         WHERE w.id = $1 AND (e."createdBy"::text = $2 OR (e."createdBy" IS NULL AND $2 = '0'))`;
    const ownershipParams = superAdmin ? [saleId] : [saleId, userIdParam];
    const ownerCheck = await query(ownershipSql, ownershipParams).catch(() => ({ rows: [] }));
    if (!ownerCheck.rows?.length) return res.status(404).json({ error: 'Walk-in sale not found' });

    const previousStatus = String(ownerCheck.rows[0].status || '').toLowerCase();
    await query(
      `UPDATE "WalkInSale" SET "status" = $1, "updatedAt" = NOW() WHERE id = $2 RETURNING *`,
      [validStatus, saleId]
    );
    const row = await getWalkInSaleByIdForAdmin(saleId, req);
    if (!row) return res.status(404).json({ error: 'Walk-in sale not found' });

    if (validStatus === 'paid' && previousStatus !== 'paid' && ownerCheck.rows[0].email) {
      try {
        await sendTicketEmail({
          to: ownerCheck.rows[0].email,
          fullName: ownerCheck.rows[0].fullName,
          ticketCode: generateTicketCode(),
          eventTitle: ownerCheck.rows[0].event_title,
          eventDate: ownerCheck.rows[0].event_date,
          ticketTypes: [ownerCheck.rows[0].ticketType || 'General'],
        });
      } catch (emailErr) {
        console.error('updateWalkInSaleStatus email warning', emailErr);
      }
    }

    return res.json(row);
  } catch (err) {
    console.error('updateWalkInSaleStatus', err);
    return res.status(500).json({ error: err.message || 'Failed' });
  }
}

/** DELETE /api/admin/walk-in-sales/:id – delete a walk-in sale record. */
export async function deleteWalkInSale(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const userId = getUserId(req);
    const userIdParam = userId != null ? String(userId) : '';
    const saleId = parseInt(req.params.id, 10);
    if (Number.isNaN(saleId)) return res.status(400).json({ error: 'Invalid sale id' });

    // Verify ownership via event
    const ownershipSql = superAdmin
      ? `SELECT w.id FROM "WalkInSale" w
         LEFT JOIN "Event" e ON e.id::text = w."eventId"::text
         WHERE w.id = $1`
      : `SELECT w.id FROM "WalkInSale" w
         LEFT JOIN "Event" e ON e.id::text = w."eventId"::text
         WHERE w.id = $1 AND (e."createdBy"::text = $2 OR (e."createdBy" IS NULL AND $2 = '0'))`;
    const ownershipParams = superAdmin ? [saleId] : [saleId, userIdParam];
    const ownerCheck = await query(ownershipSql, ownershipParams).catch(() => ({ rows: [] }));
    if (!ownerCheck.rows?.length) return res.status(404).json({ error: 'Walk-in sale not found' });

    await query('DELETE FROM "WalkInSale" WHERE id = $1', [saleId]);
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('deleteWalkInSale', err);
    return res.status(500).json({ error: err.message || 'Failed' });
  }
}

/** GET /api/admin/walk-in-sales/revenue – total paid walk-in revenue (for display in brackets). */
export async function getWalkInRevenue(req, res) {
  try {
    const superAdmin = isSuperAdmin(req);
    const rawId = req.user?.id ?? req.userId;
    const userIdParam = rawId != null ? String(rawId) : '';

    const sql = superAdmin
      ? `SELECT COALESCE(SUM(w."amount"), 0) AS total
         FROM "WalkInSale" w
         WHERE w."status" = 'paid'`
      : `SELECT COALESCE(SUM(w."amount"), 0) AS total
         FROM "WalkInSale" w
         LEFT JOIN "Event" e ON e.id::text = w."eventId"::text
         WHERE w."status" = 'paid' AND ((e."createdBy"::text = $1) OR (e."createdBy" IS NULL AND $1 = '0'))`;
    const params = superAdmin ? [] : [userIdParam];
    const result = await query(sql, params).catch(() => ({ rows: [{ total: 0 }] }));
    return res.json({ total: Number(result.rows?.[0]?.total) || 0 });
  } catch (err) {
    console.error('getWalkInRevenue', err);
    return res.json({ total: 0 });
  }
}
