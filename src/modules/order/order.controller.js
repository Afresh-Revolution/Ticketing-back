import crypto from 'crypto';
import { orderModel } from './order.model.js';
import { eventModel } from '../event/event.model.js';
import { sendTicketEmail } from '../../shared/services/email.service.js';
import { query } from '../../shared/config/db.js';

function extractTicketTypes(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => item?.ticketName || item?.ticketType || '')
    .map((name) => String(name).trim())
    .filter(Boolean);
}

function applyCouponDiscount(totalAmount, coupon) {
  const amount = Math.max(0, Number(totalAmount) || 0);
  if (!coupon) return { originalAmount: amount, discountAmount: 0, finalAmount: amount };
  let discountAmount = 0;
  if (coupon.discountType === 'fixed') {
    discountAmount = Math.max(0, Number(coupon.discountValue) || 0);
  } else {
    const percentage = Math.max(0, Math.min(100, Number(coupon.discountValue) || 0));
    discountAmount = Math.round((amount * percentage) / 100);
  }
  discountAmount = Math.min(amount, discountAmount);
  return { originalAmount: amount, discountAmount, finalAmount: amount - discountAmount };
}

async function getValidCoupon(eventId, code) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!eventId || !normalizedCode) return null;
  const result = await query(
    `SELECT id, "eventId", code, name, "discountType", "discountValue", "maxUses", "usedCount", "isActive", "expiresAt"
     FROM "Coupon"
     WHERE "eventId"::text = $1 AND UPPER(code) = $2
     LIMIT 1`,
    [String(eventId), normalizedCode]
  ).catch((e) => {
    if (e?.code === '42P01') return { rows: [] };
    throw e;
  });
  const coupon = result.rows?.[0];
  if (!coupon) return null;
  if (!coupon.isActive) return null;
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) return null;
  if (coupon.maxUses != null && Number(coupon.usedCount) >= Number(coupon.maxUses)) return null;
  return coupon;
}

export async function create(req, res, next) {
  try {
    const { eventId, items, fullName, email, phone, address, totalAmount, couponCode } = req.body;
    const amount = Number(totalAmount);

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

    const coupon = couponCode ? await getValidCoupon(eventId, couponCode) : null;
    if (couponCode && !coupon) {
      return res.status(400).json({ error: 'Invalid or expired coupon code' });
    }
    const pricing = applyCouponDiscount(amount, coupon);
    const isFreeOrder = pricing.finalAmount === 0;

    // Identify user if logged in (optionalAuth sets req.user; some middlewares set req.userId)
    const userId = req.user?.id ?? req.userId ?? null;

    const order = await orderModel.create({
      eventId,
      userId,
      fullName,
      email,
      phone,
      address,
      items,
      totalAmount: pricing.finalAmount,
      couponId: coupon?.id ?? null,
      couponCode: coupon?.code ?? null,
      originalAmount: pricing.originalAmount,
      discountAmount: pricing.discountAmount,
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
          ticketTypes: extractTicketTypes(orderWithCode?.items),
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

export async function validateCoupon(req, res, next) {
  try {
    const { eventId, code, totalAmount } = req.body || {};
    if (!eventId || !code || totalAmount == null) {
      return res.status(400).json({ error: 'eventId, code and totalAmount required' });
    }

    const coupon = await getValidCoupon(eventId, code);
    if (!coupon) {
      return res.status(404).json({ error: 'Coupon not found or no longer valid' });
    }

    const pricing = applyCouponDiscount(Number(totalAmount), coupon);
    return res.json({
      valid: true,
      coupon: {
        id: coupon.id,
        eventId: coupon.eventId,
        code: coupon.code,
        name: coupon.name,
        discountType: coupon.discountType,
        discountValue: Number(coupon.discountValue) || 0,
      },
      pricing,
    });
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

    await query(
      `UPDATE "Coupon"
       SET "usedCount" = "usedCount" + 1, "updatedAt" = NOW()
       WHERE id IN (
         SELECT "couponId" FROM "Order" WHERE id = $1 AND "couponId" IS NOT NULL
       )`,
      [orderId]
    ).catch((e) => {
      if (e?.code === '42P01') return null;
      throw e;
    });

    try {
      await sendTicketEmail({
        to: order.email,
        fullName: order.fullName,
        ticketCode,
        eventTitle: event?.title,
        eventDate: event?.date,
        ticketTypes: extractTicketTypes(orderWithCode?.items),
      });
    } catch (emailErr) {
      console.error('[order] Ticket email failed:', emailErr.message);
    }

    res.json(orderWithCode);
  } catch (err) {
    next(err);
  }
}
