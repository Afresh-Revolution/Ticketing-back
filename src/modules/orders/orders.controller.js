import { query } from '../../shared/config/db.js';

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

/** POST /api/orders - create order (eventId, items, totalAmount, fullName, email, phone?, address?) */
export async function createOrder(req, res) {
  try {
    const { eventId, items, totalAmount, fullName, email, phone, address, couponCode } = req.body || {};
    const userId = req.userId || null;
    if (!eventId || !items || !Array.isArray(items) || items.length === 0 || totalAmount == null) {
      return res.status(400).json({ error: 'eventId, items and totalAmount required' });
    }
    const baseAmount = Number(totalAmount);
    if (Number.isNaN(baseAmount) || baseAmount < 0) {
      return res.status(400).json({ error: 'totalAmount must be a non-negative number' });
    }

    const coupon = couponCode ? await getValidCoupon(eventId, couponCode) : null;
    if (couponCode && !coupon) {
      return res.status(400).json({ error: 'Invalid or expired coupon code' });
    }
    const pricing = applyCouponDiscount(baseAmount, coupon);

    const ref = `order_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const result = await query(
      `INSERT INTO "Order" ("eventId", "userId", "fullName", "email", "phone", "address", "totalAmount", "status", "reference", "couponId", "couponCode", "originalAmount", "discountAmount")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11, $12)
       RETURNING "id", "reference", "status", "totalAmount", "couponCode", "originalAmount", "discountAmount"`,
      [
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

/** POST /api/orders/verify - body: reference, orderId */
export async function verifyOrder(req, res) {
  try {
    const { reference, orderId } = req.body || {};
    if (!reference || !orderId) {
      return res.status(400).json({ error: 'reference and orderId required' });
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
    return res.json({ message: 'Verified' });
  } catch (err) {
    console.error('verifyOrder', err);
    return res.status(500).json({ error: err.message || 'Verification failed' });
  }
}
