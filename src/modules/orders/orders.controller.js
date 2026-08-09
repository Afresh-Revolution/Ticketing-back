import crypto from 'crypto';
import { query, createId } from '../../shared/config/db.js';
import { config, getManualPaymentDetails } from '../../shared/config/env.js';
import { sendEmail, sendTicketEmail } from '../../shared/services/email.service.js';
import {
  buildTicketEmailPayload,
  loadEventForTicketEmail,
  loadOrderTicketItems,
} from '../../shared/utils/ticketEmailContext.js';
import { normalizeBuyerEmail } from '../../shared/utils/email.js';
import { eventModel } from '../event/event.model.js';

/** GET /api/orders/manual-payment-details – bank transfer info from backend env. */
export function getManualPaymentDetailsHandler(_req, res) {
  return res.json(getManualPaymentDetails());
}

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

async function resolveOrderItemTicketTypeId(eventId, item = {}) {
  const directId = item.ticketTypeId ?? item.ticketTypeID ?? item.ticketId ?? item.id ?? null;
  if (directId != null && String(directId).trim() !== '') return String(directId).trim();

  const ticketName = item.ticketType ?? item.ticketName ?? item.name ?? null;
  if (ticketName == null || String(ticketName).trim() === '') return null;

  const result = await query(
    `SELECT "id"
     FROM "TicketType"
     WHERE "eventId"::text = $1
       AND LOWER(TRIM(COALESCE("name", ''))) = LOWER(TRIM($2))
     LIMIT 1`,
    [String(eventId), String(ticketName)]
  ).catch((e) => {
    if (e?.code === '42P01') return { rows: [] };
    throw e;
  });
  return result.rows?.[0]?.id ? String(result.rows[0].id) : null;
}

