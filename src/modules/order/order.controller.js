import crypto from 'crypto';
import { orderModel } from './order.model.js';
import { eventModel } from '../event/event.model.js';
import { sendEmail, sendTicketEmail } from '../../shared/services/email.service.js';
import {
  generateOrderReference,
  initializeTransaction,
  isPaystackConfigured,
  verifyTransaction,
} from '../../shared/services/paystack.service.js';
import { query } from '../../shared/config/db.js';
import { config } from '../../shared/config/env.js';

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
    `SELECT
       c.id,
       c."eventId",
       c.code,
       c.name,
       c."discountType",
       c."discountValue",
       c."maxUses",
       c."usedCount",
       c."isActive",
       c."expiresAt",
       (SELECT COUNT(*)::int
        FROM "Order" o
        WHERE o."couponId" IS NOT NULL AND o."couponId"::text = c.id::text) AS "liveUsedCount"
     FROM "Coupon" c
     WHERE c."eventId"::text = $1 AND UPPER(c.code) = $2
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
  const liveUsed = Number(coupon.liveUsedCount) || 0;
  if (coupon.maxUses != null && liveUsed >= Number(coupon.maxUses)) return null;
  return coupon;
}

function resolveCouponPreviewInput(body = {}) {
  const eventId = body.eventId ?? body.event_id ?? body.event ?? null;
  const code = body.code ?? body.couponCode ?? body.coupon_code ?? body.coupon ?? null;
  const totalAmount =
    body.totalAmount ??
    body.total ??
    body.amount ??
    body.subtotal ??
    body.baseAmount ??
    null;
  return { eventId, code, totalAmount };
}

function resolveOrderCouponInput(body = {}) {
  const couponCode = body.couponCode ?? body.code ?? body.coupon_code ?? body.coupon ?? null;
  const originalAmount =
    body.originalAmount ??
    body.subtotal ??
    body.baseAmount ??
    body.amount ??
    body.totalAmount ??
    null;
  return { couponCode, originalAmount };
}

export async function create(req, res, next) {
  try {
    const { eventId, items, fullName, email, phone, address, totalAmount } = req.body;
    const { couponCode, originalAmount } = resolveOrderCouponInput(req.body || {});
    const amount = Number(originalAmount);

    // Basic validation (totalAmount can be 0 for free tickets)
    const missing = [];
    if (!eventId) missing.push('eventId');
    if (!items || !Array.isArray(items) || items.length === 0) missing.push('items');
    if (!fullName || String(fullName).trim() === '') missing.push('fullName');
    if (!email || String(email).trim() === '') missing.push('email');
    if (originalAmount === undefined || originalAmount === null) missing.push('totalAmount');
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
    const { eventId, code, totalAmount } = resolveCouponPreviewInput(req.body || {});
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

async function verifyWithPaystack(reference) {
  if (!isPaystackConfigured()) {
    throw new Error('PAYSTACK_SECRET_KEY is missing in backend environment');
  }
  return verifyTransaction(reference);
}

async function ensureOrderTicketCode(orderId, currentTicketCode) {
  if (currentTicketCode) return currentTicketCode;
  let ticketCode = generateTicketCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await orderModel.setTicketCode(orderId, ticketCode);
      return ticketCode;
    } catch (e) {
      if (e?.code === '23505') {
        ticketCode = generateTicketCode();
        continue;
      }
      throw e;
    }
  }
  throw new Error('Failed to generate ticket code');
}

async function sendOrderTicketEmail(order) {
  const ticketCode = await ensureOrderTicketCode(order.id, order.ticketCode);
  const freshOrder = await orderModel.findById(order.id);
  const event = await eventModel.findById(order.eventId);
  try {
    await sendTicketEmail({
      to: order.email,
      fullName: order.fullName,
      ticketCode,
      eventTitle: event?.title,
      eventDate: event?.date,
      ticketTypes: extractTicketTypes(freshOrder?.items),
    });
  } catch (emailErr) {
    console.error('[order] Ticket email failed:', emailErr.message);
  }
  return { freshOrder, ticketCode };
}

/** POST /api/orders/manual-payment-notify – buyer tapped “Paid” after bank transfer; notifies ops and confirms order exists. */
export async function manualPaymentNotify(req, res, next) {
  try {
    const { orderId, email } = req.body || {};
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const order = await orderModel.findById(String(orderId));
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const buyerEmail = String(email || order.email || '').trim() || 'N/A';
    if (!order.reference || !String(order.reference).startsWith('manual-')) {
      await query(
        `UPDATE "Order" SET reference = $1, "updatedAt" = NOW() WHERE id = $2`,
        [`manual-${order.id}`, order.id]
      ).catch(() => {});
    }
    const event = await eventModel.findById(order.eventId);
    const notifyTo =
      (await eventModel.getOwnerEmail(order.eventId)) ||
      config.manualPaymentNotifyEmail ||
      null;
    if (!notifyTo) {
      return res.status(500).json({
        error: 'Could not notify organizer: no owner email for this event',
      });
    }
    const subject = `Payment requested (${String(order.id)})`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <h2 style="color:#791A94;">Payment Notice</h2>
        <p>A buyer tapped <strong>Paid</strong> after transfer instructions (bank checkout).</p>
        <ul>
          <li><strong>Order ID:</strong> ${String(order.id)}</li>
          <li><strong>Event:</strong> ${String(event?.title || 'Unknown event')}</li>
          <li><strong>Amount:</strong> ₦${Number(order.totalAmount || 0).toLocaleString()}</li>
          <li><strong>Buyer name:</strong> ${String(order.fullName || 'N/A')}</li>
          <li><strong>Buyer email:</strong> ${buyerEmail}</li>
          <li><strong>Status:</strong> ${String(order.status || 'pending')}</li>
          <li><strong>Reference:</strong> ${String(order.reference || '')}</li>
        </ul>
      </div>
    `;
    await sendEmail({ to: notifyTo, subject, html });

    return res.json({ message: 'Payment notice sent' });
  } catch (err) {
    next(err);
  }
}

