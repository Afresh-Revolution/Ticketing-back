import { query } from '../../shared/config/db.js';
import { randomUUID } from 'crypto';
import {
  isCloudinaryConfigured,
  uploadImageBufferToCloudinary,
} from '../../shared/services/cloudinary.service.js';

/** GET /api/events - list events (?trending=true&take=3) */
export async function listEvents(req, res) {
  try {
    const trending = req.query.trending === 'true';
    const take = Math.min(parseInt(req.query.take, 10) || 50, 100);
    const result = await query(
      `SELECT "id", "title", "date", "location", "price", "imageUrl", "startTime"
       FROM "Event"
       WHERE "isPublished" = TRUE ${trending ? 'AND "isTrending" = TRUE' : ''}
       ORDER BY "date" ASC
       LIMIT $1`,
      [take]
    ).catch(() => ({ rows: [] }));
    const list = (result.rows || []).map((row) => ({
      id: String(row.id),
      title: row.title,
      date: row.date,
      location: row.location,
      price: row.price,
      imageUrl: row.imageUrl,
      startTime: row.startTime,
    }));
    return res.json(list);
  } catch {
    return res.json([]);
  }
}

/** GET /api/events/:id */
export async function getEvent(req, res) {
  try {
    const result = await query(
      'SELECT * FROM "Event" WHERE "id" = $1',
      [req.params.id]
    ).catch(() => ({ rows: [] }));
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const row = result.rows[0];
    const eventId = String(row.id);

    // Include ticket pools so frontend can render selectable ticket types.
    const ticketTypeRows = await query(
      'SELECT * FROM "TicketType" WHERE "eventId"::text = $1',
      [eventId]
    ).then((r) => r.rows || []).catch((e) => {
      // Keep event details available even if TicketType table is not configured yet.
      if (e?.code === '42P01') return [];
      throw e;
    });

    const ticketTypeIds = ticketTypeRows.map((t) => String(t.id)).filter(Boolean);
    let soldByTicketTypeId = {};
    if (ticketTypeIds.length > 0) {
      const soldRows = await query(
        `SELECT oi."ticketTypeId", COALESCE(SUM(oi.quantity), 0)::int AS sold
         FROM "OrderItem" oi
         INNER JOIN "Order" o ON o.id::text = oi."orderId"::text AND o.status = 'paid'
         WHERE oi."ticketTypeId"::text = ANY($1)
         GROUP BY oi."ticketTypeId"`,
        [ticketTypeIds]
      ).then((r) => r.rows || []).catch((e) => {
        if (e?.code === '42P01') return [];
        throw e;
      });

      soldByTicketTypeId = soldRows.reduce((acc, soldRow) => {
        acc[String(soldRow.ticketTypeId)] = Number(soldRow.sold) || 0;
        return acc;
      }, {});
    }

    const tickets = ticketTypeRows.map((t) => {
      const id = String(t.id);
      const price = Number(t.price) || 0;
      return {
        id,
        name: t.name || 'Ticket',
        description: t.description || '',
        price,
        quantity: Number(t.quantity) || 0,
        type: t.type === 'free' ? 'free' : (price === 0 ? 'free' : 'paid'),
        sold: soldByTicketTypeId[id] || 0,
      };
    });

    return res.json({
      id: eventId,
      title: row.title,
      date: row.date,
      location: row.location,
      price: row.price,
      imageUrl: row.imageUrl,
      startTime: row.startTime,
      description: row.description,
      organizer: row.organizer,
      tickets,
      ticketTypes: tickets,
    });
  } catch (err) {
    console.error('getEvent', err);
    return res.status(500).json({ error: 'Not found' });
  }
}

/** POST /api/events/upload-image – upload event image to Cloudinary */
export async function uploadImage(req, res) {
  try {
    if (!isCloudinaryConfigured()) {
      return res.status(500).json({ error: 'Cloudinary is not configured on the server' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }
    if (!req.file.mimetype || !req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'Only image files are allowed' });
    }
    const result = await uploadImageBufferToCloudinary(req.file.buffer);
    return res.status(201).json({
      imageUrl: result.secure_url,
      publicId: result.public_id,
    });
  } catch (err) {
    console.error('uploadImage', err);
    return res.status(500).json({ error: err.message || 'Image upload failed' });
  }
}

