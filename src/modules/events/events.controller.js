import { query } from '../../shared/config/db.js';

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
    return res.json({
      id: String(row.id),
      title: row.title,
      date: row.date,
      location: row.location,
      price: row.price,
      imageUrl: row.imageUrl,
      startTime: row.startTime,
      description: row.description,
      organizer: row.organizer,
    });
  } catch (err) {
    console.error('getEvent', err);
    return res.status(500).json({ error: 'Not found' });
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

/** POST /api/events - create event (admin). Event is registered to the creating admin's account. */
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
      if (isSuperAdmin) {
        return res.status(400).json({
          error: 'You are logged in as Super Admin. To create events under your own account, log out and sign in with your admin email and password, then create the event again.',
          code: 'USE_ADMIN_ACCOUNT',
        });
      }
      if (createdBy !== null && Number(createdBy) !== clientCreatedBy) {
        return res.status(400).json({
          error: 'Account mismatch. Please log out and sign in with the admin account you want to create the event for.',
          code: 'ACCOUNT_MISMATCH',
        });
      }
    }

    const finalCreatedBy = createdBy;
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

/** PATCH /api/events/:id – owner can edit; superadmin can only edit their own events (createdBy null), not another admin's. */
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

    if (isSuperAdmin) {
      if (createdBy != null && Number(createdBy) !== 0) {
        return res.status(403).json({ error: 'Super admin cannot edit another admin\'s event' });
      }
    } else {
      if (String(createdBy) !== String(userId)) {
        return res.status(403).json({ error: 'You can only edit events you created' });
      }
    }

    const result = await query(
      `UPDATE "Event" SET "title" = COALESCE($1, "title"), "date" = COALESCE($2, "date"), "location" = COALESCE($3, "location"),
       "price" = COALESCE($4, "price"), "imageUrl" = COALESCE($5, "imageUrl"), "startTime" = COALESCE($6, "startTime"),
       "description" = COALESCE($7, "description"), "updatedAt" = NOW()
       WHERE "id" = $8 RETURNING "id"`,
      [body.title, body.date, body.location, body.price, body.imageUrl, body.startTime, body.description, eventId]
    ).catch(() => ({ rows: [] }));
    if (!result.rows || result.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    return res.json({ message: 'Updated' });
  } catch (err) {
    console.error('updateEvent', err);
    return res.status(500).json({ error: err.message || 'Failed to update' });
  }
}

/** PATCH /api/events/:id/trending - only owner or superadmin */
export async function setTrending(req, res) {
  try {
    const isSuperAdmin = req.userRole === 'superadmin';
    const userId = req.userId;
    const result = await query(
      isSuperAdmin
        ? 'UPDATE "Event" SET "isTrending" = $1, "updatedAt" = NOW() WHERE "id" = $2 RETURNING "id"'
        : 'UPDATE "Event" SET "isTrending" = $1, "updatedAt" = NOW() WHERE "id" = $2 AND "createdBy" = $3 RETURNING "id"',
      isSuperAdmin ? [req.body?.isTrending ?? true, req.params.id] : [req.body?.isTrending ?? true, req.params.id, userId]
    ).catch(() => ({ rows: [] }));
    if (!result.rows?.length) return res.status(404).json({ error: 'Not found' });
    return res.json({ message: 'Updated' });
  } catch {
    return res.status(404).json({ error: 'Not found' });
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
