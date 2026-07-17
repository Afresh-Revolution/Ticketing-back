import { query, createId } from '../../shared/config/db.js';

async function fetchMerchByEventId(eventId) {
  try {
    const mod = await import('../merch/merch.model.js');
    if (typeof mod.fetchMerchByEventId === 'function') {
      return mod.fetchMerchByEventId(eventId);
    }
  } catch {
    /* merch module optional */
  }
  return [];
}

const MAX_EVENT_IMAGES = 3;

function parseImageUrls(row) {
  if (!row) return [];
  if (row.imageUrls != null) {
    const raw = typeof row.imageUrls === 'string' ? JSON.parse(row.imageUrls) : row.imageUrls;
    if (Array.isArray(raw)) {
      return raw
        .map((url) => String(url || '').trim())
        .filter(Boolean)
        .slice(0, MAX_EVENT_IMAGES);
    }
  }
  const single = String(row.imageUrl || '').trim();
  return single ? [single] : [];
}

export function normalizeEventImageUrls(imageUrls, imageUrl) {
  let urls = [];
  if (Array.isArray(imageUrls)) {
    urls = imageUrls.map((url) => String(url || '').trim()).filter(Boolean);
  } else if (imageUrl != null && String(imageUrl).trim()) {
    urls = [String(imageUrl).trim()];
  }
  return urls.slice(0, MAX_EVENT_IMAGES);
}