export async function initializePayment(req, res, next) {
  try {
    const { orderId, callbackUrl } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

    if (!config.paystackSecretKey) {
      return res.status(500).json({
        error: 'Payment is not configured on backend',
        hint: 'Set PAYSTACK_SECRET_KEY in Ticketing-back/.env and restart backend',
      });
    }

    const order = await orderModel.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (String(order.status || '').toLowerCase() === 'paid') {
      return res.status(400).json({ error: 'Order is already paid' });
    }
    if (!order.email || !String(order.email).includes('@')) {
      return res.status(400).json({ error: 'Order email is invalid' });
    }

    const amountKobo = Math.round((Number(order.totalAmount) || 0) * 100);
    if (!Number.isFinite(amountKobo) || amountKobo < 100) {
      return res.status(400).json({ error: 'Order amount must be at least ₦1' });
    }

    const reference = generateOrderReference();
    await query(
      `UPDATE "Order" SET "reference" = $1, "updatedAt" = NOW() WHERE id = $2`,
      [reference, orderId]
    );

    if (process.env.PAYSTACK_MOCK_INIT === '1') {
      const mockUrl = callbackUrl
        ? `${callbackUrl}${callbackUrl.includes('?') ? '&' : '?'}reference=${encodeURIComponent(reference)}&trxref=${encodeURIComponent(reference)}&status=success`
        : `${config.frontendBaseUrl}/#/payment-success?orderId=${encodeURIComponent(String(order.id))}&reference=${encodeURIComponent(reference)}&trxref=${encodeURIComponent(reference)}&status=success`;
      return res.json({
        authorizationUrl: mockUrl,
        accessCode: `mock_${reference}`,
        reference,
        orderId: String(order.id),
        mock: true,
      });
    }

    const paystackData = await initializeTransaction({
      email: String(order.email).trim(),
      amountKobo,
      reference,
      callbackUrl: callbackUrl || `${config.frontendBaseUrl}/#/payment-success`,
      metadata: {
        orderId: String(order.id),
        eventId: String(order.eventId || ''),
        fullName: String(order.fullName || ''),
      },
    });

    if (!paystackData?.authorization_url) {
      return res.status(400).json({ error: 'Failed to initialize payment' });
    }

    return res.json({
      authorizationUrl: paystackData.authorization_url,
      accessCode: paystackData.access_code,
      reference: paystackData.reference || reference,
      orderId: String(order.id),
    });
  } catch (err) {
    next(err);
  }
}

export async function verify(req, res, next) {
  try {
    const { reference, orderId } = req.body;

    if (!reference || !orderId) {
      return res.status(400).json({ error: 'Missing reference or orderId' });
    }

    const existingOrder = await orderModel.findById(orderId);
    if (!existingOrder) return res.status(404).json({ error: 'Order not found' });

    if (String(existingOrder.status || '').toLowerCase() === 'paid') {
      return res.json(existingOrder);
    }

    if (existingOrder.reference && String(existingOrder.reference) !== String(reference)) {
      return res.status(400).json({ error: 'Reference does not match this order' });
    }

    const isMockReference =
      process.env.PAYSTACK_MOCK_INIT === '1' && String(reference).startsWith('ord_');
    if (!isMockReference) {
      const paystackTx = await verifyWithPaystack(reference);
      if (!paystackTx || String(paystackTx.status || '').toLowerCase() !== 'success') {
        return res.status(400).json({ error: 'Payment was not successful' });
      }

      const paidAmountKobo = Number(paystackTx.amount || 0);
      const expectedAmountKobo = Math.round((Number(existingOrder.totalAmount) || 0) * 100);
      if (paidAmountKobo !== expectedAmountKobo) {
        return res.status(400).json({ error: 'Payment amount does not match order amount' });
      }
    }

    const paidOrder = await orderModel.updateStatus(orderId, 'paid', reference);
    if (!paidOrder) return res.status(404).json({ error: 'Order not found' });

    const { freshOrder } = await sendOrderTicketEmail(paidOrder);

    res.json(freshOrder);
  } catch (err) {
    next(err);
  }
}
