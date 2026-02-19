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
    isTrending: row.isTrending,
    location: row.location,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const eventModel = {
  async findMany(opts = {}) {
    const limit = opts.take != null ? Math.max(0, opts.take) : null;
    let sql = 'SELECT * FROM "Event"';
    const params = [];
    
    // Handle trending filter
    if (opts.trending) {
      sql += ' WHERE "isTrending" = true';
    }
    
    sql += ' ORDER BY date ASC';
    
    if (limit != null) {
      if (params.length === 0) {
        sql += ' LIMIT $1';
        params.push(limit);
      } else {
        // If we already have params (e.g. for WHERE clause which we don't have yet but good practice)
        // For now trending is boolean, so no param needed for that specific check
        // but if we had WHERE category = $1, then LIMIT would be $2
        sql += ' LIMIT $' + (params.length + 1);
        params.push(limit);
      }
    }

    const { rows } = await query(sql, params);
    const events = rows.map(rowToEvent);
    if (events.length && opts.include?.tickets) {
      const eventIds = events.map((e) => e.id);
      const { rows: ticketRows } = await query(
        'SELECT * FROM "TicketType" WHERE "eventId" = ANY($1)',
        [eventIds]
      );
      const byEventId = {};
      for (const t of ticketRows) {
        if (!byEventId[t.eventId]) byEventId[t.eventId] = [];
        byEventId[t.eventId].push({
          id: t.id,
          name: t.name,
          description: t.description,
          price: t.price,
          quantity: t.quantity,
        });
      }
      events.forEach((e) => { e.tickets = byEventId[e.id] || []; });
    }
    return events;
  },
  async findById(id) {
    const { rows } = await query('SELECT * FROM "Event" WHERE id = $1', [id]);
    const event = rowToEvent(rows[0]);
    if (!event) return null;
    
    // Fetch Ticket Types (pools) and map them to "tickets" field for frontend compatibility
    const { rows: ticketTypeRows } = await query('SELECT * FROM "TicketType" WHERE "eventId" = $1', [id]);
    event.tickets = ticketTypeRows.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      price: t.price,
      quantity: t.quantity,
      // Frontend expects these fields for now
    }));
    
    return event;
  },
  async create(data) {
    const id = createId();
    const now = new Date().toISOString();
    
    // 1. Create Event
    await query(
      `INSERT INTO "Event" (id, title, description, date, venue, "imageUrl", category, "startTime", price, currency, "isTrending", location, "createdBy", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
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
        data.isTrending ?? false,
        data.location ?? null,
        data.createdBy ?? null,
        now,
        now,
      ]
    );

    // 2. Create Ticket Types (if any)
    if (data.ticketTypes && Array.isArray(data.ticketTypes)) {
      for (const ticket of data.ticketTypes) {
        const ticketId = createId();
        await query(
          `INSERT INTO "TicketType" (id, "eventId", name, description, price, quantity, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            ticketId,
            id,
            ticket.name,
            ticket.description ?? null,
            ticket.price ?? 0,
            ticket.quantity ?? 0,
            now,
            now
          ]
        );
      }
    }

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
      isTrending: 'isTrending',
      location: 'location',
    };
    for (const [key, col] of Object.entries(map)) {
      if (data[key] !== undefined) {
        fields.push(`"${col}" = $${i}`);
        values.push(data[key]);
        i++;
      }
    }
    if (fields.length > 0) {
      values.push(id);
      await query(
        `UPDATE "Event" SET ${fields.join(', ')} WHERE id = $${i}`,
        values
      );
    }
    if (data.ticketTypes && Array.isArray(data.ticketTypes)) {
      await query('DELETE FROM "TicketType" WHERE "eventId" = $1', [id]);
      const now = new Date().toISOString();
      for (const ticket of data.ticketTypes) {
        const ticketId = ticket.id && /^[a-f0-9-]{36}$/i.test(ticket.id) ? ticket.id : createId();
        await query(
          `INSERT INTO "TicketType" (id, "eventId", name, description, price, quantity, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            ticketId,
            id,
            ticket.name ?? 'Ticket',
            ticket.description ?? null,
            ticket.price ?? 0,
            ticket.quantity ?? 0,
            now,
            now,
          ]
        );
      }
    }
    return eventModel.findById(id);
  },
  async delete(id) {
    const { rows } = await query('SELECT * FROM "Event" WHERE id = $1', [id]);
    const deleted = rowToEvent(rows[0]);
    await query('DELETE FROM "Event" WHERE id = $1', [id]);
    return deleted;
  },
};
