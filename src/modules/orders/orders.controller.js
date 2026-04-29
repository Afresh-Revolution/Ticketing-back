import crypto from 'crypto';
import { query, createId } from '../../shared/config/db.js';
import { config } from '../../shared/config/env.js';
import { sendTicketEmail } from '../../shared/services/email.service.js';

function applyCouponDiscount(totalAmount, coupon) {
  const amount = Math.max(0, Number(totalAmount) || 0);
  if (!coupon) {
    return { originalAmount: amount, discountAmount: 0, finalAmount: amount };
  }
  let discountAmount = 0;
  if (coupon.discountType === 'fixed') {
    discountAmount = Math.max(0, Number(coupon.discountValue) || 0);
  } else {
    const percentage = Math.max(0, Math.min(100, Number(coupon.discountValue) || 0));
    discountAmount = Math.round((amount * percentage) / 100);
  }
  discountAmount = Math.min(amount, discountAmount);
  return {
    originalAmount: amount,
    discountAmount,
    finalAmount: Math.max(0, amount - discountAmount),
  };
}

async function getValidCoupon(eventId, code) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!eventId || !normalizedCode) return null;

  const couponResult = await query(
    `SELECT id, "eventId", code, name, "discountType", "discountValue", "maxUses", "usedCount", "isActive", "expiresAt"
     FROM "Coupon"
     WHERE "eventId"::text = $1 AND UPPER(code) = $2
     LIMIT 1`,
    [String(eventId), normalizedCode]
  ).catch((e) => {
    if (e?.code === '42P01') return { rows: [] };
    throw e;
  });
  const coupon = couponResult?.rows?.[0];
  if (!coupon) return null;
  if (!coupon.isActive) return null;
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) return null;
  if (coupon.maxUses != null && Number(coupon.usedCount) >= Number(coupon.maxUses)) return null;
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

function generateTicketCode() {
  return crypto.randomBytes(6).toString('hex').toUpperCase();
}

function generatePaystackReference() {
  return `ord_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolvePaystackChannels() {
  const raw = process.env.PAYSTACK_CHANNELS;
  const allowed = new Set(['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer', 'eft']);
  const fallback = ['card', 'bank', 'ussd'];
  const allowTransfer = process.env.PAYSTACK_ENABLE_TRANSFER === '1';
  if (!raw || !raw.trim()) return fallback;
  const parsed = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => allowed.has(value))
    .filter((value) => (allowTransfer ? true : value !== 'bank_transfer'));
  return parsed.length > 0 ? parsed : fallback;
}

async function getOrderById(orderId) {
  const result = await query(
    `SELECT id, "eventId", "fullName", email, "totalAmount", status, reference, "ticketCode"
     FROM "Order"
     WHERE id::text = $1
     LIMIT 1`,
    [String(orderId)]
  ).catch((e) => {
    if (e?.code === '42P01') return { rows: [] };
    throw e;
  });
  return result.rows?.[0] || null;
}

async function ensureOrderTicketCode(orderId, currentTicketCode) {
  if (currentTicketCode) return currentTicketCode;
  let ticketCode = generateTicketCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const updated = await query(
        `UPDATE "Order"
         SET "ticketCode" = $1, "updatedAt" = NOW()
         WHERE id::text = $2
         RETURNING "ticketCode"`,
        [ticketCode, String(orderId)]
      );
      return updated.rows?.[0]?.ticketCode || ticketCode;
    } catch (e) {
      if (e?.code === '23505') {
        ticketCode = generateTicketCode();
        continue;
      }
      throw e;
    }
  }
  throw new Error('Failed to generate a unique ticket code');
}

async function getOrderTicketTypes(orderId) {
  const result = await query(
    `SELECT COALESCE(tt.name, 'General') AS name
     FROM "OrderItem" oi
     LEFT JOIN "TicketType" tt ON tt.id::text = oi."ticketTypeId"::text
     WHERE oi."orderId"::text = $1`,
    [String(orderId)]
  ).catch(() => ({ rows: [] }));
  return (result.rows || []).map((row) => String(row.name || '').trim()).filter(Boolean);
}

async function getEventMeta(eventId) {
  const result = await query(
    `SELECT title, date FROM "Event" WHERE id::text = $1 LIMIT 1`,
    [String(eventId)]
  ).catch(() => ({ rows: [] }));
  return result.rows?.[0] || null;
}

async function sendOrderTicket(order) {
  if (!order?.email) return;
  const ticketCode = await ensureOrderTicketCode(order.id, order.ticketCode);
  const eventMeta = await getEventMeta(order.eventId);
  const ticketTypes = await getOrderTicketTypes(order.id);
  try {
    await sendTicketEmail({
      to: order.email,
      fullName: order.fullName,
      ticketCode,
      eventTitle: eventMeta?.title,
      eventDate: eventMeta?.date,
      ticketTypes,
    });
  } catch (emailErr) {
    console.error('[orders] Ticket email failed:', emailErr?.message || emailErr);
  }
}

async function verifyWithPaystack(reference) {
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.paystackSecretKey}`,
      'Content-Type': 'application/json',
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.status !== true) {
    const err = new Error(data?.message || 'Paystack verification failed');
    err.statusCode = 400;
    throw err;
  }
  return data?.data || null;
}

