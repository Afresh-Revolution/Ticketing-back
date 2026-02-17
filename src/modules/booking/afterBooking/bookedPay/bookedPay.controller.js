import { bookedPayModel } from './bookedPay.model.js';

export async function getBookedPay(req, res, next) {
  try {
    const { ticketId } = req.params;
    const data = await bookedPayModel.getBooking(ticketId);
    if (!data) return res.status(404).json({ error: 'Booking not found' });
    res.json(data);
  } catch (e) {
    next(e);
  }
}
