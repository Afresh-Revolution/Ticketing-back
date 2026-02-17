import { payedModel } from './payed.model.js';

export async function getPayed(req, res, next) {
  try {
    const { ticketId } = req.params;
    const data = await payedModel.getTicket(ticketId);
    if (!data) return res.status(404).json({ error: 'Ticket not found' });
    res.json(data);
  } catch (e) {
    next(e);
  }
}