function rowToEvent(row) {
  if (!row) return null;
  const imageUrls = parseImageUrls(row);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    date: row.date,
    endDate: row.endDate ?? null,
    venue: row.venue,
    imageUrl: imageUrls[0] ?? row.imageUrl ?? null,
    imageUrls,
    category: row.category,
    startTime: row.startTime,
    endTime: row.endTime ?? null,
    price: row.price,
    currency: row.currency,
    isTrending: row.isTrending,
    location: row.location,
    eventType: row.eventType || 'in-person',
    streamUrl: row.streamUrl ?? null,
    streamProvider: row.streamProvider || 'youtube',
    isLive: Boolean(row.isLive),
    liveStartedAt: row.liveStartedAt ?? null,
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

function resolveDeliveryMode(ticket, eventType) {
  const explicit = String(ticket?.deliveryMode || '').toLowerCase().trim();
  if (explicit === 'online' || explicit === 'in_person') return explicit;
  const et = String(eventType || 'in-person').toLowerCase();
  if (et === 'online') return 'online';
  return 'in_person';
}

function normalizeDiscountTiers(tiers) {
  if (tiers == null) return [];
  if (!Array.isArray(tiers)) throw new Error('discountTiers must be an array');

  const normalized = tiers
    .map((tier) => ({
      minimumQuantity: Number(tier?.minimumQuantity),
      discountPercent: Number(tier?.discountPercent),
    }))
    .sort((a, b) => a.minimumQuantity - b.minimumQuantity);

  const quantities = new Set();
  let previousPercent = 0;
  for (const tier of normalized) {
    if (!Number.isInteger(tier.minimumQuantity) || tier.minimumQuantity < 2) {
      throw new Error('Discount minimum quantity must be a whole number of at least 2');
    }
    if (!Number.isFinite(tier.discountPercent) || tier.discountPercent <= 0 || tier.discountPercent > 100) {
      throw new Error('Discount percentage must be greater than 0 and no more than 100');
    }
    if (quantities.has(tier.minimumQuantity)) {
      throw new Error(`Duplicate discount minimum quantity: ${tier.minimumQuantity}`);
    }
    if (tier.discountPercent <= previousPercent) {
      throw new Error('Discount percentages must increase with quantity');
    }
    quantities.add(tier.minimumQuantity);
    previousPercent = tier.discountPercent;
  }
  return normalized;
}

async function loadDiscountTiers(ticketTypeIds) {
  if (!ticketTypeIds.length) return {};
  const { rows } = await query(
    `SELECT "ticketTypeId", "minimumQuantity", "discountPercent"
     FROM "TicketDiscountTier"
     WHERE "ticketTypeId" = ANY($1::text[])
     ORDER BY "minimumQuantity" ASC`,
    [ticketTypeIds]
  ).catch((error) => {
    if (error?.code === '42P01') return { rows: [] };
    throw error;
  });
  return rows.reduce((byTicketType, row) => {
    const key = String(row.ticketTypeId);
    if (!byTicketType[key]) byTicketType[key] = [];
    byTicketType[key].push({
      minimumQuantity: Number(row.minimumQuantity),
      discountPercent: Number(row.discountPercent),
    });
    return byTicketType;
  }, {});
}

async function replaceDiscountTiers(ticketTypeId, tiers) {
  const normalized = normalizeDiscountTiers(tiers);
  await query('DELETE FROM "TicketDiscountTier" WHERE "ticketTypeId" = $1', [ticketTypeId]);
  for (const tier of normalized) {
    await query(
      `INSERT INTO "TicketDiscountTier"
         ("id", "ticketTypeId", "minimumQuantity", "discountPercent", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [createId(), ticketTypeId, tier.minimumQuantity, tier.discountPercent]
    );
  }
}

function mapTicketRow(t) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    price: t.price,
    quantity: t.quantity,
    type: resolveTicketType(t),
    deliveryMode: t.deliveryMode || 'in_person',
    contactEmail: t.contactEmail ?? null,
    contactPhone: t.contactPhone ?? null,
    discountTiers: Array.isArray(t.discountTiers) ? t.discountTiers : [],
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
      const discountsByTicketId = await loadDiscountTiers(ticketRows.map((ticket) => ticket.id));
      const byEventId = {};
      for (const t of ticketRows) {
        if (!byEventId[t.eventId]) byEventId[t.eventId] = [];
        byEventId[t.eventId].push(mapTicketRow({
          ...t,
          discountTiers: discountsByTicketId[String(t.id)] || [],
        }));
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
    const discountsByTicketId = await loadDiscountTiers(ticketIds);
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
      ...mapTicketRow({
        ...t,
        discountTiers: discountsByTicketId[String(t.id)] || [],
      }),
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
    const now = new Date().toISOString();
    const imageUrls = normalizeEventImageUrls(data.imageUrls, data.imageUrl);
    const imageUrl = imageUrls[0] ?? null;
    const eventType = data.eventType || 'in-person';
    const price = Number(data.price) || 0;

    const insertResult = await query(
      `INSERT INTO "Event" (title, description, date, "endDate", venue, "imageUrl", "imageUrls", category, "startTime", "endTime", price, currency, "isTrending", location, "eventType", "streamUrl", "streamProvider", "createdBy", "isPublished", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())
       RETURNING id`,
      [
        data.title,
        data.description ?? null,
        data.date,
        data.endDate ?? null,
        data.venue ?? null,
        imageUrl,
        JSON.stringify(imageUrls),
        data.category ?? null,
        data.startTime ?? null,
        data.endTime ?? null,
        price,
        data.currency ?? 'NGN',
        data.isTrending ?? false,
        data.location ?? null,
        eventType,
        data.streamUrl?.trim() || null,
        data.streamProvider || 'youtube',
        data.createdBy ?? null,
        data.isPublished !== false,
      ]
    );
    const id = insertResult.rows[0]?.id;
    if (id == null) throw new Error('Failed to create event');

    if (data.ticketTypes && Array.isArray(data.ticketTypes)) {
      for (const ticket of data.ticketTypes) {
        const type = resolveTicketType(ticket);
        const ticketPrice = type === 'paid' ? (Number(ticket.price) || 0) : 0;
        const contactEmail = type === 'reservation' ? (ticket.contactEmail?.trim() || null) : null;
        const contactPhone = type === 'reservation' ? (ticket.contactPhone?.trim() || null) : null;
        const deliveryMode = resolveDeliveryMode(ticket, eventType);
        const ticketTypeId = createId();
        await query(
          `INSERT INTO "TicketType" (id, "eventId", name, description, price, quantity, type, "deliveryMode", "contactEmail", "contactPhone", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            ticketTypeId,
            id,
            ticket.name,
            ticket.description ?? null,
            ticketPrice,
            Number(ticket.quantity) || 0,
            type,
            deliveryMode,
            contactEmail,
            contactPhone,
            now,
            now,
          ]
        );
        await replaceDiscountTiers(
          ticketTypeId,
          type === 'paid' ? ticket.discountTiers : []
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
    if (data.imageUrls !== undefined || data.imageUrl !== undefined) {
      const imageUrls = normalizeEventImageUrls(data.imageUrls, data.imageUrl);
      data.imageUrls = imageUrls;
      data.imageUrl = imageUrls[0] ?? null;
    }

    const map = {
      title: 'title',
      description: 'description',
      date: 'date',
      venue: 'venue',
      imageUrl: 'imageUrl',
      imageUrls: 'imageUrls',
      category: 'category',
      startTime: 'startTime',
      endDate: 'endDate',
      endTime: 'endTime',
      price: 'price',
      currency: 'currency',
      isTrending: 'isTrending',
      location: 'location',
      eventType: 'eventType',
      streamUrl: 'streamUrl',
      streamProvider: 'streamProvider',
      isPublished: 'isPublished',
    };
    for (const [key, col] of Object.entries(map)) {
      if (data[key] !== undefined) {
        fields.push(`"${col}" = $${i}${key === 'imageUrls' ? '::jsonb' : ''}`);
        values.push(key === 'imageUrls' ? JSON.stringify(data[key]) : data[key]);
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
      const eventTypeRow = await query('SELECT "eventType" FROM "Event" WHERE id::text = $1', [String(id)]);
      const eventType = data.eventType || eventTypeRow.rows[0]?.eventType || 'in-person';

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
        const deliveryMode = resolveDeliveryMode(ticket, eventType);

        if (hasExistingId) {
          await query(
            `UPDATE "TicketType"
             SET "name" = $1,
                 "description" = $2,
                 "price" = $3,
                 "quantity" = $4,
                 "type" = $5,
                 "deliveryMode" = $6,
                 "contactEmail" = $7,
                 "contactPhone" = $8,
                 "updatedAt" = NOW()
             WHERE "id"::text = $9 AND "eventId"::text = $10`,
            [name, description, price, quantity, type, deliveryMode, contactEmail, contactPhone, parsedId, String(id)]
          );
          await replaceDiscountTiers(
            parsedId,
            type === 'paid' ? ticket.discountTiers : []
          );
        } else {
          const ticketTypeId = createId();
          await query(
            `INSERT INTO "TicketType" (id, "eventId", name, description, price, quantity, type, "deliveryMode", "contactEmail", "contactPhone", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
            [ticketTypeId, id, name, description, price, quantity, type, deliveryMode, contactEmail, contactPhone]
          );
          await replaceDiscountTiers(
            ticketTypeId,
            type === 'paid' ? ticket.discountTiers : []
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
        await query(
          `DELETE FROM "TicketDiscountTier" d
           WHERE d."ticketTypeId" = $1
             AND NOT EXISTS (
               SELECT 1 FROM "TicketType" tt
               WHERE tt."id"::text = d."ticketTypeId"
             )`,
          [existingId]
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
    await query('DELETE FROM "StreamAccess" WHERE "eventId" = $1', [id]);
    await query('DELETE FROM "Order" WHERE "eventId" = $1', [id]);
    await query('DELETE FROM "Withdrawal" WHERE "eventId" = $1', [id]);
    await query(
      `DELETE FROM "TicketDiscountTier"
       WHERE "ticketTypeId" IN (
         SELECT "id"::text FROM "TicketType" WHERE "eventId" = $1
       )`,
      [id]
    );
    await query('DELETE FROM "TicketType" WHERE "eventId" = $1', [id]);
    await query('DELETE FROM "Event" WHERE id = $1', [id]);
    return deleted;
  },
};
