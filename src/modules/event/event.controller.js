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
    const event = await eventModel.findById(req.params.id, true);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (e) {
    next(e);
  }
}

export async function create(req, res, next) {
  try {
    const { title, description, date, venue, location, category, startTime, price, imageUrl } = req.body;
    if (!title || !date) return res.status(400).json({ error: 'title and date are required' });
    const event = await eventModel.create({
      title,
      description: description ?? null,
      date: new Date(date),
      venue: venue ?? null,
      location: location ?? null,
      category: category ?? null,
      startTime: startTime ?? null,
      price: price ? Number(price) : null,
      imageUrl: imageUrl ?? null,
      isTrending: false
    });
    res.status(201).json(event);
  } catch (e) {
    next(e);
  }
}

export async function update(req, res, next) {
  try {
    const { title, description, date, venue, location, isTrending } = req.body;
    const event = await eventModel.update(req.params.id, {
      ...(title != null && { title }),
      ...(description != null && { description }),
      ...(date != null && { date: new Date(date) }),
      ...(venue != null && { venue }),
      ...(location != null && { location }),
      ...(isTrending != null && { isTrending }),
    });
    res.json(event);
  } catch (e) {
    next(e);
  }
}

export async function remove(req, res, next) {
  try {
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