/** Resolve createdBy: null only for superadmin (id 0). Every other request must have a numeric userId from the token so the event is attributed to that admin. */
function getCreatedBy(req) {
  const raw = req.user?.id ?? req.userId;
  if (raw == null || raw === '') return null;
  const id = Number(raw);
  if (Number.isNaN(id)) return null;
  if (id === 0) return null; // superadmin synthetic id
  return id;
}

/** POST /api/events - create event (admin). Event is tied to creating admin (createdBy); super admin uses null/0. */
export async function createEvent(req, res) {
  try {
    const body = req.body || {};
    const createdBy = getCreatedBy(req);
    const isSuperAdmin = req.userRole === 'superadmin' || req.user?.id === 0 || req.user?.id === '0';

    if (!isSuperAdmin && createdBy == null) {
      return res.status(401).json({ error: 'Unauthorized: could not determine admin account for this event' });
    }

    const clientCreatedBy = body.createdBy != null && body.createdBy !== '' ? Number(body.createdBy) : null;
    if (clientCreatedBy != null && !Number.isNaN(clientCreatedBy) && clientCreatedBy !== 0) {
      if (createdBy !== null && Number(createdBy) !== clientCreatedBy) {
        return res.status(400).json({
          error: 'Account mismatch. Please log out and sign in with the admin account you want to create the event for.',
          code: 'ACCOUNT_MISMATCH',
        });
      }
    }

    const finalCreatedBy = isSuperAdmin ? null : createdBy;
    if (!isSuperAdmin && (finalCreatedBy == null || Number(finalCreatedBy) === 0)) {
      return res.status(400).json({
        error: 'Could not attribute event to your account. Log out and sign in again with your admin email and password, then try creating the event again.',
        code: 'CREATED_BY_UNKNOWN',
      });
    }

    const result = await query(
      `INSERT INTO "Event" ("title", "date", "location", "price", "imageUrl", "startTime", "description", "createdBy", "isPublished", "isTrending")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING "id", "title", "date", "createdBy"`,
      [
        body.title,
        body.date,
        body.location,
        body.price ?? 0,
        body.imageUrl,
        body.startTime,
        body.description,
        finalCreatedBy,
        body.isPublished ?? true,
        body.isTrending ?? false,
      ]
    ).catch((e) => {
      if (e.code === '42P01') return null;
      throw e;
    });
    if (!result || result.rows.length === 0) {
      return res.status(501).json({ error: 'Events table not configured' });
    }
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('createEvent', err);
    return res.status(500).json({ error: err.message || 'Failed to create event' });
  }
}

