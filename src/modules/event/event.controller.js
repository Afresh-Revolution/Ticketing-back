import { eventModel } from './event.model.js';
import { config } from '../../shared/config/env.js';
import { query } from '../../shared/config/db.js';

/** Stable numeric id for external systems (e.g. JOSCITY) from our UUID. */
function toStableNumericId(id) {
  if (!id || typeof id !== 'string') return 0;
  const hex = id.replace(/-/g, '').slice(0, 12);
  return parseInt(hex, 16) || 0;
}

/** GET /api/events/feed/joscity – JOSCITY-compatible event list. Optional: X-API-Key or Authorization: Bearer <key> if JOSCITY_API_KEY is set. */
export async function listForJoscity(req, res, next) {
  try {
    const apiKey = config.joscityApiKey;
    if (apiKey) {
      const key = req.headers['x-api-key'] || (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
      if (key !== apiKey) {
        return res.status(401).json({ error: 'Invalid or missing API key' });
      }
    }

    const events = await eventModel.findMany({ include: { tickets: true } });
    const allTicketTypeIds = events.flatMap((e) => (Array.isArray(e.tickets) ? e.tickets : []).map((t) => t.id)).filter(Boolean);
    let soldByTicketTypeId = {};
    if (allTicketTypeIds.length > 0) {
      const { rows: soldRows } = await query(
        `SELECT oi."ticketTypeId", COALESCE(SUM(oi.quantity), 0)::int AS sold
         FROM "OrderItem" oi
         INNER JOIN "Order" o ON o.id = oi."orderId" AND o.status = 'paid'
         WHERE oi."ticketTypeId" = ANY($1)
         GROUP BY oi."ticketTypeId"`,
        [allTicketTypeIds]
      );
      soldByTicketTypeId = soldRows.reduce((acc, r) => { acc[r.ticketTypeId] = Number(r.sold) || 0; return acc; }, {});
    }
    const list = events.map((e) => {
      const date = e.date;
      const eventDate = date instanceof Date ? date.toISOString() : (typeof date === 'string' ? date : '');
      const tickets = Array.isArray(e.tickets) ? e.tickets : [];
      const capacity = tickets.reduce((sum, t) => sum + (Number(t.quantity) || 0), 0);
      const ticketsSold = tickets.reduce((sum, t) => sum + (soldByTicketTypeId[t.id] || 0), 0);
      return {
        event_id: toStableNumericId(e.id),
        event_id_string: e.id,
        event_title: e.title || '',
        event_description: e.description ?? '',
        event_category: e.category ?? '',
        event_date: eventDate,
        event_location: e.venue || e.location || '',
        event_cover: (e.imageUrl && e.imageUrl.startsWith('http')) ? e.imageUrl : (e.imageUrl && config.publicBaseUrl ? new URL(e.imageUrl, config.publicBaseUrl).href : (e.imageUrl || '')),
        event_capacity: capacity || undefined,
        capacity: capacity || undefined,
        tickets_sold: ticketsSold,
        source: 'gatewav',
        ticket_url: config.publicFrontendUrl ? `${config.publicFrontendUrl.replace(/\/$/, '')}/event/${e.id}` : undefined,
      };
    });
    res.json(list);
  } catch (e) {
    next(e);
  }
}

/** Returns true if the current user is allowed to modify this event (creator or super admin for null createdBy). */
function canModifyEvent(event, userId) {
  const sid = String(userId);
  const isSuperAdmin = sid === '0' || userId === 0;
  if (event.createdBy == null) return isSuperAdmin;
  return String(event.createdBy) === sid;
}

export async function list(req, res, next) {
  try {
    const trending = req.query.trending === 'true';
    const events = await eventModel.findMany({ 
      include: { tickets: true },
      trending 
    });
    res.json(events);
  } catch (e) {
    next(e);
  }
}

export async function getById(req, res, next) {
  try {
    const event = await eventModel.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    event.tickets = Array.isArray(event.tickets) ? event.tickets : [];
    res.json(event);
  } catch (e) {
    next(e);
  }
}

export async function create(req, res, next) {
  try {
    const { 
      title, description, date, venue, category, startTime, price, imageUrl, isTrending, location,
      ticketTypes // Added ticketTypes
    } = req.body;
    
    // Validate required
    if (!title || !date) {
      return res.status(400).json({ error: 'Title and date are required' });
    }

    const event = await eventModel.create({
      title,
      description,
      date,
      venue,
      imageUrl,
      category, 
      startTime,
      price,
      currency: 'NGN',
      isTrending: isTrending || false,
      location,
      ticketTypes, // Pass ticketTypes to model
      // Synthetic superadmin (id 0) is not in User table; use null to satisfy FK
      createdBy: req.user && req.user.id !== 0 && req.user.id !== '0' ? req.user.id : null
    });

    res.status(201).json(event);
  } catch (e) {
    next(e);
  }
}

export async function update(req, res, next) {
  try {
    const existing = await eventModel.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Event not found' });
    if (!canModifyEvent(existing, req.user.id)) return res.status(403).json({ error: 'You do not own this event' });

    const {
      title,
      description,
      date,
      venue,
      location,
      isTrending,
      startTime,
      imageUrl,
      category,
      price,
      ticketTypes,
    } = req.body;
    const event = await eventModel.update(req.params.id, {
      ...(title != null && { title }),
      ...(description != null && { description }),
      ...(date != null && { date: new Date(date) }),
      ...(venue != null && { venue }),
      ...(location != null && { location }),
      ...(isTrending != null && { isTrending }),
      ...(startTime != null && { startTime }),
      ...(imageUrl != null && { imageUrl }),
      ...(category != null && { category }),
      ...(price != null && { price }),
      ...(ticketTypes != null && { ticketTypes }),
    });
    res.json(event);
  } catch (e) {
    next(e);
  }
}

export async function remove(req, res, next) {
  try {
    const event = await eventModel.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const isSuperAdmin = req.user.role === 'superadmin' || req.user.id === 0 || req.user.id === '0';
    if (!isSuperAdmin) {
      const ownsEvent = event.createdBy != null && String(event.createdBy) === String(req.user.id);
      if (!ownsEvent) return res.status(403).json({ error: 'You do not own this event' });
    }
    await eventModel.delete(req.params.id);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

export async function toggleTrending(req, res, next) {
  try {
    const event = await eventModel.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (!canModifyEvent(event, req.user.id)) return res.status(403).json({ error: 'You do not own this event' });

    const updated = await eventModel.update(req.params.id, {
      isTrending: !event.isTrending
    });
    
    res.json(updated);
  } catch (e) {
    next(e);
  }
}