/** POST /api/orders - create order (eventId, items, totalAmount, fullName, email, phone?, address?) */
export async function createOrder(req, res) {
  try {
    const { eventId, items, fullName, email, phone, address } = req.body || {};
    const { couponCode, originalAmount } = resolveOrderCouponInput(req.body || {});
    const userId = req.userId || null;
    if (!eventId || !items || !Array.isArray(items) || items.length === 0 || originalAmount == null) {
      return res.status(400).json({ error: 'eventId, items and totalAmount required' });
    }
    const baseAmount = Number(originalAmount);
    if (Number.isNaN(baseAmount) || baseAmount < 0) {
      return res.status(400).json({ error: 'totalAmount must be a non-negative number' });
    }

    const coupon = couponCode ? await getValidCoupon(eventId, couponCode) : null;
    if (couponCode && !coupon) {
      return res.status(400).json({ error: 'Invalid or expired coupon code' });
    }
    const pricing = applyCouponDiscount(baseAmount, coupon);

    const orderId = createId();
    const ref = `order_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const result = await query(
      `INSERT INTO "Order" ("id", "eventId", "userId", "fullName", "email", "phone", "address", "totalAmount", "status", "reference", "couponId", "couponCode", "originalAmount", "discountAmount")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11, $12, $13)
       RETURNING "id", "reference", "status", "totalAmount", "couponCode", "originalAmount", "discountAmount"`,
      [
        orderId,
        eventId,
        userId,
        (fullName || '').trim() || null,
        (email || '').trim() || null,
        (phone || '').trim() || null,
        (address || '').trim() || null,
        pricing.finalAmount,
        ref,
        coupon?.id ?? null,
        coupon?.code ?? null,
        pricing.originalAmount,
        pricing.discountAmount,
      ]
    ).catch((e) => {
      if (e.code === '42P01') return null;
      throw e;
    });
    if (!result || result.rows.length === 0) {
      return res.status(501).json({ error: 'Orders table not configured' });
    }
    const row = result.rows[0];
    return res.status(201).json({
      id: row.id,
      reference: row.reference,
      status: row.status,
      totalAmount: row.totalAmount,
      couponCode: row.couponCode ?? null,
      originalAmount: row.originalAmount ?? row.totalAmount,
      discountAmount: row.discountAmount ?? 0,
    });
  } catch (err) {
    console.error('createOrder', err);
    return res.status(500).json({ error: err.message || 'Failed to create order' });
  }
}

/** POST /api/orders/validate-coupon - body: eventId, code, totalAmount */
export async function validateCoupon(req, res) {
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
    console.error('validateCoupon', err);
    return res.status(500).json({ error: err.message || 'Failed to validate coupon' });
  }
}

/** POST /api/orders/initialize-payment - body: email, amount (in naira), optional reference/metadata */
export async function initializePayment(req, res) {
  try {
    const { email, amount, totalAmount, reference, metadata, orderId, callbackUrl } = req.body || {};
    let resolvedEmail = email;
    let resolvedAmount = amount ?? totalAmount;
    let resolvedReference = reference;

    // Support order-first checkout flow: frontend sends orderId and backend derives amount/email.
    if (orderId) {
      const order = await getOrderById(orderId);
      if (!order) return res.status(404).json({ error: 'Order not found' });
      if (String(order.status || '').toLowerCase() === 'paid') {
        return res.status(400).json({ error: 'Order is already paid' });
      }
      resolvedEmail = resolvedEmail || order.email;
      resolvedAmount = resolvedAmount ?? order.totalAmount;
      resolvedReference = resolvedReference || order.reference || generatePaystackReference();

      // Keep order reference synchronized with Paystack reference for easier verify flow.
      await query(
        `UPDATE "Order"
         SET reference = $1, "updatedAt" = NOW()
         WHERE id::text = $2`,
        [resolvedReference, String(orderId)]
      ).catch(() => null);
    }

    const numericAmount = Number(resolvedAmount);
    if (!resolvedEmail || Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'Provide either orderId or email and amount' });
    }
    if (!config.paystackSecretKey) {
      return res.status(500).json({
        error: 'PAYSTACK_SECRET_KEY is not configured',
        hint: 'Set PAYSTACK_SECRET_KEY in Ticketing-back/.env and restart backend',
      });
    }

    const amountKobo = Math.round(numericAmount * 100);
    const txRef = String(resolvedReference || generatePaystackReference());
    const channels = resolvePaystackChannels();

    // Local dev helper: bypass Paystack network call when explicitly enabled.
    if (process.env.PAYSTACK_MOCK_INIT === '1') {
      const mockUrl = callbackUrl
        ? `${callbackUrl}${callbackUrl.includes('?') ? '&' : '?'}reference=${encodeURIComponent(txRef)}&trxref=${encodeURIComponent(txRef)}&status=success`
        : `${config.frontendBaseUrl}/#/payment-success?reference=${encodeURIComponent(txRef)}&trxref=${encodeURIComponent(txRef)}&status=success`;
      return res.json({
        message: 'Payment initialized (mock mode)',
        authorizationUrl: mockUrl,
        authorization_url: mockUrl,
        accessCode: `mock_${txRef}`,
        access_code: `mock_${txRef}`,
        reference: txRef,
        mock: true,
      });
    }

    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: String(resolvedEmail).trim(),
        amount: amountKobo,
        reference: txRef,
        currency: 'NGN',
        channels,
        callback_url: callbackUrl || undefined,
        metadata: metadata && typeof metadata === 'object' ? metadata : undefined,
      }),
    });

    const data = await paystackRes.json().catch(() => ({}));
    if (!paystackRes.ok || !data?.status || !data?.data) {
      return res.status(400).json({ error: data?.message || 'Failed to initialize payment' });
    }

    return res.json({
      message: 'Payment initialized',
      authorizationUrl: data.data.authorization_url,
      authorization_url: data.data.authorization_url,
      accessCode: data.data.access_code,
      access_code: data.data.access_code,
      reference: data.data.reference || txRef,
    });
  } catch (err) {
    console.error('initializePayment', err);
    return res.status(500).json({ error: err.message || 'Failed to initialize payment' });
  }
}

