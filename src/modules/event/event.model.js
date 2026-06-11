import { query, createId } from '../../shared/config/db.js';
import { fetchMerchByEventId } from '../merch/merch.model.js';

function rowToEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    date: row.date,
    endDate: row.endDate ?? null,
    venue: row.venue,
    imageUrl: row.imageUrl,
    category: row.category,
    startTime: row.startTime,
    endTime: row.endTime ?? null,
    price: row.price,
    currency: row.currency,
    isTrending: row.isTrending,
    location: row.location,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function resolveTicketType(ticket) {
  const explicit = String(ticket?.type || '').toLowerCase().trim();
  if (explicit === 'reservation' || explicit === 'free' || explicit === 'paid') return explicit;
  const price = Number(ticket?.price) || 0;
  return price === 0 ? 'free' : 'paid';
}

function mapTicketRow(t) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    price: t.price,
    quantity: t.quantity,
    type: resolveTicketType(t),
    contactEmail: t.contactEmail ?? null,
    contactPhone: t.contactPhone ?? null,
  };
}

function normalizeTicketTypeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

async function resolveOrganizerName(createdBy) {
  if (createdBy == null) return 'Super Admin';
  const { rows } = await query(
    'SELECT name FROM "User" WHERE id::text = $1',
    [String(createdBy)]
  ).catch(() => ({ rows: [] }));
  const name = rows[0]?.name;
  return (name && String(name).trim()) || null;
}

async function resolveOwnerEmail(createdBy) {
  if (createdBy == null || createdBy === '' || String(createdBy) === '0') return null;
  const { rows } = await query(
    'SELECT email FROM "User" WHERE id::text = $1',
    [String(createdBy)]
  ).catch(() => ({ rows: [] }));
  const email = String(rows[0]?.email || '').trim();
  return email.includes('@') ? email : null;
}

