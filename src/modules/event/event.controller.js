import { eventModel } from './event.model.js';

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
    
    const updated = await eventModel.update(req.params.id, {
      isTrending: !event.isTrending
    });
    
    res.json(updated);
  } catch (e) {
    next(e);
  }
}
