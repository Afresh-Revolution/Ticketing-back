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

/** POST /api/events - create event (admin) */
export async function createEvent(req, res) {
  try {
    const body = req.body || {};
    const result = await query(
      `INSERT INTO "Event" ("title", "date", "location", "price", "imageUrl", "startTime", "description", "createdBy", "isPublished", "isTrending")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING "id", "title", "date"`,
      [
        body.title,
        body.date,
        body.location,
        body.price ?? 0,
        body.imageUrl,
        body.startTime,
        body.description,
        req.userId,
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

/** PATCH /api/events/:id */
export async function updateEvent(req, res) {
  try {
    const body = req.body || {};
    const result = await query(
      `UPDATE "Event" SET "title" = COALESCE($1, "title"), "date" = COALESCE($2, "date"), "location" = COALESCE($3, "location"),
        "price" = COALESCE($4, "price"), "imageUrl" = COALESCE($5, "imageUrl"), "startTime" = COALESCE($6, "startTime"),
        "description" = COALESCE($7, "description"), "updatedAt" = NOW()
       WHERE "id" = $8 RETURNING "id"`,
      [body.title, body.date, body.location, body.price, body.imageUrl, body.startTime, body.description, req.params.id]
    ).catch(() => ({ rows: [] }));
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    return res.json({ message: 'Updated' });
  } catch (err) {
    console.error('updateEvent', err);
    return res.status(500).json({ error: err.message || 'Failed to update' });
  }
}

/** PATCH /api/events/:id/trending */
export async function setTrending(req, res) {
  try {
    await query(
      'UPDATE "Event" SET "isTrending" = $1, "updatedAt" = NOW() WHERE "id" = $2',
      [req.body?.isTrending ?? true, req.params.id]
    ).catch(() => ({}));
    return res.json({ message: 'Updated' });
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
}

/** DELETE /api/events/:id */
export async function deleteEvent(req, res) {
  try {
    const result = await query('DELETE FROM "Event" WHERE "id" = $1 RETURNING "id"', [req.params.id]).catch(() => ({ rows: [] }));
    if (!result.rows?.length) return res.status(404).json({ error: 'Event not found' });
    return res.json({ message: 'Deleted' });
  } catch {
    return res.status(404).json({ error: 'Not found' });
  }
}
