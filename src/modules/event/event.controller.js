import { eventModel, normalizeEventImageUrls } from './event.model.js';
import { config } from '../../shared/config/env.js';
import { query } from '../../shared/config/db.js';
import {
  deleteImageFromCloudinary,
  extractCloudinaryPublicId,
  isCloudinaryConfigured,
  uploadImageBufferToCloudinary,
} from '../../shared/services/cloudinary.service.js';
import * as merchModel from '../merch/merch.model.js';

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
         INNER JOIN "Order" o
           ON o.id = oi."orderId"
          AND LOWER(TRIM(COALESCE(o.status, ''))) IN ('paid', 'completed', 'success', 'changed', 'true')
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

/** Returns true if the current user is allowed to modify this event (creator or super admin for any event). */
function canModifyEvent(event, userId) {
  const sid = String(userId);
  const isSuperAdmin = sid === '0' || userId === 0;
  if (isSuperAdmin) return true;
  if (event.createdBy == null) return false;
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
    event.merch = await merchModel.fetchMerchByEventId(req.params.id);
    res.json(event);
  } catch (e) {
    next(e);
  }
}

export async function create(req, res, next) {
  try {
    const { 
      title, description, date, endDate, venue, category, startTime, endTime, price, imageUrl, imageUrls, isTrending, location,
      eventType, streamUrl, streamProvider,
      ticketTypes,
      merch,
    } = req.body;

    const normalizedImageUrls = normalizeEventImageUrls(imageUrls, imageUrl);
    if (Array.isArray(imageUrls) && imageUrls.length > 3) {
      return res.status(400).json({ error: 'At most 3 images are allowed per event' });
    }
    
    // Validate required
    if (!title || !date) {
      return res.status(400).json({ error: 'Title and date are required' });
    }

    const event = await eventModel.create({
      title,
      description,
      date,
      endDate: endDate ?? null,
      venue,
      imageUrl: normalizedImageUrls[0] ?? imageUrl,
      imageUrls: normalizedImageUrls,
      category, 
      startTime,
      endTime: endTime ?? null,
      price,
      currency: 'NGN',
      isTrending: isTrending || false,
      location,
      eventType: eventType || 'in-person',
      streamUrl,
      streamProvider,
      ticketTypes, // Pass ticketTypes to model
      // Synthetic superadmin (id 0) is not in User table; use null to satisfy FK
      createdBy: req.user && req.user.id !== 0 && req.user.id !== '0' ? req.user.id : null
    });

    if (Array.isArray(merch) && merch.length > 0) {
      try {
        await merchModel.replaceMerchForEvent(event.id, merch);
      } catch (merchErr) {
        console.error('[event] merch save on create:', merchErr.message);
      }
    }

    const full = await eventModel.findById(event.id);
    res.status(201).json(full || event);
  } catch (e) {
    next(e);
  }
}

/** PATCH /api/events/:id – Super admin can edit any event; other admins only events they created. */
export async function update(req, res, next) {
  try {
    const existing = await eventModel.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Event not found' });
    if (!canModifyEvent(existing, req.user.id)) return res.status(403).json({ error: 'You can only edit events you created' });

    const {
      title,
      description,
      date,
      venue,
      location,
      isTrending,
      startTime,
      endDate,
      endTime,
      imageUrl,
      imageUrls,
      category,
      price,
      eventType,
      streamUrl,
      streamProvider,
      ticketTypes,
      merch,
    } = req.body;

    if (Array.isArray(imageUrls) && imageUrls.length > 3) {
      return res.status(400).json({ error: 'At most 3 images are allowed per event' });
    }
    const normalizedImageUrls =
      imageUrls !== undefined || imageUrl !== undefined
        ? normalizeEventImageUrls(imageUrls, imageUrl)
        : undefined;

    const event = await eventModel.update(req.params.id, {
      ...(title != null && { title }),
      ...(description != null && { description }),
      ...(date != null && { date: new Date(date) }),
      ...(endDate !== undefined && { endDate: endDate || null }),
      ...(venue != null && { venue }),
      ...(location != null && { location }),
      ...(isTrending != null && { isTrending }),
      ...(startTime != null && { startTime }),
      ...(endTime !== undefined && { endTime: endTime || null }),
      ...(normalizedImageUrls !== undefined && {
        imageUrls: normalizedImageUrls,
        imageUrl: normalizedImageUrls[0] ?? null,
      }),
      ...(category != null && { category }),
      ...(price != null && { price }),
      ...(eventType != null && { eventType }),
      ...(streamUrl !== undefined && { streamUrl }),
      ...(streamProvider != null && { streamProvider }),
      ...(ticketTypes != null && { ticketTypes }),
    });

    if (merch != null && Array.isArray(merch)) {
      try {
        await merchModel.replaceMerchForEvent(req.params.id, merch);
      } catch (merchErr) {
        console.error('[event] merch save on update:', merchErr.message);
      }
    }

    const full = await eventModel.findById(req.params.id);
    res.json(full || event);
  } catch (e) {
    next(e);
  }
}

/** DELETE /api/events/:id – Super admin can delete any event; other admins only events they created. */
export async function remove(req, res, next) {
  try {
    const event = await eventModel.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const isSuperAdmin = req.user.role === 'superadmin' || req.user.id === 0 || req.user.id === '0';
    if (!isSuperAdmin) {
      const ownsEvent = event.createdBy != null && String(event.createdBy) === String(req.user.id);
      if (!ownsEvent) return res.status(403).json({ error: 'You can only delete events you created' });
    }

    const cloudinaryPublicId = extractCloudinaryPublicId(event.imageUrl);
    if (cloudinaryPublicId) {
      if (!isCloudinaryConfigured()) {
        return res.status(500).json({
          error: 'Cloudinary is not configured. Cannot delete event image.',
        });
      }
      const imageDeleteResult = await deleteImageFromCloudinary(cloudinaryPublicId);
      const okResults = new Set(['ok', 'not found']);
      if (!okResults.has(String(imageDeleteResult?.result || '').toLowerCase())) {
        return res.status(500).json({ error: 'Failed to delete image from Cloudinary' });
      }
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

/** POST /api/events/upload-image – Upload image file to Cloudinary. */
export async function uploadImage(req, res, next) {
  try {
    if (!isCloudinaryConfigured()) {
      return res.status(500).json({
        error: 'Cloudinary is not configured on the server',
      });
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
  } catch (e) {
    next(e);
  }
}