/** POST /api/orders/verify - body: reference, orderId */
export async function verifyOrder(req, res) {
  try {
    const { reference, orderId } = req.body || {};
    if (!reference || !orderId) {
      return res.status(400).json({ error: 'reference and orderId required' });
    }
    const order = await getOrderById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (String(order.status || '').toLowerCase() === 'paid') return res.json({ message: 'Verified', orderId });
    if (order.reference && String(order.reference) !== String(reference)) {
      return res.status(400).json({ error: 'Reference does not match order' });
    }

    const isMockReference = String(reference).startsWith('ord_') && process.env.PAYSTACK_MOCK_INIT === '1';
    if (!isMockReference) {
      if (!config.paystackSecretKey) {
        return res.status(500).json({ error: 'PAYSTACK_SECRET_KEY is not configured' });
      }
      const paystackData = await verifyWithPaystack(reference);
      if (String(paystackData?.status || '').toLowerCase() !== 'success') {
        return res.status(400).json({ error: 'Payment was not successful' });
      }
      const paidAmountKobo = Number(paystackData?.amount || 0);
      const expectedAmountKobo = Math.round((Number(order.totalAmount) || 0) * 100);
      if (paidAmountKobo !== expectedAmountKobo) {
        return res.status(400).json({ error: 'Payment amount does not match order amount' });
      }
    }

    await query(
      'UPDATE "Order" SET "status" = \'paid\', "reference" = $1, "updatedAt" = NOW() WHERE "id" = $2',
      [reference, orderId]
    ).catch((e) => {
      if (e.code === '42P01') return { rowCount: 0 };
      throw e;
    });

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
    await sendOrderTicket(order);
    return res.json({ message: 'Verified' });
  } catch (err) {
    console.error('verifyOrder', err);
    const statusCode = Number(err?.statusCode) || 500;
    return res.status(statusCode).json({ error: err.message || 'Verification failed' });
  }
}
