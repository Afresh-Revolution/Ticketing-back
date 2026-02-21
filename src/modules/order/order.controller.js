import crypto from 'crypto';
import { orderModel } from './order.model.js';
import { eventModel } from '../event/event.model.js';
import { sendTicketEmail } from '../../shared/services/email.service.js';

export async function create(req, res, next) {
  try {
    const { eventId, items, fullName, email, phone, address, totalAmount } = req.body;
    const amount = Number(totalAmount);
    const isFreeOrder = amount === 0;

    // Basic validation (totalAmount can be 0 for free tickets)
    const missing = [];
    if (!eventId) missing.push('eventId');
    if (!items || !Array.isArray(items) || items.length === 0) missing.push('items');
    if (!fullName || String(fullName).trim() === '') missing.push('fullName');
    if (!email || String(email).trim() === '') missing.push('email');
    if (totalAmount === undefined || totalAmount === null) missing.push('totalAmount');
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }
    if (Number.isNaN(amount) || amount < 0) {
      return res.status(400).json({ error: 'totalAmount must be a non-negative number' });
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
      totalAmount: amount,
      status: isFreeOrder ? 'paid' : 'pending',
      reference: isFreeOrder ? `free_${Date.now()}` : null
    });

    // Free orders: generate ticket code and send email immediately (no Paystack)
    if (isFreeOrder && order) {
      let ticketCode = generateTicketCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await orderModel.setTicketCode(order.id, ticketCode);
          break;
        } catch (e) {
          if (e.code === '23505') ticketCode = generateTicketCode();
          else throw e;
        }
      }
      const orderWithCode = await orderModel.findById(order.id);
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
        console.error('[order] Free ticket email failed:', emailErr.message);
      }
      return res.status(201).json(orderWithCode);
    }

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