export const eventModel = {
  /** Email the admin used at signup (Event.createdBy → User.email). */
  async getOwnerEmail(eventId) {
    if (!eventId) return null;
    const { rows } = await query(
      'SELECT "createdBy" FROM "Event" WHERE id::text = $1 LIMIT 1',
      [String(eventId)]
    ).catch(() => ({ rows: [] }));
    return resolveOwnerEmail(rows[0]?.createdBy);
  },
  async findMany(opts = {}) {
    const limit = opts.take != null ? Math.max(0, opts.take) : null;
    let sql = 'SELECT * FROM "Event"';
    const params = [];
    const where = [];
    if (opts.trending) where.push('"isTrending" = true');
    if (opts.published !== false) where.push('("isPublished" = true OR "isPublished" IS NULL)');
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
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
        byEventId[t.eventId].push(mapTicketRow(t));
      }
      events.forEach((e) => { e.tickets = byEventId[e.id] || []; });
    }
    return events;
  },
  async findById(id) {
    const { rows } = await query('SELECT * FROM "Event" WHERE id = $1', [id]);
    const event = rowToEvent(rows[0]);
    if (!event) return null;
    
    // Fetch Ticket Types (pools) with sold count from paid orders
    const { rows: ticketTypeRows } = await query('SELECT * FROM "TicketType" WHERE "eventId" = $1', [id]);
    const ticketIds = ticketTypeRows.map(t => t.id);
    let soldByTicketId = {};
    if (ticketIds.length > 0) {
      const { rows: soldRows } = await query(
        `SELECT oi."ticketTypeId", COALESCE(SUM(oi.quantity), 0)::int AS sold
         FROM "OrderItem" oi
         INNER JOIN "Order" o
           ON o.id = oi."orderId"
          AND LOWER(TRIM(COALESCE(o.status, ''))) IN ('paid', 'completed', 'success', 'changed', 'true')
         WHERE oi."ticketTypeId" = ANY($1)
         GROUP BY oi."ticketTypeId"`,
        [ticketIds]
      );
      soldByTicketId = soldRows.reduce((acc, r) => { acc[r.ticketTypeId] = Number(r.sold) || 0; return acc; }, {});
    }
    const walkInSoldResult = await query(
      `SELECT LOWER(REGEXP_REPLACE(TRIM(COALESCE("ticketType", 'General')), '[^a-z0-9]+', '', 'g')) AS ticket_name_key,
              COALESCE(SUM(quantity), 0)::int AS sold
       FROM "WalkInSale"
       WHERE "eventId"::text = $1
         AND LOWER(TRIM(COALESCE("status", ''))) IN ('paid', 'completed', 'success', 'changed', 'true')
       GROUP BY LOWER(REGEXP_REPLACE(TRIM(COALESCE("ticketType", 'General')), '[^a-z0-9]+', '', 'g'))` ,
      [String(id)]
    ).catch((e) => {
      if (e?.code === '42P01') return { rows: [] };
      throw e;
    });
    const walkInSoldByName = (walkInSoldResult.rows || []).reduce((acc, row) => {
      const key = normalizeTicketTypeKey(row.ticket_name_key);
      if (!key) return acc;
      acc[key] = Number(row.sold) || 0;
      return acc;
    }, {});
    event.tickets = ticketTypeRows.map(t => ({
      ...mapTicketRow(t),
      type: resolveTicketType(t),
      sold: (soldByTicketId[t.id] || 0) + (walkInSoldByName[normalizeTicketTypeKey(t.name)] || 0),
    }));

    const createdByName = await resolveOrganizerName(event.createdBy);
    if (createdByName) {
      event.createdByName = createdByName;
      event.organizer = createdByName;
    }

    event.merch = await fetchMerchByEventId(id).catch(() => []);

    return event;
  },
  async create(data) {
    const id = createId();
    const now = new Date().toISOString();
    
    // 1. Create Event
    await query(
      `INSERT INTO "Event" (id, title, description, date, "endDate", venue, "imageUrl", category, "startTime", "endTime", price, currency, "isTrending", location, "createdBy", "isPublished", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        id,
        data.title,
        data.description ?? null,
        data.date,
        data.endDate ?? null,
        data.venue ?? null,
        data.imageUrl ?? null,
        data.category ?? null,
        data.startTime ?? null,
        data.endTime ?? null,
        data.price ?? null,
        data.currency ?? null,
        data.isTrending ?? false,
        data.location ?? null,
        data.createdBy ?? null,
        data.isPublished !== false,
        now,
        now,
      ]
    );

    // 2. Create Ticket Types (if any)
    if (data.ticketTypes && Array.isArray(data.ticketTypes)) {
      for (const ticket of data.ticketTypes) {
        const ticketId = createId();
        const type = resolveTicketType(ticket);
        const price = type === 'paid' ? (Number(ticket.price) || 0) : 0;
        const contactEmail = type === 'reservation' ? (ticket.contactEmail?.trim() || null) : null;
        const contactPhone = type === 'reservation' ? (ticket.contactPhone?.trim() || null) : null;
        await query(
          `INSERT INTO "TicketType" (id, "eventId", name, description, price, quantity, type, "contactEmail", "contactPhone", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            ticketId,
            id,
            ticket.name,
            ticket.description ?? null,
            price,
            ticket.quantity ?? 0,
            type,
            contactEmail,
            contactPhone,
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
      endDate: 'endDate',
      endTime: 'endTime',
      price: 'price',
      currency: 'currency',
      isTrending: 'isTrending',
      location: 'location',
      isPublished: 'isPublished',
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
      const currentRows = await query(
        'SELECT "id" FROM "TicketType" WHERE "eventId"::text = $1',
        [String(id)]
      );
      const existingIds = new Set((currentRows.rows || []).map((r) => String(r.id)));
      const incomingIds = new Set();

      for (const ticket of data.ticketTypes) {
        const parsedId = typeof ticket?.id === 'string' ? ticket.id.trim() : '';
        const hasExistingId = parsedId.length > 0 && existingIds.has(parsedId);
        if (hasExistingId) incomingIds.add(parsedId);

        const type = resolveTicketType(ticket);
        const price = type === 'paid' ? (Number(ticket?.price) || 0) : 0;
        const quantity = Number(ticket?.quantity) || 0;
        const name = ticket?.name || 'Ticket';
        const description = ticket?.description ?? null;
        const contactEmail = type === 'reservation' ? (String(ticket?.contactEmail || '').trim() || null) : null;
        const contactPhone = type === 'reservation' ? (String(ticket?.contactPhone || '').trim() || null) : null;

        if (hasExistingId) {
          await query(
            `UPDATE "TicketType"
             SET "name" = $1,
                 "description" = $2,
                 "price" = $3,
                 "quantity" = $4,
                 "type" = $5,
                 "contactEmail" = $6,
                 "contactPhone" = $7,
                 "updatedAt" = NOW()
             WHERE "id"::text = $8 AND "eventId"::text = $9`,
            [name, description, price, quantity, type, contactEmail, contactPhone, parsedId, String(id)]
          );
        } else {
          await query(
            `INSERT INTO "TicketType" (id, "eventId", name, description, price, quantity, type, "contactEmail", "contactPhone", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
            [createId(), id, name, description, price, quantity, type, contactEmail, contactPhone]
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
          [existingId, String(id)]
        );
      }
    }
    return eventModel.findById(id);
  },
  async delete(id) {
    const { rows } = await query('SELECT * FROM "Event" WHERE id = $1', [id]);
    const deleted = rowToEvent(rows[0]);
    if (!deleted) return null;

    // Cascade delete: remove dependent rows so FK constraints don't block event delete
    // Order: ScanLog -> OrderItem -> Order, Withdrawal, TicketType -> Event
    await query('DELETE FROM "ScanLog" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "eventId" = $1)', [id]);
    await query('DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "eventId" = $1)', [id]);
    await query('DELETE FROM "Order" WHERE "eventId" = $1', [id]);
    await query('DELETE FROM "Withdrawal" WHERE "eventId" = $1', [id]);
    await query('DELETE FROM "TicketType" WHERE "eventId" = $1', [id]);
    await query('DELETE FROM "Event" WHERE id = $1', [id]);
    return deleted;
  },
};
