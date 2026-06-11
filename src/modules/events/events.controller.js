import { query } from '../../shared/config/db.js';
import {
  isCloudinaryConfigured,
  uploadImageBufferToCloudinary,
} from '../../shared/services/cloudinary.service.js';
import { eventModel } from '../event/event.model.js';

/** GET /api/events - list events (?trending=true&take=3) */
export async function listEvents(req, res) {
  try {
    const trending = req.query.trending === 'true';
    const take = Math.min(parseInt(req.query.take, 10) || 50, 100);
    const result = await query(
      `SELECT "id", "title", "date", "location", "price", "imageUrl", "startTime", "category"
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
      category: row.category,
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
    const event = await eventModel.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    return res.json({
      ...event,
      id: String(event.id),
      tickets: event.tickets || [],
      ticketTypes: event.tickets || [],
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

    const created = await eventModel.create({
      title: body.title,
      description: body.description,
      date: body.date,
      endDate: body.endDate ?? null,
      venue: body.venue,
      imageUrl: body.imageUrl,
      imageUrls: body.imageUrls,
      category: body.category,
      startTime: body.startTime,
      endTime: body.endTime ?? null,
      price: Number(body.price) || 0,
      currency: body.currency || 'NGN',
      isTrending: body.isTrending ?? false,
      location: body.location,
      eventType: body.eventType || 'in-person',
      streamUrl: body.streamUrl,
      streamProvider: body.streamProvider,
      ticketTypes: body.ticketTypes,
      createdBy: finalCreatedBy,
      isPublished: body.isPublished !== false,
    });

    const full = await eventModel.findById(created.id);
    const payload = full || created;
    return res.status(201).json({
      ...payload,
      id: String(payload.id),
      ticketTypes: payload.tickets || [],
    });
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

    const updated = await eventModel.update(eventId, {
      title: body.title,
      description: body.description,
      date: body.date,
      endDate: body.endDate,
      endTime: body.endTime,
      venue: body.venue,
      imageUrl: body.imageUrl,
      imageUrls: body.imageUrls,
      category: body.category,
      startTime: body.startTime,
      price: body.price != null ? Number(body.price) : undefined,
      location: body.location,
      eventType: body.eventType,
      streamUrl: body.streamUrl,
      streamProvider: body.streamProvider,
      isTrending: body.isTrending,
      ticketTypes: body.ticketTypes,
    });
    if (!updated) return res.status(404).json({ error: 'Event not found' });

    return res.json({
      ...updated,
      id: String(updated.id),
      ticketTypes: updated.tickets || [],
    });
    
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