async function calculateOrderItems(eventId, items) {
  const requestedByTicketId = new Map();
  for (const item of items) {
    const quantity = Number(item?.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw Object.assign(new Error('Each ticket quantity must be a positive whole number'), { statusCode: 400 });
    }
    const ticketTypeId = await resolveOrderItemTicketTypeId(eventId, item);
    if (!ticketTypeId) {
      throw Object.assign(new Error('One or more ticket types are invalid for this event'), { statusCode: 400 });
    }
    requestedByTicketId.set(
      ticketTypeId,
      (requestedByTicketId.get(ticketTypeId) || 0) + quantity
    );
  }

  const ticketTypeIds = [...requestedByTicketId.keys()];
  const { rows: ticketRows } = await query(
    `SELECT tt."id", tt."name", tt."price", tt."quantity",
            COALESCE(sold."sold", 0)::int AS "sold"
     FROM "TicketType" tt
     LEFT JOIN (
       SELECT oi."ticketTypeId", COALESCE(SUM(oi."quantity"), 0)::int AS "sold"
       FROM "OrderItem" oi
       INNER JOIN "Order" o ON o."id" = oi."orderId"
       WHERE LOWER(TRIM(COALESCE(o."status", ''))) IN
         ('paid', 'completed', 'success', 'changed', 'true')
       GROUP BY oi."ticketTypeId"
     ) sold ON sold."ticketTypeId" = tt."id"
     WHERE tt."eventId"::text = $1
       AND tt."id"::text = ANY($2::text[])`,
    [String(eventId), ticketTypeIds]
  );
  if (ticketRows.length !== ticketTypeIds.length) {
    throw Object.assign(new Error('One or more ticket types are invalid for this event'), { statusCode: 400 });
  }

  const { rows: tierRows } = await query(
    `SELECT "ticketTypeId", "minimumQuantity", "discountPercent"
     FROM "TicketDiscountTier"
     WHERE "ticketTypeId" = ANY($1::text[])
     ORDER BY "minimumQuantity" ASC`,
    [ticketTypeIds]
  ).catch((error) => {
    if (error?.code === '42P01') return { rows: [] };
    throw error;
  });
  const tiersByTicketId = tierRows.reduce((result, tier) => {
    const key = String(tier.ticketTypeId);
    if (!result[key]) result[key] = [];
    result[key].push(tier);
    return result;
  }, {});

  let originalAmount = 0;
  let quantityDiscountAmount = 0;
  const pricedItems = ticketRows.map((ticket) => {
    const ticketTypeId = String(ticket.id);
    const quantity = requestedByTicketId.get(ticketTypeId);
    const available = Math.max(0, Number(ticket.quantity) - Number(ticket.sold));
    if (quantity > available) {
      throw Object.assign(
        new Error(`Only ${available} ${ticket.name || 'ticket'} ticket(s) remain`),
        { statusCode: 409 }
      );
    }
    const unitPrice = Math.max(0, Number(ticket.price) || 0);
    const lineOriginalAmount = unitPrice * quantity;
    const applicableTier = (tiersByTicketId[ticketTypeId] || [])
      .filter((tier) => quantity >= Number(tier.minimumQuantity))
      .at(-1);
    const discountPercent = applicableTier
      ? Math.max(0, Math.min(100, Number(applicableTier.discountPercent) || 0))
      : 0;
    const lineDiscountAmount = Math.round((lineOriginalAmount * discountPercent) / 100);
    originalAmount += lineOriginalAmount;
    quantityDiscountAmount += lineDiscountAmount;
    return {
      ticketTypeId,
      quantity,
      unitPrice,
      discountPercent,
      lineOriginalAmount,
      lineDiscountAmount,
      lineFinalAmount: lineOriginalAmount - lineDiscountAmount,
    };
  });

  return {
    items: pricedItems,
    originalAmount,
    quantityDiscountAmount,
    amountAfterQuantityDiscount: originalAmount - quantityDiscountAmount,
  };
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

/** Reject ticket purchases after the event's last day (endDate, else date). */
async function assertEventOnSale(eventId) {
  const result = await query(
    `SELECT id, date, "endDate" FROM "Event" WHERE id::text = $1 LIMIT 1`,
    [String(eventId)]
  ).catch((e) => {
    if (e?.code === '42P01') return { rows: [] };
    throw e;
  });
  const event = result.rows?.[0];
  if (!event) {
    const err = new Error('Event not found');
    err.statusCode = 404;
    throw err;
  }
  const ref = event.endDate || event.date;
  if (!ref) return;
  const end = new Date(ref);
  if (Number.isNaN(end.getTime())) return;
  end.setHours(23, 59, 59, 999);
  if (end.getTime() < Date.now()) {
    const err = new Error('This event has ended. Ticket sales are closed.');
    err.statusCode = 400;
    throw err;
  }
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

async function sendOrderTicket(order) {
  if (!order?.email) return;
  const ticketCode = await ensureOrderTicketCode(order.id, order.ticketCode);
  const [eventRow, ticketItems] = await Promise.all([
    loadEventForTicketEmail(order.eventId),
    loadOrderTicketItems(order.id),
  ]);
  try {
    await sendTicketEmail(
      buildTicketEmailPayload({
        order: { ...order, ticketTypes: ticketItems.map((i) => i.name) },
        ticketCode,
        eventRow,
        ticketItems,
      })
    );
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
    const { couponCode } = resolveOrderCouponInput(req.body || {});
    const userId = req.user?.id ?? req.userId ?? null;
    const buyerEmail = normalizeBuyerEmail(email);
    if (!eventId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'eventId and items required' });
    }

    await assertEventOnSale(eventId);

    const itemPricing = await calculateOrderItems(eventId, items);
    const coupon = couponCode ? await getValidCoupon(eventId, couponCode) : null;
    if (couponCode && !coupon) {
      return res.status(400).json({ error: 'Invalid or expired coupon code' });
    }
    const couponPricing = applyCouponDiscount(
      itemPricing.amountAfterQuantityDiscount,
      coupon
    );
    const totalDiscountAmount =
      itemPricing.quantityDiscountAmount + couponPricing.discountAmount;

    const isFreeOrder = Number(couponPricing.finalAmount) < 1;
    const orderStatus = isFreeOrder ? 'paid' : 'pending';
    const orderId = createId();
    const ref = isFreeOrder
      ? `free_${Date.now()}`
      : `order_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const result = await query(
      `INSERT INTO "Order" ("id", "eventId", "userId", "fullName", "email", "phone", "address", "totalAmount", "status", "reference", "couponId", "couponCode", "originalAmount", "discountAmount", "quantityDiscountAmount")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING "id", "reference", "status", "totalAmount", "couponCode", "originalAmount", "discountAmount", "quantityDiscountAmount"`,
      [
        orderId,
        eventId,
        userId,
        (fullName || '').trim() || null,
        buyerEmail || null,
        (phone || '').trim() || null,
        (address || '').trim() || null,
        couponPricing.finalAmount,
        orderStatus,
        ref,
        coupon?.id ?? null,
        coupon?.code ?? null,
        itemPricing.originalAmount,
        totalDiscountAmount,
        itemPricing.quantityDiscountAmount,
      ]
    ).catch((e) => {
      if (e.code === '42P01') return null;
      throw e;
    });
    if (!result || result.rows.length === 0) {
      return res.status(501).json({ error: 'Orders table not configured' });
    }
    const row = result.rows[0];

    // Persist per-ticket breakdown so sold counters can increment by ticket type when order becomes paid.
    for (const item of itemPricing.items) {
      await query(
        `INSERT INTO "OrderItem" ("id", "orderId", "ticketTypeId", "quantity", "price")
         VALUES ($1, $2, $3, $4, $5)`,
        [createId(), row.id, item.ticketTypeId, item.quantity, item.unitPrice]
      ).catch((e) => {
        if (e?.code === '42P01') return null;
        throw e;
      });
    }

    if (isFreeOrder) {
      if (coupon?.id) {
        await query(
          `UPDATE "Coupon"
           SET "usedCount" = "usedCount" + 1, "updatedAt" = NOW()
           WHERE id = $1`,
          [coupon.id]
        ).catch((e) => {
          if (e?.code === '42P01') return null;
          throw e;
        });
      }
      await sendOrderTicket({
        id: row.id,
        eventId,
        email: buyerEmail,
        fullName: (fullName || '').trim() || null,
        ticketCode: null,
      });
    }

    return res.status(201).json({
      id: row.id,
      reference: row.reference,
      status: row.status,
      totalAmount: row.totalAmount,
      couponCode: row.couponCode ?? null,
      originalAmount: row.originalAmount ?? row.totalAmount,
      discountAmount: row.discountAmount ?? 0,
      quantityDiscountAmount: row.quantityDiscountAmount ?? 0,
      pricing: {
        originalAmount: itemPricing.originalAmount,
        quantityDiscountAmount: itemPricing.quantityDiscountAmount,
        couponDiscountAmount: couponPricing.discountAmount,
        discountAmount: totalDiscountAmount,
        finalAmount: Number(row.totalAmount),
        items: itemPricing.items,
      },
    });
  } catch (err) {
    console.error('createOrder', err);
    return res.status(Number(err?.statusCode) || 500).json({ error: err.message || 'Failed to create order' });
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

/** POST /api/orders/verify - body: orderId, optional reference (falls back to order.reference) */
export async function verifyOrder(req, res) {
  try {
    const { orderId } = req.body || {};
    let reference = req.body?.reference;
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }
    const order = await getOrderById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (String(order.status || '').toLowerCase() === 'paid') {
      return res.json({
        message: 'Verified',
        orderId,
        status: 'paid',
        reference: order.reference || reference || null,
      });
    }

    reference = String(reference || order.reference || '').trim();
    if (!reference) {
      return res.status(400).json({
        error: 'Payment reference not found for this order yet. Try again in a moment.',
      });
    }

    const isMockReference = String(reference).startsWith('ord_') && process.env.PAYSTACK_MOCK_INIT === '1';
    if (!isMockReference) {
      if (!config.paystackSecretKey) {
        return res.status(500).json({ error: 'PAYSTACK_SECRET_KEY is not configured' });
      }
      const paystackData = await verifyWithPaystack(reference);
      if (String(paystackData?.status || '').toLowerCase() !== 'success') {
        return res.status(400).json({
          error: 'Payment was not successful',
          status: String(paystackData?.status || 'failed'),
        });
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
    await sendOrderTicket({ ...order, reference });
    return res.json({ message: 'Verified', orderId, status: 'paid', reference });
  } catch (err) {
    console.error('verifyOrder', err);
    const statusCode = Number(err?.statusCode) || 500;
    return res.status(statusCode).json({ error: err.message || 'Verification failed' });
  }
}

/** POST /api/orders/manual-payment-notify - body: orderId, email */
export async function notifyManualPayment(req, res) {
  try {
    const { orderId, email } = req.body || {};
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const order = await getOrderById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const buyerEmail = String(email || order.email || '').trim() || 'N/A';

    const eventMeta = await loadEventForTicketEmail(order.eventId);
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
        <p>A buyer clicked "Paid" on checkout and reported a completed transfer.</p>
        <ul>
          <li><strong>Order ID:</strong> ${String(order.id)}</li>
          <li><strong>Event:</strong> ${String(eventMeta?.title || 'Unknown event')}</li>
          <li><strong>Amount:</strong> ₦${Number(order.totalAmount || 0).toLocaleString()}</li>
          <li><strong>Buyer name:</strong> ${String(order.fullName || 'N/A')}</li>
          <li><strong>Buyer email:</strong> ${buyerEmail}</li>
          <li><strong>Status:</strong> ${String(order.status || 'pending')}</li>
          <li><strong>Reference:</strong> ${String(order.reference || '')}</li>
        </ul>
      </div>
    `;
    await sendEmail({ to: notifyTo, subject, html });

    return res.json({ message: 'Manual payment notice sent' });
  } catch (err) {
    console.error('notifyManualPayment', err);
    return res.status(500).json({ error: err.message || 'Failed to send manual payment notice' });
  }
}
