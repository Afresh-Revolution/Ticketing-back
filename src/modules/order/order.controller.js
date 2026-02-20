import crypto from 'crypto';
import { orderModel } from './order.model.js';
import { eventModel } from '../event/event.model.js';
import { sendTicketEmail } from '../../shared/services/email.service.js';

export async function create(req, res, next) {
  try {
    const { eventId, items, fullName, email, phone, address, totalAmount } = req.body;
    
    // Basic validation
    if (!eventId || !items || items.length === 0 || !fullName || !email || !totalAmount) {
      return res.status(400).json({ error: 'Missing required fields: eventId, items, fullName, email, totalAmount' });
    }

    // Identify user if logged in
    const userId = req.user ? req.user.id : null;

    const order = await orderModel.create({
      eventId,
      userId,
      fullName,
      email,
      phone,
      address,
      items,
      totalAmount,
      status: 'pending'
    });

    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
}

function generateTicketCode() {
  return crypto.randomBytes(6).toString('hex').toUpperCase();
}

export async function verify(req, res, next) {
  try {
    const { reference, orderId } = req.body;

    if (!reference || !orderId) {
      return res.status(400).json({ error: 'Missing reference or orderId' });
    }

    const order = await orderModel.updateStatus(orderId, 'paid', reference);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    let ticketCode = generateTicketCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await orderModel.setTicketCode(orderId, ticketCode);
        break;
      } catch (e) {
        if (e.code === '23505') ticketCode = generateTicketCode();
        else throw e;
      }
    }
    const orderWithCode = await orderModel.findById(orderId);
    const event = await eventModel.findById(order.eventId);

    try {
      await sendTicketEmail({
        to: order.email,
        fullName: order.fullName,
        ticketCode,
        eventTitle: event?.title,
        eventDate: event?.date,
      });
    } catch (emailErr) {
      console.error('[order] Ticket email failed:', emailErr.message);
    }

    res.json(orderWithCode);
  } catch (err) {
    next(err);
  }
}
