import { query, createId } from '../../shared/config/db.js';

function rowToEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    date: row.date,
    venue: row.venue,
    imageUrl: row.imageUrl,
    category: row.category,
    startTime: row.startTime,
    price: row.price,
    currency: row.currency,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const eventModel = {
  async findMany(opts = {}) {
    const limit = opts.take != null ? Math.max(0, opts.take) : null;
    const sql = limit != null
      ? 'SELECT * FROM "Event" ORDER BY date ASC LIMIT $1'
      : 'SELECT * FROM "Event" ORDER BY date ASC';
    const params = limit != null ? [limit] : [];
    const { rows } = await query(sql, params);
    return rows.map(rowToEvent);
  },
  async findById(id, includeTickets = false) {
    const { rows } = await query('SELECT * FROM "Event" WHERE id = $1', [id]);
    const event = rowToEvent(rows[0]);
    if (!event) return null;
    if (includeTickets) {
      const { rows: ticketRows } = await query('SELECT * FROM "Ticket" WHERE "eventId" = $1', [id]);
      event.tickets = ticketRows.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        userId: r.userId,
        email: r.email,
        quantity: r.quantity,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    }
    return event;
  },
  async create(data) {
    const id = createId();
    const now = new Date().toISOString();
    await query(
      `INSERT INTO "Event" (id, title, description, date, venue, "imageUrl", category, "startTime", price, currency, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        data.title,
        data.description ?? null,
        data.date,
        data.venue ?? null,
        data.imageUrl ?? null,
        data.category ?? null,
        data.startTime ?? null,
        data.price ?? null,
        data.currency ?? null,
        now,
        now,
      ]
    );
    const { rows } = await query('SELECT * FROM "Event" WHERE id = $1', [id]);
    return rowToEvent(rows[0]);
  },
  async update(id, data) {
    const fields = [];
    const values = [];
    let i = 1;
    const map = {
      title: 'title',
      description: 'description',
      date: 'date',
      venue: 'venue',
      imageUrl: 'imageUrl',
      category: 'category',
      startTime: 'startTime',
      price: 'price',
      currency: 'currency',
    };
    for (const [key, col] of Object.entries(map)) {
      if (data[key] !== undefined) {
        fields.push(`"${col}" = $${i}`);
        values.push(data[key]);
        i++;
      }
    }
    if (fields.length === 0) return eventModel.findById(id);
    values.push(id);
    await query(
      `UPDATE "Event" SET ${fields.join(', ')} WHERE id = $${i}`,
      values
    );
    const { rows } = await query('SELECT * FROM "Event" WHERE id = $1', [id]);
    return rowToEvent(rows[0]);
  },
  async delete(id) {
    const { rows } = await query('SELECT * FROM "Event" WHERE id = $1', [id]);
    const deleted = rowToEvent(rows[0]);
    await query('DELETE FROM "Event" WHERE id = $1', [id]);
    return deleted;
  },
};