/** PATCH /api/events/:id – owner can edit; super admin can edit any event. */
export async function updateEvent(req, res) {
  try {
    const isSuperAdmin = req.userRole === 'superadmin';
    const userId = req.userId;
    const body = req.body || {};
    const eventId = req.params.id;

    const eventRows = await query('SELECT "id", "createdBy" FROM "Event" WHERE "id" = $1', [eventId]).catch(() => ({ rows: [] }));
    if (!eventRows.rows?.length) return res.status(404).json({ error: 'Event not found' });
    const event = eventRows.rows[0];
    const createdBy = event.createdBy;

    const ownsEvent = createdBy != null && String(createdBy) === String(userId);
    const superAdminOwnsNullEvent = isSuperAdmin && (createdBy == null || String(createdBy) === '0');
    if (!isSuperAdmin && !ownsEvent) {
      return res.status(403).json({ error: 'You can only edit events you created' });
    }
    if (isSuperAdmin && !ownsEvent && !superAdminOwnsNullEvent) {
      return res.status(403).json({ error: 'Super admin can only edit their own events, not another admin\'s' });
    }

    const result = await query(
      `UPDATE "Event" SET "title" = COALESCE($1, "title"), "date" = COALESCE($2, "date"), "location" = COALESCE($3, "location"),
       "price" = COALESCE($4, "price"), "imageUrl" = COALESCE($5, "imageUrl"), "startTime" = COALESCE($6, "startTime"),
       "description" = COALESCE($7, "description"), "venue" = COALESCE($8, "venue"), "category" = COALESCE($9, "category"),
       "updatedAt" = NOW()
       WHERE "id" = $10 RETURNING "id"`,
      [body.title, body.date, body.location, body.price, body.imageUrl, body.startTime, body.description, body.venue, body.category, eventId]
    ).catch(() => ({ rows: [] }));
    if (!result.rows || result.rows.length === 0) return res.status(404).json({ error: 'Event not found' });

    if (Array.isArray(body.ticketTypes)) {
      const currentRows = await query(
        'SELECT "id" FROM "TicketType" WHERE "eventId"::text = $1',
        [String(eventId)]
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
            [name, description, price, quantity, type, parsedId, String(eventId)]
          );
        } else {
          await query(
            `INSERT INTO "TicketType" ("id", "eventId", "name", "description", "price", "quantity", "type", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
            [randomUUID(), String(eventId), name, description, price, quantity, type]
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
          [existingId, String(eventId)]
        );
      }
    }

    return res.json({ message: 'Updated' });
    
  } catch (err) {
    console.error('updateEvent', err);
    return res.status(500).json({ error: err.message || 'Failed to update' });
  }
}

/** PATCH /api/events/:id/trending – Super admin can set any event (any owner). Other admins only their own. Body: { isTrending: boolean }. */
export async function setTrending(req, res) {
  try {
    const eventId = req.params.id;
    const isTrending = req.body && typeof req.body.isTrending === 'boolean' ? req.body.isTrending : true;
    const role = (req.userRole || req.user?.role || '').toLowerCase();
    const isSuperAdmin = role === 'superadmin' || req.userId === 0 || req.user?.id === 0 || String(req.userId) === '0' || String(req.user?.id) === '0';
    const userId = req.userId != null ? Number(req.userId) : null;

    if (!eventId) return res.status(400).json({ error: 'Event id required' });

    if (isSuperAdmin) {
      const result = await query(
        'UPDATE "Event" SET "isTrending" = $1, "updatedAt" = NOW() WHERE "id"::text = $2 RETURNING "id"',
        [isTrending, String(eventId)]
      ).catch((e) => {
        console.error('setTrending', e?.message || e);
        return { rows: [] };
      });
      if (!result.rows?.length) return res.status(404).json({ error: 'Event not found' });
      return res.json({ message: 'Updated', isTrending });
    }

    const result = await query(
      'UPDATE "Event" SET "isTrending" = $1, "updatedAt" = NOW() WHERE "id"::text = $2 AND "createdBy" = $3 RETURNING "id"',
      [isTrending, String(eventId), userId]
    ).catch((e) => {
      console.error('setTrending', e?.message || e);
      return { rows: [] };
    });
    if (!result.rows?.length) return res.status(404).json({ error: 'Event not found or you can only set trending for events you created' });
    return res.json({ message: 'Updated', isTrending });
  } catch (err) {
    console.error('setTrending', err);
    return res.status(500).json({ error: 'Failed to update trending status' });
  }
}

/** DELETE /api/events/:id - only owner or superadmin can delete */
export async function deleteEvent(req, res) {
  try {
    const isSuperAdmin = req.userRole === 'superadmin';
    const userId = req.userId;
    const result = await query(
      isSuperAdmin
        ? 'DELETE FROM "Event" WHERE "id" = $1 RETURNING "id"'
        : 'DELETE FROM "Event" WHERE "id" = $1 AND "createdBy" = $2 RETURNING "id"',
      isSuperAdmin ? [req.params.id] : [req.params.id, userId]
    ).catch(() => ({ rows: [] }));
    if (!result.rows?.length) return res.status(404).json({ error: 'Event not found' });
    return res.json({ message: 'Deleted' });
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
}
