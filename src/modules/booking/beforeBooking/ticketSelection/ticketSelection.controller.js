import { ticketSelectionModel } from './ticketSelection.model.js';

export async function getTicketSelection(req, res, next) {
  try {
    const { eventId } = req.query;
    if (!eventId) return res.status(400).json({ error: 'eventId required' });
    const data = await ticketSelectionModel.getEvent(eventId);
    if (!data) return res.status(404).json({ error: 'Event not found' });
    res.json(data);
  } catch (e) {
    next(e);
  }
}
